import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { cashGoalVersions, companies, evidence, financialReviewSnapshots, financialReviewPreferences, getDatabase, journalLines, recordAudit, setCompanyScopeSql } from "@finance/database";
import { buildCashGoalBridge, buildForecastRun, cashGoalChange, evaluateCashGoal, stableJson } from "@nevermodel/finance-engine";
import type { DbExecutor, DbTransaction } from "./db-executor";
import { loadForecastInputs } from "./forecast-inputs";
import { persistForecastRun } from "./forecast-persistence";
import { loadJournalCoverage } from "./journal-coverage";
import { loadOpeningCash } from "./opening-cash";
import { loadCashCoverage } from "./cash-coverage";
import { loadPostedJournalLines } from "./journal-ledger";
import { cashGoalSchema, goalReviewCommand, type GoalComparison, type GoalOutlook, type GoalReviewCommand, type GoalReviewData, type GoalVersion, type SavedGoalSnapshot, type SnapshotSummary } from "./goal-review-contract";

export class GoalReviewError extends Error {
  constructor(message: string, public status: number = 400) { super(message); }
}
const hash = (value: unknown) => createHash("sha256").update(stableJson(value)).digest("hex");
const jsonCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const version = (row: typeof cashGoalVersions.$inferSelect): GoalVersion => ({ id: row.id, goalId: row.goalId, version: row.version, status: row.status as GoalVersion["status"], definition: cashGoalSchema.parse(row.definition), reason: row.reason, actorUserId: row.actorUserId, createdAt: row.createdAt.toISOString() });
const summary = (row: typeof financialReviewSnapshots.$inferSelect): SnapshotSummary => ({ id: row.id, kind: row.kind as SnapshotSummary["kind"], name: row.name, goalVersionId: row.goalVersionId, planId: row.planId, actorUserId: row.actorUserId, createdAt: row.createdAt.toISOString(), evaluation: (row.snapshot as SavedGoalSnapshot).evaluation });

export async function goalsWith(db: DbExecutor, companyId: string) {
  const rows = await db.selectDistinctOn([cashGoalVersions.goalId]).from(cashGoalVersions).where(eq(cashGoalVersions.companyId, companyId)).orderBy(cashGoalVersions.goalId, desc(cashGoalVersions.version));
  return rows.map(version);
}

/** A transaction-wide database snapshot, not a mixture of successive financial revisions. */
export async function captureOutlook(db: DbExecutor, companyId: string, now: Date): Promise<GoalOutlook> {
  const [company] = await db.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, companyId));
  if (!company) throw new GoalReviewError("Company not found.", 404);
  const input = await loadForecastInputs(companyId, { db, now });
  const output = buildForecastRun(input);
  const periods = [...new Set([input.asOfMonth, input.openMonth?.month].filter((value): value is string => Boolean(value)))];
  const coverage = [];
  for (const period of periods) {
    const item = await loadJournalCoverage(companyId, period, db);
    item.accounts.sort((a, b) => a.accountId.localeCompare(b.accountId));
    item.accounts.forEach((account) => account.bankStatement.evidenceIds.sort());
    item.generalLedger.evidenceIds.sort(); item.blockers.sort(); coverage.push(item);
  }
  const actualJournalLines = (await loadPostedJournalLines(companyId, input.openMonth?.month ?? input.asOfMonth, db)).filter((line) => ["actual", "adjustment", "elimination"].includes(line.basis ?? "actual") && (!line.postingDate || line.postingDate <= now.toISOString().slice(0, 10))).sort((a, b) => a.id.localeCompare(b.id));
  if (actualJournalLines.length > 20_000) throw new GoalReviewError("This review exceeds the initial 20,000 journal-line limit. Narrowing the review scope is not yet supported.", 422);
  const ids = actualJournalLines.map((line) => line.id);
  const lineSources = ids.length ? await db.select({ id: journalLines.id, sourceId: journalLines.sourceId, sourceRowId: journalLines.sourceRowId, evidenceId: journalLines.evidenceId, factId: journalLines.factId, decisionId: journalLines.decisionId, policyId: journalLines.policyId, approvalEventId: journalLines.approvalEventId, sourceLocation: journalLines.sourceLocation }).from(journalLines).where(and(eq(journalLines.companyId, companyId), inArray(journalLines.id, ids))).orderBy(asc(journalLines.id)) : [];
  const evidenceIds = [...new Set([...lineSources.map((line) => line.evidenceId), ...input.drivers.map((driver) => driver.evidenceId), ...coverage.flatMap((item) => [...item.generalLedger.evidenceIds, ...item.accounts.flatMap((account) => account.bankStatement.evidenceIds)])].filter((id): id is string => Boolean(id)))];
  const evidenceRefs = evidenceIds.length ? await db.select({ id: evidence.id, sourceId: evidence.sourceId, name: evidence.sourceName, hash: evidence.sourceHash, status: evidence.status, reportingMonth: evidence.reportingMonth }).from(evidence).where(and(eq(evidence.companyId, companyId), inArray(evidence.id, evidenceIds))).orderBy(asc(evidence.id)) : [];
  const cashCoverage = await loadCashCoverage(db, companyId, actualJournalLines, `${input.asOfMonth}-01`, now.toISOString().slice(0, 10));
  const openingCash = await loadOpeningCash(db, companyId, input.asOfMonth, input.currency, input.actuals.months.find((month) => month.month === input.asOfMonth)?.endingCashMinor ?? "0", actualJournalLines);
  const limitations = [
    ...cashCoverage.accounts.filter((account) => account.state !== "complete").map((account) => `${account.name}: cash source coverage is ${account.state} through ${cashCoverage.throughDate}.`),
    ...openingCash.reasons,
    "The current forecast is monthly. Month-end cash does not establish daily liquidity.",
    ...coverage.flatMap((item) => item.blockers.map((blocker) => `${item.period}: ${blocker}`)),
  ];
  if (!actualJournalLines.length) limitations.push("No posted actual journal activity supports the starting cash balance.");
  if (actualJournalLines.some((line) => line.currency !== input.currency)) limitations.push("Journal activity in another currency requires review; this goal uses the reporting currency only.");
  const outlook: GoalOutlook = jsonCopy({ schemaVersion: 1, companyId, financialStateRevision: company.revision, capturedAt: now.toISOString(), input, output, actualJournalLines, coverage, cashCoverage, openingCash, limitations, lineage: { journalLines: lineSources, evidence: evidenceRefs } });
  if (Buffer.byteLength(JSON.stringify(outlook)) > 8_000_000) throw new GoalReviewError("This review exceeds the initial snapshot size limit.", 422);
  return outlook;
}

export function previewToken(outlook: GoalOutlook) {
  // Knowledge time changes on every read; actual input dates, evidence, and revisions remain in the token.
  const { capturedAt, ...content } = outlook; void capturedAt;
  return hash(content);
}

export async function loadGoalReviewWith(tx: DbExecutor, companyId: string, now = new Date()): Promise<GoalReviewData> {
    const goals = await goalsWith(tx, companyId);
    const [preference] = await tx.select().from(financialReviewPreferences).where(eq(financialReviewPreferences.companyId, companyId));
    const outlook = await captureOutlook(tx, companyId, now);
    // History needs only the evaluation, not up to 50 full journal snapshots.
    const rows = await tx.select({ id: financialReviewSnapshots.id, kind: financialReviewSnapshots.kind, name: financialReviewSnapshots.name, goalVersionId: financialReviewSnapshots.goalVersionId, planId: financialReviewSnapshots.planId, actorUserId: financialReviewSnapshots.actorUserId, createdAt: financialReviewSnapshots.createdAt, evaluation: sql<SavedGoalSnapshot["evaluation"]>`${financialReviewSnapshots.snapshot}->'evaluation'` }).from(financialReviewSnapshots).where(eq(financialReviewSnapshots.companyId, companyId)).orderBy(desc(financialReviewSnapshots.createdAt), desc(financialReviewSnapshots.id)).limit(50);
    const evaluations = Object.fromEntries(goals.map((goal) => [goal.id, evaluateCashGoal(goal.definition, outlook.output, outlook.limitations)]));
    const snapshots: SnapshotSummary[] = rows.map((row) => ({ ...row, kind: row.kind as SnapshotSummary["kind"], createdAt: row.createdAt.toISOString() }));
    const changes = Object.fromEntries(snapshots.map((saved) => [saved.id, evaluations[saved.goalVersionId] ? cashGoalChange(saved.evaluation, evaluations[saved.goalVersionId]!) : null]));
    return { companyId, goals, primaryGoalId: goals.find((goal) => goal.id === preference?.primaryGoalVersionId && goal.status === "active")?.goalId ?? null, preferenceVersion: preference?.version ?? 0, snapshots, outlook: { openingCash: outlook.openingCash, cashCoverage: outlook.cashCoverage, capturedAt: outlook.capturedAt, financialStateRevision: outlook.financialStateRevision, limitations: outlook.limitations, asOfMonth: outlook.input.asOfMonth, horizon: outlook.output.horizon, currency: outlook.input.currency }, previewToken: previewToken(outlook), evaluations, changes, assumptions: outlook.input.drivers, forecastMonths: outlook.output.months };
}
export async function loadGoalReview(companyId: string, now = new Date()): Promise<GoalReviewData> {
  return getDatabase().transaction(async (tx) => { await tx.execute(setCompanyScopeSql(companyId)); return loadGoalReviewWith(tx, companyId, now); }, { isolationLevel: "repeatable read" });
}

/** Inspection is pinned to the preview being approved, including changes without revision bumps. */
export async function inspectGoalOutlook(companyId: string, token: string, now = new Date()) {
  return getDatabase().transaction(async (tx) => {
    await tx.execute(setCompanyScopeSql(companyId));
    const outlook = await captureOutlook(tx, companyId, now);
    if (previewToken(outlook) !== token) throw new GoalReviewError("The outlook changed. Refresh before inspecting or approving it.", 409);
    return outlook;
  }, { isolationLevel: "repeatable read" });
}

export async function loadGoalSnapshot(companyId: string, id: string) {
  const [row] = await getDatabase().select().from(financialReviewSnapshots).where(and(eq(financialReviewSnapshots.companyId, companyId), eq(financialReviewSnapshots.id, id)));
  if (!row) throw new GoalReviewError("Saved review or plan not found.", 404);
  return { ...summary(row), snapshot: row.snapshot as SavedGoalSnapshot };
}

function comparison(baseline: typeof financialReviewSnapshots.$inferSelect, goal: GoalVersion, outlook: GoalOutlook): GoalComparison {
  const snapshot = baseline.snapshot as SavedGoalSnapshot;
  const convert = (version: GoalVersion, view: GoalOutlook, evaluation: SavedGoalSnapshot["evaluation"]) => ({ companyId: view.companyId, goalVersionId: version.id, input: view.input, output: view.output, evaluation, actualJournalLines: view.actualJournalLines, coverage: { coverage: view.coverage, cashCoverage: view.cashCoverage ?? null, limitations: view.limitations } });
  return { baselineId: baseline.id, baselineName: baseline.name, baselineKind: baseline.kind as "plan" | "review", bridge: buildCashGoalBridge(convert(snapshot.goal, snapshot.outlook, snapshot.evaluation), convert(goal, outlook, evaluateCashGoal(goal.definition, outlook.output, outlook.limitations))) };
}

/** A comparison is pinned to the same reviewed preview as a save or input download. */
export async function inspectGoalComparison(companyId: string, baselineId: string, token: string, now = new Date()) {
  return getDatabase().transaction(async (tx) => {
    await tx.execute(setCompanyScopeSql(companyId));
    const [baseline] = await tx.select().from(financialReviewSnapshots).where(and(eq(financialReviewSnapshots.companyId, companyId), eq(financialReviewSnapshots.id, baselineId)));
    if (!baseline) throw new GoalReviewError("Saved comparison baseline not found.", 404);
    const goal = (await goalsWith(tx, companyId)).find((item) => item.id === baseline.goalVersionId);
    if (!goal) throw new GoalReviewError("This baseline uses an earlier goal version. Select a baseline for the current goal version.", 409);
    const outlook = await captureOutlook(tx, companyId, now);
    if (previewToken(outlook) !== token) throw new GoalReviewError("The outlook changed. Refresh before comparing it.", 409);
    return { companyId, previewToken: token, ...comparison(baseline, goal, outlook) };
  }, { isolationLevel: "repeatable read" });
}

async function writeGoal(tx: DbTransaction, companyId: string, command: Extract<GoalReviewCommand, { action: "create_goal" | "revise_goal" }>, actorUserId: string | null) {
  const [company] = await tx.select({ currency: companies.baseCurrency }).from(companies).where(eq(companies.id, companyId));
  if (!company) throw new GoalReviewError("Company not found.", 404);
  if (command.definition.currency !== company.currency) throw new GoalReviewError("Use the company's reporting currency.");
  let goalId: string = randomUUID(); let nextVersion = 1;
  if (command.action === "revise_goal") {
    const [current] = await tx.select().from(cashGoalVersions).where(and(eq(cashGoalVersions.companyId, companyId), eq(cashGoalVersions.goalId, command.goalId))).orderBy(desc(cashGoalVersions.version)).limit(1);
    if (!current) throw new GoalReviewError("Goal not found.", 404);
    if (current.version !== command.expectedVersion) throw new GoalReviewError("The goal changed. Refresh before revising it.", 409);
    goalId = command.goalId; nextVersion = current.version + 1;
  }
  // Management metadata serializes a concurrent reviewed financial approval without changing the financial revision.
  await tx.update(companies).set({ updatedAt: new Date() }).where(eq(companies.id, companyId));
  const [row] = await tx.insert(cashGoalVersions).values({ companyId, goalId, version: nextVersion, status: command.status, definition: command.definition, reason: command.reason, actorUserId }).returning();
  if (command.action === "revise_goal") {
    const versions = await tx.select({ id: cashGoalVersions.id }).from(cashGoalVersions).where(and(eq(cashGoalVersions.companyId, companyId), eq(cashGoalVersions.goalId, goalId)));
    await tx.update(financialReviewPreferences).set({ primaryGoalVersionId: command.status === "active" ? row!.id : null, version: sql`${financialReviewPreferences.version} + 1`, actorUserId, updatedAt: new Date() }).where(and(eq(financialReviewPreferences.companyId, companyId), inArray(financialReviewPreferences.primaryGoalVersionId, versions.map((item) => item.id))));
  }
  await recordAudit(tx, { companyId, actorUserId, via: "ui", action: "goal.version_created", entityType: "cash_goal", entityId: goalId, summary: `Saved goal version ${nextVersion}: ${command.definition.name}`, after: { versionId: row!.id, reason: command.reason } });
  return { goal: version(row!) };
}

export async function executeGoalReviewCommand(companyId: string, raw: unknown, actorUserId: string | null, now = new Date()) {
  const parsed = goalReviewCommand.safeParse(raw);
  if (!parsed.success) throw new GoalReviewError("Invalid goal or review request. Check dates, amounts, and required fields.");
  const command = parsed.data;
  return getDatabase().transaction(async (tx) => {
    await tx.execute(setCompanyScopeSql(companyId));
    // Serializes goal revisions and retries without sharing the forecast-job lock.
    await tx.execute(sql`select pg_advisory_xact_lock(7405, hashtext(${companyId}))`);
    if (command.action === "set_primary_goal") {
      const [current] = await tx.select().from(financialReviewPreferences).where(eq(financialReviewPreferences.companyId, companyId));
      if ((current?.version ?? 0) !== command.expectedVersion) throw new GoalReviewError("The primary goal selection changed. Refresh before saving.", 409);
      const goal = command.goalId ? (await goalsWith(tx, companyId)).find((item) => item.goalId === command.goalId && item.status === "active") : null;
      if (command.goalId && !goal) throw new GoalReviewError("Active goal not found for this company.", 404);
      const values = { companyId, primaryGoalVersionId: goal?.id ?? null, version: (current?.version ?? 0) + 1, actorUserId, updatedAt: now };
      if (current) await tx.update(financialReviewPreferences).set(values).where(eq(financialReviewPreferences.companyId, companyId));
      else await tx.insert(financialReviewPreferences).values(values);
      await recordAudit(tx, { companyId, actorUserId, via: "ui", action: "goal.primary_selected", entityType: "financial_review_preferences", entityId: companyId, summary: "Changed the primary review goal", before: current ?? null, after: values });
      return { primaryGoalId: goal?.goalId ?? null, preferenceVersion: values.version };
    }
    if (command.action !== "save_snapshot") return writeGoal(tx, companyId, command, actorUserId);
    const requestHash = hash(command);
    const [existing] = await tx.select().from(financialReviewSnapshots).where(and(eq(financialReviewSnapshots.companyId, companyId), eq(financialReviewSnapshots.requestKey, command.requestKey)));
    if (existing) {
      if (existing.requestHash !== requestHash) throw new GoalReviewError("This request key was already used for different content.", 409);
      return { saved: summary(existing), reused: true };
    }
    const goal = (await goalsWith(tx, companyId)).find((item) => item.id === command.goalVersionId);
    if (!goal) throw new GoalReviewError("The goal version changed or is unavailable. Refresh before saving.", 409);
    if (goal.status !== "active") throw new GoalReviewError("An inactive goal cannot receive a new plan or review.", 409);
    let planBaseline: typeof financialReviewSnapshots.$inferSelect | undefined;
    if (command.kind === "review") {
      if (!command.planId) throw new GoalReviewError("Choose a saved plan for this review.");
      const [plan] = await tx.select().from(financialReviewSnapshots).where(and(eq(financialReviewSnapshots.companyId, companyId), eq(financialReviewSnapshots.id, command.planId), eq(financialReviewSnapshots.kind, "plan"), eq(financialReviewSnapshots.goalVersionId, goal.id)));
      if (!plan) throw new GoalReviewError("Plan not found for this company and goal version.", 404);
      planBaseline = plan;
    } else if (command.planId) throw new GoalReviewError("A plan cannot reference another plan.");
    const outlook = await captureOutlook(tx, companyId, now);
    if (previewToken(outlook) !== command.previewToken) throw new GoalReviewError("The outlook changed. Refresh and review it before saving.", 409);
    const evaluation = evaluateCashGoal(goal.definition, outlook.output, outlook.limitations);
    if (evaluation.outcome === "unavailable") throw new GoalReviewError("This goal cannot be evaluated within the available forecast. Revise its dates or currency.", 422);
    const run = await persistForecastRun({ companyId, financialStateRevision: outlook.financialStateRevision, input: outlook.input, run: outlook.output }, tx);
    const snapshot: SavedGoalSnapshot = { goal, outlook, evaluation, calculationRunId: run.id, acknowledgedLimitations: true };
    if (planBaseline) {
      const [previous] = await tx.select().from(financialReviewSnapshots).where(and(eq(financialReviewSnapshots.companyId, companyId), eq(financialReviewSnapshots.kind, "review"), eq(financialReviewSnapshots.planId, planBaseline.id), eq(financialReviewSnapshots.goalVersionId, goal.id))).orderBy(desc(financialReviewSnapshots.createdAt), desc(financialReviewSnapshots.id)).limit(1);
      snapshot.comparisons = { plan: comparison(planBaseline, goal, outlook), ...(previous ? { previousReview: comparison(previous, goal, outlook) } : {}) };
    }
    if (Buffer.byteLength(JSON.stringify(snapshot)) > 8_000_000) throw new GoalReviewError("This review and its change explanation exceed the initial snapshot size limit.", 422);
    const [row] = await tx.insert(financialReviewSnapshots).values({ companyId, goalVersionId: goal.id, planId: command.planId ?? null, kind: command.kind, name: command.name, requestKey: command.requestKey, requestHash, snapshot, actorUserId }).returning();
    await recordAudit(tx, { companyId, actorUserId, via: "ui", action: `goal.${command.kind}_saved`, entityType: "financial_review_snapshot", entityId: row!.id, summary: `Saved ${command.kind}: ${command.name}`, after: { goalVersionId: goal.id, planId: command.planId ?? null, calculationRunId: run.id, acknowledgedLimitations: true } });
    return { saved: summary(row!), reused: false };
  }, { isolationLevel: "repeatable read" });
}
