import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { companyMembers, financialReviewSignoffs, financialReviewSnapshots, financialReviewTasks, financialWorkReviews, getDatabase, recordAudit, scenarios, setCompanyScopeSql, users } from "@finance/database";
import { assessForecastAccuracy, buildForecastRun, buildWeeklyCash, evaluateCashGoal, stableJson } from "@nevermodel/finance-engine";
import { captureOutlook, goalsWith, GoalReviewError } from "./goal-reviews";
import { previewGoalDecisionWith } from "./goal-decisions";
import type { SavedGoalSnapshot } from "./goal-review-contract";
import type { DbExecutor, DbTransaction } from "./db-executor";
const hash = (value: unknown) => createHash("sha256").update(stableJson(JSON.parse(JSON.stringify(value)))).digest("hex");
const scopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cycle") }).strict(),
  z.object({ kind: z.literal("accuracy"), baselineId: z.uuid() }).strict(),
  z.object({ kind: z.literal("sensitivity"), planId: z.uuid(), downsideScenarioId: z.uuid(), upsideScenarioId: z.uuid(), occurrenceId: z.uuid().nullable(), maxDelayDays: z.number().int().min(1).max(90).default(30) }).strict(),
]);
type Scope = z.infer<typeof scopeSchema>;
const name = z.string().trim().min(1).max(120); const reason = z.string().trim().min(1).max(2000);
const dated = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
const identity = { reviewId: z.uuid(), expectedVersion: z.number().int().positive(), reason };
const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), scope: scopeSchema }).strict(),
  z.object({ action: z.literal("create"), scope: scopeSchema, previewToken: z.string().length(64), name, reviewerUserId: z.uuid().nullable(), requestKey: z.uuid(), reason }).strict(),
  z.object({ action: z.literal("assign_reviewer"), ...identity, reviewerUserId: z.uuid() }).strict(),
  z.object({ action: z.literal("submit"), ...identity }).strict(),
  z.object({ action: z.literal("refresh"), ...identity }).strict(),
  z.object({ action: z.literal("sign"), ...identity, acknowledgeSelfReview: z.boolean().default(false) }).strict(),
  z.object({ action: z.literal("task"), ...identity, taskId: z.uuid(), taskVersion: z.number().int().positive(), assigneeUserId: z.uuid().nullable(), dueDate: dated.nullable(), status: z.enum(["open", "resolved", "waived"]) }).strict(),
]);
async function membersWith(db: DbExecutor, companyId: string) { return db.select({ id: users.id, name: users.name, email: users.email, role: companyMembers.role }).from(companyMembers).innerJoin(users, eq(users.id, companyMembers.userId)).where(eq(companyMembers.companyId, companyId)); }
async function reportWith(db: DbExecutor, companyId: string, scope: Scope, now: Date) {
  const captured = await captureOutlook(db, companyId, now); const { capturedAt: _time, ...outlook } = captured; void _time;
  const goals = await goalsWith(db, companyId); const throughDate = now.toISOString().slice(0, 10);
  let detail;
  if (scope.kind === "cycle") detail = { kind: "cycle" as const, evaluations: goals.filter((goal) => goal.status === "active").map((goal) => ({ goal, evaluation: evaluateCashGoal(goal.definition, outlook.output, outlook.limitations) })) };
  else if (scope.kind === "accuracy") {
    const [baseline] = await db.select().from(financialReviewSnapshots).where(and(eq(financialReviewSnapshots.companyId, companyId), eq(financialReviewSnapshots.id, scope.baselineId)));
    if (!baseline) throw new GoalReviewError("Preserved baseline not found for this company.", 404);
    const snapshot = baseline.snapshot as SavedGoalSnapshot;
    detail = { kind: "accuracy" as const, baselineName: baseline.name, result: assessForecastAccuracy({ baselineId: baseline.id, capturedAt: snapshot.outlook.capturedAt, expectations: snapshot.outlook.input.settlement?.occurrences ?? [], current: outlook.input.settlement ?? { throughDate, occurrences: [], allocations: [], actuals: [] }, currency: outlook.input.currency, limitations: outlook.limitations }), baselineFormulaVersion: snapshot.outlook.output.formulaVersion };
  } else {
    if (scope.downsideScenarioId === scope.upsideScenarioId) throw new GoalReviewError("Choose different downside and upside scenarios.");
    const downside = await previewGoalDecisionWith(db, companyId, { scenarioId: scope.downsideScenarioId, planId: scope.planId, conditionReviews: [] }, now);
    const upside = await previewGoalDecisionWith(db, companyId, { scenarioId: scope.upsideScenarioId, planId: scope.planId, conditionReviews: [] }, now);
    const goal = goals.find((item) => item.id === downside.primaryGoalVersionId)!;
    const timing: { delayDays: number; expectedDate: string; valueMinor: string | null; outcome: string; firstWeeklyBreach: string | null; minimumDatedCashMinor: string; exceptions: string[] }[] = [];
    if (scope.occurrenceId) {
      const settlement = outlook.input.settlement!; const selected = settlement.occurrences.find((item) => item.id === scope.occurrenceId && item.status === "active" && !item.final);
      const result = outlook.output.settlements?.find((item) => item.id === scope.occurrenceId);
      if (!selected || !result || result.remainingMinor === "0") throw new GoalReviewError("Choose an outstanding expectation for timing sensitivity.", 422);
      for (let delayDays = 0; delayDays <= scope.maxDelayDays; delayDays++) {
        const expectedDate = new Date(Date.parse(selected.expectedDate) + delayDays * 86400000).toISOString().slice(0, 10);
        const input = { ...outlook.input, settlement: { ...settlement, occurrences: settlement.occurrences.map((item) => item.id === selected.id ? { ...item, expectedDate } : item) } };
        const output = buildForecastRun(input); const evaluation = evaluateCashGoal(goal.definition, output, outlook.limitations);
        const weekly = buildWeeklyCash({ throughDate, currency: input.currency, actualLines: outlook.actualJournalLines, projectedLines: output.projectedLines, reviewedEntryIds: settlement.occurrences.map((item) => `expectation:${item.id}`), limitations: outlook.limitations, minimumCashMinor: input.minimumCashMinor });
        timing.push({ delayDays, expectedDate, valueMinor: evaluation.valueMinor, outcome: evaluation.outcome, firstWeeklyBreach: weekly.weeks.find((week) => week.firstBreachDate)?.firstBreachDate ?? null, minimumDatedCashMinor: weekly.weeks.reduce((minimum, week) => BigInt(week.minimumDatedCashMinor) < BigInt(minimum) ? week.minimumDatedCashMinor : minimum, weekly.openingCashMinor), exceptions: [...output.exceptions.map((item) => item.reason), ...(expectedDate > weekly.end ? ["Delayed event falls outside the dated 13-week cash window."] : []), ...goals.filter((item) => item.status === "active" && item.id !== goal.id).flatMap((item) => evaluateCashGoal(item.definition, output, outlook.limitations).outcome !== "meets_target" ? [`${item.definition.name}: another active goal is not met.`] : [])] });
      }
    }
    const timingUnverified = (goal.definition.manualConditions?.length ?? 0) > 0 || outlook.limitations.some((reason) => !reason.includes("monthly")) || outlook.output.settlements?.some((item) => item.remainingMinor !== "0" && (outlook.input.settlement?.occurrences.find((occurrence) => occurrence.id === item.id)?.expectedDate ?? "9999-12-31") <= throughDate);
    const failing = timing.find((item) => item.outcome !== "meets_target" || item.firstWeeklyBreach || item.exceptions.length);
    detail = { kind: "sensitivity" as const, goal, base: evaluateCashGoal(goal.definition, outlook.output, outlook.limitations), downside, upside, timing, timingUnverified: Boolean(timingUnverified), consecutivePassingDelayDays: !timingUnverified && timing.length ? failing ? failing.delayDays === 0 ? null : failing.delayDays - 1 : scope.maxDelayDays : null, notice: "Named cases are explicit assumptions, not probabilities. Timing checks each whole-day delay from the selected date and reports the first goal, dated weekly-floor or calculation failure within the chosen range. Unverified coverage and unplaced overdue cash limit these results." };
  }
  const issues = [...new Set([...outlook.limitations, ...goals.filter((goal) => goal.status === "active").flatMap((goal) => (goal.definition.manualConditions ?? []).map((condition) => `${condition.label}: requires separate manual review; a passing calculation does not establish this condition.`)), ...outlook.output.exceptions.map((item) => item.reason), ...(detail.kind === "accuracy" ? detail.result.limitations : []), ...(detail.kind === "sensitivity" ? [...detail.downside.blockers, ...detail.upside.blockers] : [])])].map((title) => ({ key: `issue:${hash(title)}`, title }));
  const report = { schemaVersion: 1, companyId, throughDate, scope, outlook, goals, detail, issues };
  if (Buffer.byteLength(JSON.stringify(report)) > 24_000_000) throw new GoalReviewError("This review exceeds the supported snapshot size.", 422);
  const hashed = detail.kind === "sensitivity" ? { ...report, detail: { ...detail, downside: { ...detail.downside, base: { ...detail.downside.base, capturedAt: null } }, upside: { ...detail.upside, base: { ...detail.upside.base, capturedAt: null } } } } : report;
  return { report, previewToken: hash(hashed) };
}
export type FinancialReviewPreview = Awaited<ReturnType<typeof reportWith>>;
export async function loadFinancialReviews(companyId: string, userId: string) {
  const db = getDatabase(); const members = await membersWith(db, companyId); if (!members.some((item) => item.id === userId)) throw new GoalReviewError("Company membership is required.", 403);
  const [reviews, baselines, choices] = await Promise.all([
    db.select({ id: financialWorkReviews.id, name: financialWorkReviews.name, kind: financialWorkReviews.kind, status: financialWorkReviews.status, version: financialWorkReviews.version, preparerUserId: financialWorkReviews.preparerUserId, reviewerUserId: financialWorkReviews.reviewerUserId, createdAt: financialWorkReviews.createdAt }).from(financialWorkReviews).where(eq(financialWorkReviews.companyId, companyId)).orderBy(desc(financialWorkReviews.createdAt)).limit(100),
    db.select({ id: financialReviewSnapshots.id, name: financialReviewSnapshots.name, kind: financialReviewSnapshots.kind }).from(financialReviewSnapshots).where(eq(financialReviewSnapshots.companyId, companyId)).orderBy(desc(financialReviewSnapshots.createdAt)).limit(100),
    db.select({ id: scenarios.id, name: scenarios.name }).from(scenarios).where(and(eq(scenarios.companyId, companyId), eq(scenarios.active, "Y"))),
  ]);
  const outlook = await captureOutlook(db, companyId, new Date());
  const expectations = (outlook.input.settlement?.occurrences ?? []).filter((item) => item.status === "active" && !item.final && outlook.output.settlements?.some((result) => result.id === item.id && result.remainingMinor !== "0")).map(({ id, label, expectedDate }) => ({ id, label, expectedDate }));
  return { companyId, userId, members, expectations, reviews: reviews.map((review) => ({ ...review, createdAt: review.createdAt.toISOString() })), baselines, scenarios: choices };
}
export async function loadFinancialWorkReview(companyId: string, userId: string, id: string, now = new Date()) {
  if (!z.uuid().safeParse(id).success) throw new GoalReviewError("Invalid review ID.");
  return getDatabase().transaction(async (tx) => {
    await tx.execute(setCompanyScopeSql(companyId));
    if (!(await membersWith(tx, companyId)).some((member) => member.id === userId)) throw new GoalReviewError("Company membership is required.", 403);
    const [review] = await tx.select().from(financialWorkReviews).where(and(eq(financialWorkReviews.companyId, companyId), eq(financialWorkReviews.id, id)));
    if (!review) throw new GoalReviewError("Review not found for this company.", 404);
    const tasks = await tx.select().from(financialReviewTasks).where(and(eq(financialReviewTasks.companyId, companyId), eq(financialReviewTasks.reviewId, id))).orderBy(financialReviewTasks.createdAt);
    const signoffs = await tx.select().from(financialReviewSignoffs).where(and(eq(financialReviewSignoffs.companyId, companyId), eq(financialReviewSignoffs.reviewId, id))).orderBy(desc(financialReviewSignoffs.createdAt));
    let currentHash: string | null = null; try { currentHash = (await reportWith(tx, companyId, scopeSchema.parse(review.scope), now)).previewToken; } catch { /* An unavailable current scope cannot validate a historical sign-off. */ }
    return { companyId, review: { ...review, snapshot: review.snapshot as { report: FinancialReviewPreview["report"]; requestHash: string }, createdAt: review.createdAt.toISOString(), updatedAt: review.updatedAt.toISOString() }, tasks: tasks.map((task) => ({ ...task, createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString() })), signoffs: signoffs.map((signoff) => ({ ...signoff, createdAt: signoff.createdAt.toISOString() })), stale: currentHash !== review.snapshotHash };
  }, { isolationLevel: "repeatable read" });
}
async function syncTasks(tx: DbTransaction, companyId: string, reviewId: string, issues: FinancialReviewPreview["report"]["issues"], now: Date) {
  const existing = await tx.select().from(financialReviewTasks).where(and(eq(financialReviewTasks.companyId, companyId), eq(financialReviewTasks.reviewId, reviewId)));
  for (const issue of issues) {
    const prior = existing.find((task) => task.subjectKey === issue.key);
    if (!prior) await tx.insert(financialReviewTasks).values({ companyId, reviewId, subjectKey: issue.key, title: issue.title });
    else if (prior.status !== "open") await tx.update(financialReviewTasks).set({ status: "open", resolution: null, version: prior.version + 1, updatedAt: now }).where(and(eq(financialReviewTasks.companyId, companyId), eq(financialReviewTasks.id, prior.id)));
  }
  for (const prior of existing.filter((task) => !issues.some((issue) => issue.key === task.subjectKey))) await tx.update(financialReviewTasks).set({ status: "resolved", resolution: "No longer reported in the refreshed scope.", version: prior.version + 1, updatedAt: now }).where(and(eq(financialReviewTasks.companyId, companyId), eq(financialReviewTasks.id, prior.id)));
}
export async function executeFinancialReview(companyId: string, userId: string, raw: unknown, now = new Date()) {
  const parsed = commandSchema.safeParse(raw); if (!parsed.success) throw new GoalReviewError("Invalid review request. Check scope, assignment, version and reason."); const command = parsed.data;
  return getDatabase().transaction(async (tx) => {
    await tx.execute(setCompanyScopeSql(companyId)); await tx.execute(sql`select pg_advisory_xact_lock(7409, hashtext(${companyId}))`);
    const members = await membersWith(tx, companyId); const actor = members.find((member) => member.id === userId); if (!actor) throw new GoalReviewError("Company membership is required.", 403);
    const member = (id: string | null) => { if (id && !members.some((item) => item.id === id)) throw new GoalReviewError("Assignee must be a current member of this company.", 422); };
    if (command.action === "preview") return { companyId, ...await reportWith(tx, companyId, command.scope, now) };
    if (command.action === "create") {
      member(command.reviewerUserId); const requestHash = hash({ command, userId });
      const [prior] = await tx.select().from(financialWorkReviews).where(and(eq(financialWorkReviews.companyId, companyId), eq(financialWorkReviews.requestKey, command.requestKey)));
      if (prior) { if ((prior.snapshot as { requestHash: string }).requestHash !== requestHash) throw new GoalReviewError("Request key already used for another review.", 409); return { companyId, id: prior.id, reused: true }; }
      const preview = await reportWith(tx, companyId, command.scope, now); if (preview.previewToken !== command.previewToken) throw new GoalReviewError("The report changed. Preview again before saving.", 409);
      const [saved] = await tx.insert(financialWorkReviews).values({ companyId, kind: command.scope.kind, name: command.name, scope: command.scope, snapshot: { report: preview.report, requestHash }, snapshotHash: preview.previewToken, preparerUserId: userId, reviewerUserId: command.reviewerUserId, requestKey: command.requestKey }).returning();
      await syncTasks(tx, companyId, saved!.id, preview.report.issues, now);
      await recordAudit(tx, { companyId, actorUserId: userId, via: "ui", action: "financial_review.created", entityType: "financial_work_review", entityId: saved!.id, summary: command.reason, after: { scope: command.scope, snapshotHash: preview.previewToken, reviewerUserId: command.reviewerUserId }, requestId: command.requestKey });
      return { companyId, id: saved!.id, reused: false };
    }
    const [review] = await tx.select().from(financialWorkReviews).where(and(eq(financialWorkReviews.companyId, companyId), eq(financialWorkReviews.id, command.reviewId)));
    if (!review) throw new GoalReviewError("Review not found.", 404);
    if (review.version !== command.expectedVersion) throw new GoalReviewError("Review changed. Reload before updating it.", 409);
    const manager = actor.role === "owner" || review.preparerUserId === userId;
    let status = review.status; let extra: Partial<typeof financialWorkReviews.$inferInsert> = {};
    if (command.action === "assign_reviewer") { if (!manager || review.status === "signed") throw new GoalReviewError("Only the preparer or owner can assign an unsigned review.", 403); member(command.reviewerUserId); extra = { reviewerUserId: command.reviewerUserId }; }
    else if (command.action === "refresh") { if (!manager) throw new GoalReviewError("Only the preparer or owner can refresh this scope.", 403); const preview = await reportWith(tx, companyId, scopeSchema.parse(review.scope), now); const snapshot = review.snapshot as { requestHash: string }; extra = { snapshot: { report: preview.report, requestHash: snapshot.requestHash }, snapshotHash: preview.previewToken }; status = "reopened"; await syncTasks(tx, companyId, review.id, preview.report.issues, now); }
    else if (command.action === "submit") { if (!manager || review.status === "signed" || !review.reviewerUserId) throw new GoalReviewError("An unsigned review needs an assigned reviewer and preparer submission.", 422); member(review.reviewerUserId); status = "submitted"; }
    else if (command.action === "task") {
      if (review.status === "signed") throw new GoalReviewError("Refresh and reopen the signed review before changing its tasks.", 409);
      const [task] = await tx.select().from(financialReviewTasks).where(and(eq(financialReviewTasks.companyId, companyId), eq(financialReviewTasks.reviewId, review.id), eq(financialReviewTasks.id, command.taskId)));
      if (!task) throw new GoalReviewError("Review task not found.", 404); if (task.version !== command.taskVersion) throw new GoalReviewError("Task changed. Reload before saving.", 409);
      if (!manager && task.assigneeUserId !== userId) throw new GoalReviewError("Only the assignee, preparer or owner can update this task.", 403);
      if (!manager && task.assigneeUserId !== command.assigneeUserId) throw new GoalReviewError("Only the preparer or owner can reassign a task.", 403);
      member(command.assigneeUserId);
      await tx.update(financialReviewTasks).set({ assigneeUserId: command.assigneeUserId, dueDate: command.dueDate, status: command.status, resolution: command.status === "open" ? null : command.reason, version: task.version + 1, updatedAt: now }).where(and(eq(financialReviewTasks.companyId, companyId), eq(financialReviewTasks.id, task.id)));
      status = "reopened";
    } else {
      if (review.status !== "submitted" || review.reviewerUserId !== userId) throw new GoalReviewError("Only the assigned reviewer can sign a submitted review.", 403);
      const selfReview = review.preparerUserId === userId; if (selfReview && !command.acknowledgeSelfReview) throw new GoalReviewError("Explicitly acknowledge that you are both preparer and reviewer.", 422);
      const preview = await reportWith(tx, companyId, scopeSchema.parse(review.scope), now); if (preview.previewToken !== review.snapshotHash) throw new GoalReviewError("The financial scope changed. Refresh and review it before signing.", 409);
      const tasks = await tx.select().from(financialReviewTasks).where(and(eq(financialReviewTasks.companyId, companyId), eq(financialReviewTasks.reviewId, review.id)));
      if (tasks.some((task) => task.status === "open" || task.status === "resolved" && preview.report.issues.some((issue) => issue.key === task.subjectKey))) throw new GoalReviewError("Resolve underlying exceptions or explicitly waive them with a reason before sign-off.", 422);
      await tx.insert(financialReviewSignoffs).values({ companyId, reviewId: review.id, reviewerUserId: userId, snapshotHash: review.snapshotHash, reason: command.reason, selfReview, snapshot: { report: preview.report, tasks, preparerUserId: review.preparerUserId, reviewerUserId: userId, reviewedWithExceptions: tasks.some((task) => task.status === "waived") } }); status = "signed";
    }
    await tx.update(financialWorkReviews).set({ ...extra, status, version: review.version + 1, updatedAt: now }).where(and(eq(financialWorkReviews.companyId, companyId), eq(financialWorkReviews.id, review.id)));
    await recordAudit(tx, { companyId, actorUserId: userId, via: "ui", action: `financial_review.${command.action}`, entityType: "financial_work_review", entityId: review.id, summary: command.reason, before: { status: review.status, version: review.version, snapshotHash: review.snapshotHash }, after: { status, version: review.version + 1, ...command, ...("snapshotHash" in extra ? { snapshotHash: extra.snapshotHash } : {}) } });
    return { companyId, id: review.id, version: review.version + 1, status };
  }, { isolationLevel: "repeatable read" });
}
