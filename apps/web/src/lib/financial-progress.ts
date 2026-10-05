import "server-only";
import { buildCashExplorer } from "./cash-explorer";
import { recognitionJournalHash } from "./recognition-continuity";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { chartAccounts, journalEntries, recognitionJournalLinks, decisions, evidence, financialReviewSnapshots, forecastReviewCommands, getDatabase, goalDecisionReviews, recordAudit, setCompanyScopeSql } from "@finance/database";
import { buildWeeklyCash, buildCashGoalBridge, buildForecastRun, evaluateCashGoal, isValidMonth, stableJson, summarizeActualCash } from "@balsa/finance-engine";
import { captureOutlook, GoalReviewError, loadGoalReviewWith, previewToken } from "./goal-reviews";
import type { GoalOutlook, SavedGoalSnapshot } from "./goal-review-contract";
import { loadForecastReconciliationWith } from "./forecast-reconciliation";
import { createScenarioWith } from "./scenarios";
import { lockScenarioName } from "./scenario-name-lock";
import { parseScenarioChange } from "./scenario-changes";
import { enqueueCalculationRefreshWith, processEnqueuedCalculationRefresh } from "./refresh-calculation-run";
import type { DbExecutor } from "./db-executor";

const hash = (value: unknown) => createHash("sha256").update(stableJson(value)).digest("hex");
export async function loadFinancialProgress(companyId: string, now = new Date()) {
  return getDatabase().transaction(async (tx) => {
    await tx.execute(setCompanyScopeSql(companyId));
    const review = await loadGoalReviewWith(tx, companyId, now);
    const outlook = await captureOutlook(tx, companyId, now);
    const reconciliation = await loadForecastReconciliationWith(tx, companyId, now);
    const primary = review.goals.find((goal) => goal.goalId === review.primaryGoalId) ?? review.goals.find((goal) => goal.status === "active") ?? null;
    const [plan] = primary ? await tx.select({ id: financialReviewSnapshots.id }).from(financialReviewSnapshots).where(and(eq(financialReviewSnapshots.companyId, companyId), eq(financialReviewSnapshots.goalVersionId, primary.id), eq(financialReviewSnapshots.kind, "plan"))).orderBy(desc(financialReviewSnapshots.createdAt), desc(financialReviewSnapshots.id)).limit(1) : [];
    const [lastReview] = plan ? await tx.select({ id: financialReviewSnapshots.id }).from(financialReviewSnapshots).where(and(eq(financialReviewSnapshots.companyId, companyId), eq(financialReviewSnapshots.planId, plan.id), eq(financialReviewSnapshots.kind, "review"))).orderBy(desc(financialReviewSnapshots.createdAt), desc(financialReviewSnapshots.id)).limit(1) : [];
    const baselines = [plan, lastReview].filter((value) => value != null);
    const saved = baselines.length ? await tx.select().from(financialReviewSnapshots).where(and(eq(financialReviewSnapshots.companyId, companyId), inArray(financialReviewSnapshots.id, baselines.map((item) => item.id)))) : [];
    const comparisons = primary ? saved.map((row) => { const snapshot = row.snapshot as SavedGoalSnapshot; return { id: row.id, name: row.name, kind: row.kind, bridge: buildCashGoalBridge({ companyId, goalVersionId: primary.id, input: snapshot.outlook.input, output: snapshot.outlook.output, actualJournalLines: snapshot.outlook.actualJournalLines, evaluation: snapshot.evaluation, coverage: { cash: snapshot.outlook.cashCoverage, limitations: snapshot.outlook.limitations } }, { companyId, goalVersionId: primary.id, input: outlook.input, output: outlook.output, actualJournalLines: outlook.actualJournalLines, evaluation: evaluateCashGoal(primary.definition, outlook.output, outlook.limitations), coverage: { cash: outlook.cashCoverage, limitations: outlook.limitations } }) }; }) : [];
    const recognitionLinks = await tx.select({ id: recognitionJournalLinks.id, driverId: recognitionJournalLinks.driverId, entryId: recognitionJournalLinks.entryId, version: recognitionJournalLinks.version, reason: recognitionJournalLinks.reason }).from(recognitionJournalLinks).where(and(eq(recognitionJournalLinks.companyId, companyId), eq(recognitionJournalLinks.revoked, false)));
    const recognition = { drivers: outlook.input.drivers.filter((driver) => driver.accountingTreatment && driver.accountingTreatment !== "cash"), links: recognitionLinks, proofs: outlook.input.recognitionProofs ?? [], exceptions: outlook.output.exceptions, entries: [...new Set(outlook.actualJournalLines.filter((line) => line.period <= outlook.input.asOfMonth && (line.basis ?? "actual") === "actual").flatMap((line) => line.entryId ? [line.entryId] : []))].map((id) => ({ id, lines: outlook.actualJournalLines.filter((line) => line.entryId === id) })) };
    const recentDecisions = await tx.select({ id: goalDecisionReviews.id, name: goalDecisionReviews.name, kind: goalDecisionReviews.kind, createdAt: goalDecisionReviews.createdAt }).from(goalDecisionReviews).where(eq(goalDecisionReviews.companyId, companyId)).orderBy(desc(goalDecisionReviews.createdAt)).limit(10);
    const actions: { id: string; title: string; detail: string; href: string; priority: number }[] = [];
    if (outlook.openingCash?.status !== "reconciled") actions.push({ id: "opening", title: "Reconcile starting cash", detail: `${outlook.openingCash?.reasons.length ?? 1} opening-balance controls need attention.`, href: "#starting-cash", priority: 0 });
    for (const account of reconciliation.coverage.accounts.filter((item) => item.state !== "complete")) actions.push({ id: `coverage:${account.id}`, title: `Review ${account.name} coverage`, detail: `Coverage is ${account.state}; complete through ${account.coveredThrough ?? "no confirmed date"}.`, href: "/reconciliation#coverage", priority: 1 });
    for (const result of reconciliation.results.filter((item) => item.overdue && item.state !== "settled" && item.state !== "cancelled")) { const occurrence = reconciliation.settlement.occurrences.find((item) => item.id === result.id)!; actions.push({ id: result.id, title: occurrence.label, detail: `Expected ${occurrence.expectedDate}; ${outlook.input.currency} ${(BigInt(result.remainingMinor) / 100n).toLocaleString("en-US")}.${String(BigInt(result.remainingMinor) % 100n).padStart(2, "0")} remains outstanding.`, href: `/reconciliation#occurrence-${result.id}`, priority: 2 }); }
    for (const exception of reconciliation.exceptions) actions.push({ id: `exception:${exception.driverId}:${exception.reason}`, title: "Resolve a forecast exception", detail: exception.reason, href: "/reconciliation", priority: 1 });
    if (!primary) actions.push({ id: "goal", title: "Set an active cash goal", detail: "Draft a goal and activate it when its dates and constraints are ready.", href: "/goals", priority: 2 });
    else if (!plan) actions.push({ id: "plan", title: "Preserve a plan for this goal", detail: "Review the current assumptions and approve a baseline.", href: "/goals", priority: 2 });
    const steps = [
      { id: "evidence", title: "Bring in financial evidence", complete: outlook.actualJournalLines.length > 0 || outlook.openingCash?.status === "reconciled", detail: "Import and approve the statements supporting your starting position.", href: "/" },
      { id: "opening", title: "Reconcile starting cash", complete: outlook.openingCash?.status === "reconciled", detail: outlook.openingCash?.status === "reconciled" ? "Every starting cash account ties to reviewed evidence." : "Resolve missing mappings, balances and conflicting statements.", href: "#starting-cash" },
      { id: "coverage", title: "Review current activity coverage", complete: reconciliation.coverage.accounts.length > 0 && reconciliation.coverage.accounts.every((item) => item.state === "complete"), detail: "Confirm the dates covered by each cash account, including zero-activity periods.", href: "/reconciliation#coverage" },
      { id: "expectations", title: "Review upcoming and outstanding cash", complete: !reconciliation.candidates.some((item) => !item.capturedOccurrenceId) && !reconciliation.exceptions.length && !reconciliation.results.some((item) => item.overdue && item.state !== "settled" && item.state !== "cancelled"), detail: "Resolve proposed estimates, stale schedules and overdue obligations.", href: "/reconciliation" },
      { id: "goal", title: "Choose your primary goal", complete: !!review.primaryGoalId, detail: "Activate a cash goal with a target, dates and any manual conditions.", href: "/goals" },
      { id: "plan", title: "Preserve your first plan", complete: !!plan, detail: "Review assumptions and limitations, then save the baseline you will compare against.", href: "/goals" },
    ];
    const guide = { steps, nextStepId: steps.find((step) => !step.complete)?.id ?? null, completed: steps.filter((step) => step.complete).length, total: steps.length };
    const priorOverdueLines = reconciliation.settlement.occurrences.flatMap((item) => {
      const result = reconciliation.results.find((row) => row.id === item.id);
      if (!result?.overdue || result.remainingMinor === "0" || outlook.output.projectedLines.some((line) => line.entryId === `expectation:${item.id}`)) return [];
      return item.lines.map((line, index) => ({ ...line, id: `weekly-overdue:${item.id}:${index}`, entryId: `expectation:${item.id}`, postingDate: item.expectedDate, debitMinor: BigInt(line.debitMinor) > 0n ? result.remainingMinor : "0", creditMinor: BigInt(line.creditMinor) > 0n ? result.remainingMinor : "0" }));
    });
    const weekly = buildWeeklyCash({ throughDate: now.toISOString().slice(0, 10), currency: outlook.input.currency, actualLines: outlook.actualJournalLines, projectedLines: [...outlook.output.projectedLines, ...priorOverdueLines], reviewedEntryIds: reconciliation.settlement.occurrences.flatMap((item) => [item.key, `expectation:${item.id}`]), limitations: [...outlook.limitations.filter((item) => !item.includes("monthly. Month-end")), ...outlook.output.exceptions.map((item) => item.reason)], minimumCashMinor: outlook.input.minimumCashMinor });
    const current = summarizeActualCash(outlook.actualJournalLines, outlook.input.currency, now.toISOString().slice(0, 7)).months.at(-1)!;
    return { companyId, cashExplorer: buildCashExplorer(outlook.input, outlook.output, outlook.actualJournalLines, outlook.limitations), review, guide, weekly, recognition, primaryGoalVersionId: primary?.id ?? null, planId: plan?.id ?? null, comparisons, actualCashMinor: current.endingCashMinor, throughDate: now.toISOString().slice(0, 10), actions: actions.sort((a, b) => a.priority - b.priority), recentDecisions: recentDecisions.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })) };
  }, { isolationLevel: "repeatable read" });
}

async function monthInspection(db: DbExecutor, companyId: string, outlook: GoalOutlook, month: string) {
  const row = outlook.output.months.find((item) => item.month === month);
  if (!row) throw new GoalReviewError("Month is outside this outlook.", 404);
  const actuals = outlook.actualJournalLines.filter((line) => line.period === month);
  const projected = outlook.output.projectedLines.filter((line) => line.period === month);
  const lineage = outlook.lineage.journalLines as { id: string; evidenceId: string | null; sourceRowId: string | null; decisionId: string | null; sourceLocation: string | null }[];
  const supportingIds = new Set(outlook.input.settlement?.occurrences.filter((item) => item.expectedDate.slice(0, 7) === month || item.originalMonth === month).flatMap((item) => item.sourceLineIds) ?? []);
  const openingLines = outlook.actualJournalLines.filter((line) => line.period < month);
  const historyLines = outlook.actualJournalLines.filter((line) => supportingIds.has(line.id));
  const references = lineage.filter((item) => [...actuals, ...openingLines, ...historyLines].some((line) => line.id === item.id));
  const drivers = outlook.input.drivers.filter((driver) => row.driverIds.includes(driver.id) || projected.some((line) => line.entryId?.includes(driver.id)));
  const evidenceIds = [...new Set([...references.map((item) => item.evidenceId), ...drivers.map((item) => item.evidenceId)])].filter((id): id is string => !!id);
  const decisionIds = [...new Set([...references.map((item) => item.decisionId), ...drivers.map((item) => item.decisionId), ...projected.map((line) => line.provenance?.decisionId)])].filter((id): id is string => !!id);
  const documents = evidenceIds.length ? await db.select({ id: evidence.id, name: evidence.sourceName, sourceId: evidence.sourceId, status: evidence.status, hash: evidence.sourceHash }).from(evidence).where(and(eq(evidence.companyId, companyId), inArray(evidence.id, evidenceIds))) : [];
  const decisionRows = decisionIds.length ? await db.select({ id: decisions.id, question: decisions.question, answer: decisions.answer, status: decisions.status }).from(decisions).where(and(eq(decisions.companyId, companyId), inArray(decisions.id, decisionIds))) : [];
  const expectations = outlook.input.settlement?.occurrences.filter((item) => item.expectedDate.slice(0, 7) === month || item.originalMonth === month).map((item) => ({ ...item, result: outlook.output.settlements?.find((result) => result.id === item.id) })) ?? [];
  return { companyId, month: row, formulaVersion: outlook.output.formulaVersion, nodes: outlook.output.nodes.filter((node) => node.month === month), openingLines, historyLines, actuals, projected, expectations, drivers, documents, decisions: decisionRows, lineage: references, limitations: outlook.limitations };
}
export async function inspectFinancialMonth(companyId: string, month: string, token: string, now = new Date()) {
  if (!isValidMonth(month)) throw new GoalReviewError("Use a valid month.");
  return getDatabase().transaction(async (tx) => {
    await tx.execute(setCompanyScopeSql(companyId)); const outlook = await captureOutlook(tx, companyId, now);
    if (previewToken(outlook) !== token) throw new GoalReviewError("The outlook changed. Refresh before inspecting or correcting it.", 409);
    return monthInspection(tx, companyId, outlook, month);
  }, { isolationLevel: "repeatable read" });
}
const identity = { previewToken: z.string().regex(/^[a-f0-9]{64}$/), requestKey: z.uuid(), reason: z.string().trim().min(1).max(2000) };
const correction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview_recognition"), driverId: z.uuid(), entryIds: z.array(z.uuid()).min(1).max(100), ...identity }).strict(),
  z.object({ action: z.literal("link_recognition"), driverId: z.uuid(), entryIds: z.array(z.uuid()).min(1).max(100), ...identity }).strict(),
  z.object({ action: z.literal("unlink_recognition"), linkId: z.uuid(), expectedVersion: z.number().int().positive(), ...identity }).strict(),
  z.object({ action: z.literal("map_cash_account"), accountId: z.uuid(), evidenceId: z.uuid(), ...identity }).strict(),
  z.object({ action: z.literal("draft_driver_change"), driverId: z.uuid(), amount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/), from: z.string().refine(isValidMonth), name: z.string().trim().min(1).max(120), ...identity }).strict(),
]);
export async function correctFinancialProgress(companyId: string, raw: unknown, actorUserId: string | null, now = new Date()) {
  const parsed = correction.safeParse(raw); if (!parsed.success) throw new GoalReviewError("Invalid correction. Check the amount, month, evidence and reason.");
  const command = parsed.data;
  const committed = await getDatabase().transaction(async (tx) => {
    await tx.execute(setCompanyScopeSql(companyId)); await tx.execute(sql`select pg_advisory_xact_lock(7406, hashtext(${companyId}))`);
    const requestHash = hash(command);
    const [prior] = await tx.select().from(forecastReviewCommands).where(and(eq(forecastReviewCommands.companyId, companyId), eq(forecastReviewCommands.requestKey, command.requestKey)));
    if (prior) { if (prior.requestHash !== requestHash) throw new GoalReviewError("Request key already used for another correction.", 409); return { result: prior.result, receipt: null }; }
    const outlook = await captureOutlook(tx, companyId, now);
    if (previewToken(outlook) !== command.previewToken) throw new GoalReviewError("The outlook changed. Refresh before correcting it.", 409);
    let result: object; let receipt = null;
    if (command.action === "preview_recognition" || command.action === "link_recognition") {
      const driver = outlook.input.drivers.find((item) => item.id === command.driverId && item.accountingTreatment && item.accountingTreatment !== "cash");
      if (!driver) throw new GoalReviewError("Recognition schedule not found for this company.", 404);
      if (new Set(command.entryIds).size !== command.entryIds.length) throw new GoalReviewError("Select each journal once.");
      const selected = command.entryIds.map((entryId) => ({ entryId, lines: outlook.actualJournalLines.filter((line) => line.entryId === entryId) }));
      if (selected.some((item) => !item.lines.length || item.lines.some((line) => line.period > outlook.input.asOfMonth || !["actual", "adjustment"].includes(line.basis ?? "actual")))) throw new GoalReviewError("Choose posted actual journals through the opening boundary.", 422);
      const existing = await tx.select().from(recognitionJournalLinks).where(and(eq(recognitionJournalLinks.companyId, companyId), eq(recognitionJournalLinks.revoked, false)));
      if (existing.some((link) => command.entryIds.includes(link.entryId) && link.driverId !== driver.id)) throw new GoalReviewError("A journal is already assigned to another recognition schedule.", 409);
      const entries = await tx.select({ id: journalEntries.id, reversalOf: journalEntries.reversalOfEntryId }).from(journalEntries).where(and(eq(journalEntries.companyId, companyId), eq(journalEntries.status, "posted")));
      if (entries.some((entry) => entry.reversalOf && (command.entryIds.includes(entry.id) || command.entryIds.includes(entry.reversalOf)))) throw new GoalReviewError("Reversed journals cannot support recognition continuity.", 422);
      const linkedIds = new Set(command.entryIds);
      const proof = { driverId: driver.id, throughMonth: outlook.input.asOfMonth, currency: outlook.input.currency, lines: outlook.actualJournalLines.filter((line) => linkedIds.has(line.entryId ?? "")), valid: true };
      const input = { ...outlook.input, recognitionProofs: [...(outlook.input.recognitionProofs ?? []).filter((item) => item.driverId !== driver.id), proof] };
      const output = buildForecastRun(input); const blockers = output.exceptions.filter((item) => item.driverId === driver.id).map((item) => item.reason);
      if (command.action === "preview_recognition") return { result: { companyId, driverId: driver.id, blockers, before: outlook.output.months, after: output.months, projectedLines: output.projectedLines.filter((line) => line.provenance?.sourceLocation === `forecast-driver:${driver.id}`), proof }, receipt: null };
      if (blockers.length) throw new GoalReviewError(blockers.join(" "), 422);
      for (const link of existing.filter((item) => item.driverId === driver.id && !linkedIds.has(item.entryId))) await tx.update(recognitionJournalLinks).set({ revoked: true, version: link.version + 1, updatedAt: now }).where(and(eq(recognitionJournalLinks.companyId, companyId), eq(recognitionJournalLinks.id, link.id)));
      for (const selectedEntry of selected) {
        const prior = existing.find((link) => link.entryId === selectedEntry.entryId);
        const values = { sourceHash: recognitionJournalHash(selectedEntry.lines), reason: command.reason, actorUserId };
        if (prior) await tx.update(recognitionJournalLinks).set({ ...values, version: prior.version + 1, updatedAt: now }).where(and(eq(recognitionJournalLinks.companyId, companyId), eq(recognitionJournalLinks.id, prior.id)));
        else await tx.insert(recognitionJournalLinks).values({ companyId, driverId: driver.id, entryId: selectedEntry.entryId, ...values });
      }
      await recordAudit(tx, { companyId, actorUserId, via: "ui", action: "recognition.continuity_reviewed", entityType: "economic_item", entityId: driver.id, summary: command.reason, after: { entryIds: [...linkedIds], proof }, requestId: command.requestKey });
      receipt = await enqueueCalculationRefreshWith(tx, companyId, { cause: { kind: "coverage_reviewed", subjectType: "economic_item", subjectId: driver.id, actorUserId, via: "ui" } });
      result = { linked: true, driverId: driver.id };
    } else if (command.action === "unlink_recognition") {
      const [link] = await tx.select().from(recognitionJournalLinks).where(and(eq(recognitionJournalLinks.companyId, companyId), eq(recognitionJournalLinks.id, command.linkId)));
      if (!link) throw new GoalReviewError("Recognition link not found.", 404);
      if (link.version !== command.expectedVersion || link.revoked) throw new GoalReviewError("Recognition link changed. Refresh before correcting it.", 409);
      await tx.update(recognitionJournalLinks).set({ revoked: true, version: link.version + 1, updatedAt: now }).where(and(eq(recognitionJournalLinks.companyId, companyId), eq(recognitionJournalLinks.id, link.id)));
      await recordAudit(tx, { companyId, actorUserId, via: "ui", action: "recognition.link_revoked", entityType: "recognition_journal_link", entityId: link.id, summary: command.reason, before: link, requestId: command.requestKey });
      receipt = await enqueueCalculationRefreshWith(tx, companyId, { cause: { kind: "coverage_reviewed", subjectType: "economic_item", subjectId: link.driverId, actorUserId, via: "ui" } });
      result = { revoked: true };
    } else if (command.action === "map_cash_account") {
      const account = outlook.openingCash?.inputs.accounts.find((item) => item.accountId === command.accountId);
      const statement = outlook.openingCash?.inputs.statements.find((item) => item.id === command.evidenceId);
      if (!account || !outlook.openingCash?.accounts.some((item) => item.accountId === account.accountId) || !statement) throw new GoalReviewError("Cash account or boundary evidence not found for this company.", 404);
      if (!(statement.endDate === outlook.openingCash?.boundary || statement.startDate === outlook.openingCash?.startDate) || statement.status !== "approved" || statement.identityStatus !== "approved" || !statement.accountIdentifier || statement.currency !== outlook.input.currency || statement.entityId !== account.entityId || !["bank_statement", "brokerage_statement"].includes(statement.kind)) throw new GoalReviewError("Choose identity-approved bank evidence in the same currency and entity scope.", 422);
      const before = account.bankAccountIdentifier;
      await tx.update(chartAccounts).set({ bankAccountIdentifier: statement.accountIdentifier, updatedAt: now }).where(and(eq(chartAccounts.companyId, companyId), eq(chartAccounts.id, account.accountId)));
      await recordAudit(tx, { companyId, actorUserId, via: "ui", action: "cash_account.mapping_reviewed", entityType: "chart_account", entityId: account.accountId, summary: command.reason, before: { bankAccountIdentifier: before }, after: { bankAccountIdentifier: statement.accountIdentifier, evidenceId: statement.id }, requestId: command.requestKey });
      receipt = await enqueueCalculationRefreshWith(tx, companyId, { rebuildJournalGraphs: false, cause: { kind: "coverage_reviewed", subjectType: "chart_account", subjectId: account.accountId, actorUserId, via: "ui" } });
      result = { mapped: true, accountId: account.accountId };
    } else {
      const driver = outlook.input.drivers.find((item) => item.id === command.driverId);
      if (!driver) throw new GoalReviewError("Forecast driver not found for this company.", 404);
      if (driver.amountFormula) throw new GoalReviewError("This driver uses a formula. Review its model inputs or formula in a scenario instead of changing its display amount.", 422);
      if (command.from < outlook.output.horizon.start || command.from > outlook.output.horizon.end) throw new GoalReviewError("Choose an effective month within the current forecast horizon.");
      const change = parseScenarioChange({ kind: "change_amount", itemId: driver.id, amount: Number(command.amount), effectiveFrom: command.from });
      if (!change) throw new GoalReviewError("This amount cannot be represented safely by the scenario engine.");
      await lockScenarioName(tx, companyId, command.name);
      const scenario = await createScenarioWith(tx, companyId, { name: command.name, description: command.reason, changes: [change] }, actorUserId, now);
      result = { scenarioId: scenario.id, name: scenario.name };
    }
    await tx.insert(forecastReviewCommands).values({ companyId, requestKey: command.requestKey, requestHash, result });
    return { result, receipt };
  }, { isolationLevel: "repeatable read" });
  if (committed.receipt) await processEnqueuedCalculationRefresh(committed.receipt, now);
  return committed.result;
}
