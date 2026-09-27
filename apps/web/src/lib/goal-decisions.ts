import "server-only";
import { attributeDecision } from "./decision-attribution";
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { decisions, economicItems, financialReviewSnapshots, getDatabase, goalDecisionReviews, recordAudit, scenarios, setCompanyScopeSql } from "@finance/database";
import { buildCashGoalBridge, buildForecastRun, cashGoalChange, evaluateCashGoal, stableJson } from "@nevermodel/finance-engine";
import { captureOutlook, GoalReviewError, goalsWith } from "./goal-reviews";
import { loadActiveScenarioWith, promoteScenarioWith } from "./scenarios";
import { applyScenarioChanges, parseScenarioChanges } from "./scenario-changes";
import { loadScenarioDriversWith } from "./forecast-scenarios";
import { loadRecurrenceReview } from "./forecast-recurrence";
import { applyDecisionIfEffectiveWith } from "./decision-effects";
import { enqueueCalculationRefreshWith, processEnqueuedCalculationRefresh, type CalculationRefreshReceipt } from "./refresh-calculation-run";
import { decisionSelection, goalDecisionCommand, type DecisionSelection, type GoalDecisionHistory, type GoalDecisionOutcome, type GoalDecisionPreview, type GoalDecisionSnapshot } from "./goal-decisions-contract";
import type { DbExecutor } from "./db-executor";

const hash = (value: unknown) => createHash("sha256").update(stableJson(value)).digest("hex");
const history = (row: Omit<typeof goalDecisionReviews.$inferSelect, "snapshot" | "requestKey" | "requestHash" | "previewToken" | "actorUserId" | "companyId" | "planId" >): GoalDecisionHistory => ({ id: row.id, name: row.name, kind: row.kind, scenarioId: row.scenarioId, goalVersionId: row.goalVersionId, parentId: row.parentId, createdAt: row.createdAt.toISOString() });
const withoutTime = <T extends { capturedAt: string }>(value: T) => { const { capturedAt, ...rest } = value; void capturedAt; return rest; };

export async function loadGoalDecisionWorkspace(companyId: string) {
  return getDatabase().transaction(async (tx) => {
    await tx.execute(setCompanyScopeSql(companyId));
    const [goals, plans, choices, reviews] = await Promise.all([
      goalsWith(tx, companyId),
      tx.select({ id: financialReviewSnapshots.id, name: financialReviewSnapshots.name, goalVersionId: financialReviewSnapshots.goalVersionId }).from(financialReviewSnapshots).where(and(eq(financialReviewSnapshots.companyId, companyId), eq(financialReviewSnapshots.kind, "plan"))).orderBy(desc(financialReviewSnapshots.createdAt)).limit(50),
      tx.select({ id: scenarios.id, name: scenarios.name, description: scenarios.description }).from(scenarios).where(and(eq(scenarios.companyId, companyId), eq(scenarios.active, "Y"))),
      tx.select({ id: goalDecisionReviews.id, name: goalDecisionReviews.name, kind: goalDecisionReviews.kind, scenarioId: goalDecisionReviews.scenarioId, goalVersionId: goalDecisionReviews.goalVersionId, parentId: goalDecisionReviews.parentId, createdAt: goalDecisionReviews.createdAt }).from(goalDecisionReviews).where(eq(goalDecisionReviews.companyId, companyId)).orderBy(desc(goalDecisionReviews.createdAt), desc(goalDecisionReviews.id)).limit(50),
    ]);
    return { companyId, goals: goals.filter((goal) => goal.status === "active"), plans, scenarios: choices, reviews: reviews.map(history) };
  }, { isolationLevel: "repeatable read" });
}

export async function previewGoalDecisionWith(db: DbExecutor, companyId: string, selection: DecisionSelection, now: Date): Promise<GoalDecisionPreview> {
  const scenario = await loadActiveScenarioWith(db, companyId, selection.scenarioId);
  const [rawScenario] = await db.select({ changes: scenarios.changes }).from(scenarios).where(and(eq(scenarios.companyId, companyId), eq(scenarios.id, scenario.id)));
  if (!parseScenarioChanges(rawScenario?.changes)) throw new GoalReviewError("This scenario contains unsupported legacy changes. Review its complete change list first.", 422);
  const goals = (await goalsWith(db, companyId)).filter((goal) => goal.status === "active").sort((a, b) => a.id.localeCompare(b.id));
  if (goals.length > 20) throw new GoalReviewError("This review supports up to 20 active cash goals.", 422);
  const [plan] = await db.select({ id: financialReviewSnapshots.id, goalVersionId: financialReviewSnapshots.goalVersionId }).from(financialReviewSnapshots).where(and(eq(financialReviewSnapshots.companyId, companyId), eq(financialReviewSnapshots.id, selection.planId), eq(financialReviewSnapshots.kind, "plan")));
  if (!plan) throw new GoalReviewError("Approved plan not found for this company.", 404);
  if (!goals.some((goal) => goal.id === plan.goalVersionId)) throw new GoalReviewError("The plan's goal version is no longer active. Approve a baseline for the current goal first.", 409);
  const base = await captureOutlook(db, companyId, now);
  const { drivers } = await loadScenarioDriversWith(db, companyId, scenario.id);
  const scenarioInput = applyScenarioChanges({ ...base.input, drivers: [...base.input.drivers, ...drivers] }, scenario.changes, scenario.id);
  scenarioInput.recurrence = (await loadRecurrenceReview(db, companyId, scenarioInput, now.toISOString().slice(0, 10), new Set(scenarioInput.settlement?.occurrences.map((item) => item.key) ?? []))).states;
  const scenarioRun = buildForecastRun(scenarioInput);
  const evaluations = goals.map((goal) => { const before = evaluateCashGoal(goal.definition, base.output, base.limitations); const after = evaluateCashGoal(goal.definition, scenarioRun, base.limitations); return { goalVersionId: goal.id, before, after, deltaMinor: cashGoalChange(before, after) }; });
  const conditions = goals.flatMap((goal) => (goal.definition.manualConditions ?? []).map((condition) => {
    const review = selection.conditionReviews.find((item) => item.goalVersionId === goal.id && item.conditionId === condition.id);
    return { goalVersionId: goal.id, conditionId: condition.id, label: condition.label, status: review?.status ?? "pending" as const, reason: review?.reason ?? "" };
  }));
  const suppliedKeys = selection.conditionReviews.map((item) => `${item.goalVersionId}:${item.conditionId}`);
  if (new Set(suppliedKeys).size !== suppliedKeys.length || selection.conditionReviews.some((item) => !conditions.some((condition) => condition.goalVersionId === item.goalVersionId && condition.conditionId === item.conditionId))) throw new GoalReviewError("A condition review is duplicated or does not belong to the active goals.");
  const items = await db.select().from(economicItems).where(and(eq(economicItems.companyId, companyId), eq(economicItems.scenarioId, scenario.id), eq(economicItems.status, "confirmed")));
  const blockers = [
    ...conditions.filter((condition) => condition.status !== "met").map((condition) => `${condition.label}: manual condition is ${condition.status}.`),
    ...evaluations.filter((item) => item.after.outcome === "unavailable").map((item) => `${item.after.goal.name}: goal calculation is unavailable.`),
    ...evaluations.filter((item) => item.after.goal.metric === "minimum_month_end_cash" && item.after.outcome === "below_target").map((item) => `${item.after.goal.name}: the scenario breaches this cash floor.`),
    ...scenarioRun.exceptions.filter((item) => !item.reason.includes("recurring capture needs renewed approval")).map((item) => item.reason),
  ];
  if (!scenario.changes.length && !drivers.length) blockers.push("The scenario has no changes to apply.");
  const monthlyChanges = scenarioRun.months.map((month) => { const before = base.output.months.find((row) => row.month === month.month); return { month: month.month, beforeMinor: before?.endingCashMinor ?? null, afterMinor: month.endingCashMinor, deltaMinor: before ? (BigInt(month.endingCashMinor) - BigInt(before.endingCashMinor)).toString() : null }; });
  const attribution = await attributeDecision(base.input, base.output, scenarioRun, goals, drivers, scenario.changes, scenario.id, async (input) => ({ ...input, recurrence: (await loadRecurrenceReview(db, companyId, input, now.toISOString().slice(0, 10), new Set(input.settlement?.occurrences.map((item) => item.key) ?? []))).states }));
  const payload = { attribution, companyId, scenario, planId: plan.id, primaryGoalVersionId: plan.goalVersionId, base, scenarioInput, scenarioRun, goals, evaluations, conditions, monthlyChanges, blockers: [...new Set(blockers)] };
  const previewToken = hash({ ...payload, base: withoutTime(base), scenarioItems: JSON.parse(JSON.stringify(items)) });
  if (Buffer.byteLength(JSON.stringify(payload)) > 16_000_000) throw new GoalReviewError("This scenario exceeds the review size limit.", 422);
  return { ...payload, previewToken };
}

async function outcomeWith(db: DbExecutor, companyId: string, reviewId: string, now: Date): Promise<GoalDecisionOutcome> {
  const [saved] = await db.select().from(goalDecisionReviews).where(and(eq(goalDecisionReviews.companyId, companyId), eq(goalDecisionReviews.id, reviewId), eq(goalDecisionReviews.kind, "applied")));
  if (!saved) throw new GoalReviewError("Applied decision review not found.", 404);
  const snapshot = saved.snapshot as GoalDecisionSnapshot;
  if (snapshot.type !== "applied" || !snapshot.appliedOutlook) throw new GoalReviewError("This review does not contain an applied outlook.", 422);
  const goal = snapshot.preview.goals.find((item) => item.id === saved.goalVersionId)!;
  const outlook = await captureOutlook(db, companyId, now);
  const convert = (view: typeof outlook) => ({ companyId, goalVersionId: goal.id, input: view.input, output: view.output, actualJournalLines: view.actualJournalLines, evaluation: evaluateCashGoal(goal.definition, view.output, view.limitations), coverage: { cash: view.cashCoverage, limitations: view.limitations } });
  // Monthly parity makes the checked scenario evaluation the preserved applied result.
  // Never recalculate its historical goal formula with today's evaluator.
  const preservedEvaluation = snapshot.preview.evaluations.find((item) => item.goalVersionId === goal.id)?.after;
  if (!preservedEvaluation) throw new GoalReviewError("The applied review is missing its preserved goal evaluation.", 422);
  const bridge = buildCashGoalBridge({ ...convert(snapshot.appliedOutlook), evaluation: preservedEvaluation }, convert(outlook));
  const payload = { companyId, parentId: saved.id, scenarioId: saved.scenarioId, planId: saved.planId, goal, outlook, bridge, notice: "Compared with the preserved applied outlook under its original goal version. Subsequent activity and other decisions are included; this is not an isolated causal effect of the decision." };
  return { ...payload, previewToken: hash({ ...payload, outlook: withoutTime(outlook) }) };
}

export async function loadGoalDecisionReview(companyId: string, id: string) {
  const [row] = await getDatabase().select().from(goalDecisionReviews).where(and(eq(goalDecisionReviews.companyId, companyId), eq(goalDecisionReviews.id, id)));
  if (!row) throw new GoalReviewError("Decision review not found.", 404);
  return { companyId, ...history(row), snapshot: row.snapshot as GoalDecisionSnapshot };
}

export async function executeGoalDecision(companyId: string, raw: unknown, actorUserId: string | null, now = new Date()) {
  const parsed = goalDecisionCommand.safeParse(raw);
  if (!parsed.success) throw new GoalReviewError("Invalid decision review. Check the selection, conditions, reason and acknowledgement.");
  const command = parsed.data;
  const committed = await getDatabase().transaction(async (tx) => {
    await tx.execute(setCompanyScopeSql(companyId));
    if (command.action === "preview") return { result: await previewGoalDecisionWith(tx, companyId, decisionSelection.parse({ scenarioId: command.scenarioId, planId: command.planId, conditionReviews: command.conditionReviews }), now), receipt: null };
    if (command.action === "preview_outcome") return { result: await outcomeWith(tx, companyId, command.reviewId, now), receipt: null };
    await tx.execute(sql`select pg_advisory_xact_lock(7407, hashtext(${companyId}))`);
    await tx.execute(sql`select pg_advisory_xact_lock(7405, hashtext(${companyId}))`);
    await tx.execute(sql`select pg_advisory_xact_lock(7406, hashtext(${companyId}))`);
    const requestHash = hash(command);
    const [prior] = await tx.select().from(goalDecisionReviews).where(and(eq(goalDecisionReviews.companyId, companyId), eq(goalDecisionReviews.requestKey, command.requestKey)));
    if (prior) { if (prior.requestHash !== requestHash) throw new GoalReviewError("Request key already used for another decision review.", 409); return { result: { saved: history(prior), reused: true }, receipt: null }; }
    let snapshot: GoalDecisionSnapshot; let goalVersionId: string; let scenarioId: string; let planId: string; let parentId: string | null = null;
    let receipt: CalculationRefreshReceipt | null = null;
    if (command.action === "save_outcome") {
      const outcome = await outcomeWith(tx, companyId, command.reviewId, now);
      if (outcome.previewToken !== command.previewToken) throw new GoalReviewError("The outcome changed. Refresh before saving.", 409);
      snapshot = { type: "outcome", outcome, reason: command.reason }; goalVersionId = outcome.goal.id; scenarioId = outcome.scenarioId; planId = outcome.planId; parentId = outcome.parentId;
    } else {
      const preview = await previewGoalDecisionWith(tx, companyId, { scenarioId: command.scenarioId, planId: command.planId, conditionReviews: command.conditionReviews }, now);
      if (preview.previewToken !== command.previewToken) throw new GoalReviewError("The scenario, goals, conditions or base outlook changed. Preview again before saving or approving.", 409);
      goalVersionId = preview.primaryGoalVersionId; scenarioId = preview.scenario.id; planId = preview.planId;
      snapshot = { type: command.action === "approve" ? "applied" : "evaluation", preview, decisionIds: [], reason: command.reason };
      if (command.action === "approve") {
        if (preview.blockers.length) throw new GoalReviewError("Resolve all manual conditions, cash-floor breaches and unsupported calculations before approving.", 422);
        const promoted = await promoteScenarioWith(tx, companyId, scenarioId, actorUserId, now);
        if (promoted.skippedItems || !promoted.decisionIds.length) throw new GoalReviewError("The complete scenario cannot be applied. No changes were saved.", 422);
        for (const id of promoted.decisionIds) {
          const application = await applyDecisionIfEffectiveWith(tx, companyId, id, actorUserId);
          if (!application.newlyApplied) throw new GoalReviewError("A scenario effect could not be applied atomically.", 409);
          await tx.update(decisions).set({ status: "applied", updatedAt: now }).where(and(eq(decisions.companyId, companyId), eq(decisions.id, id)));
          await recordAudit(tx, { companyId, actorUserId, via: "ui", action: "decision.applied", entityType: "decision", entityId: id, summary: "Applied as part of a reviewed goal-aware scenario", after: { scenarioId, planId, previewToken: preview.previewToken } });
        }
        receipt = await enqueueCalculationRefreshWith(tx, companyId, { rebuildJournalGraphs: false, cause: { kind: "decision_applied", subjectType: "scenario", subjectId: scenarioId, subjectIds: promoted.decisionIds, actorUserId, via: "ui" } });
        const applied = await captureOutlook(tx, companyId, now);
        const journalTotals = (lines: typeof applied.output.projectedLines) => {
          const totals = new Map<string, { debit: bigint; credit: bigint }>();
          for (const line of lines) { const key = JSON.stringify([line.period, line.accountId, line.entityId ?? null, line.currency]); const current = totals.get(key) ?? { debit: 0n, credit: 0n }; totals.set(key, { debit: current.debit + BigInt(line.debitMinor), credit: current.credit + BigInt(line.creditMinor) }); }
          return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, String(value.debit), String(value.credit)]);
        };
        if (stableJson(journalTotals(applied.output.projectedLines)) !== stableJson(journalTotals(preview.scenarioRun.projectedLines))) throw new GoalReviewError("Applied accounting treatment does not reproduce the preview. All changes were rolled back.", 409);
        const amounts = (months: typeof applied.output.months) => months.map(({ driverIds: _ids, ...row }) => { void _ids; return row; });
        if (stableJson(amounts(applied.output.months)) !== stableJson(amounts(preview.scenarioRun.months))) throw new GoalReviewError("Applied cash does not reproduce the reviewed scenario. The entire application was rolled back.", 409);
        snapshot.decisionIds = promoted.decisionIds; snapshot.appliedOutlook = applied;
        await tx.update(scenarios).set({ active: "N", updatedAt: now }).where(and(eq(scenarios.companyId, companyId), eq(scenarios.id, scenarioId)));
      }
    }
    if (Buffer.byteLength(JSON.stringify(snapshot)) > 24_000_000) throw new GoalReviewError("This decision review exceeds the saved snapshot limit.", 422);
    const [saved] = await tx.insert(goalDecisionReviews).values({ companyId, goalVersionId, scenarioId, planId, parentId, kind: snapshot.type, name: command.name, requestKey: command.requestKey, requestHash, previewToken: command.previewToken, snapshot: JSON.parse(JSON.stringify(snapshot)), actorUserId }).returning();
    await recordAudit(tx, { companyId, actorUserId, via: "ui", action: `goal_decision.${snapshot.type}`, entityType: "goal_decision_review", entityId: saved!.id, summary: command.reason, after: { scenarioId, planId, goalVersionId, parentId } });
    return { result: { saved: history(saved!), reused: false }, receipt };
  }, { isolationLevel: "repeatable read" });
  if (committed.receipt) {
    const refreshed = await processEnqueuedCalculationRefresh(committed.receipt, now);
    return { ...committed.result, calculationStatus: refreshed.forecastStatus };
  }
  return committed.result;
}
