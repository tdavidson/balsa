import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { buildForecastRun, evaluateCashGoal, type CashGoal } from "@nevermodel/finance-engine";

config({ path: fileURLToPath(new URL("../../../../.env.local", import.meta.url)), quiet: true });
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!process.env.DATABASE_URL)("goal plans and reviews", async () => {
  if (!process.env.DATABASE_URL) return;
  const { auditLog, cashGoalVersions, chartAccounts, closeDatabase, companies, economicItems, financialReviewSnapshots, forecastEntryTemplates, getDatabase, policies } = await import("@finance/database");
  const { executeGoalReviewCommand: execute, loadGoalReview, loadGoalSnapshot, inspectGoalComparison } = await import("./goal-reviews");
  const { postApprovedJournal } = await import("./journal-posting");
  const db = getDatabase(); const ids: string[] = [];
  const now = new Date("2026-09-25T12:00:00.000Z");
  const definition: CashGoal = { name: "October cash", metric: "ending_cash_at_month", currency: "USD", startMonth: "2026-10", endMonth: "2026-10", targetMinor: "40000000" };

  async function seed() {
    const [company] = await db.insert(companies).values({ name: `Synthetic goal review ${randomUUID()}` }).returning();
    const companyId = company!.id; ids.push(companyId);
    const accounts = await db.insert(chartAccounts).values([
      { companyId, code: "1000", name: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" },
      { companyId, code: "3000", name: "Capital", accountType: "equity", normalBalance: "credit" },
      { companyId, code: "4000", name: "Revenue", accountType: "revenue", normalBalance: "credit" },
      { companyId, code: "6000", name: "Operating costs", accountType: "expense", normalBalance: "debit" },
    ]).returning();
    const account = (code: string) => accounts.find((row) => row.code === code)!.id;
    await db.insert(forecastEntryTemplates).values([
      { companyId, name: "Receipts", itemType: "agreement", direction: "receipt", debitAccountId: account("1000"), creditAccountId: account("4000") },
      { companyId, name: "Costs", itemType: "obligation", direction: "spend", debitAccountId: account("6000"), creditAccountId: account("1000") },
    ]);
    const items = await db.insert(economicItems).values([
      { companyId, type: "agreement", direction: "receipt", label: "Receipts", amount: "100000", cadence: "monthly", effectiveFrom: "2026-09", status: "confirmed" },
      { companyId, type: "obligation", direction: "spend", label: "Costs", amount: "150000", cadence: "monthly", effectiveFrom: "2026-09", status: "confirmed" },
    ]).returning();
    const [policy] = await db.insert(policies).values({ companyId, name: "Synthetic opening", rule: "Approved synthetic opening capital fixture", active: "Y" }).returning();
    await postApprovedJournal(companyId, { policyId: policy!.id, idempotencyKey: "synthetic-opening", label: "Synthetic capital", source: "synthetic_test", postingDate: "2026-08-31", period: "2026-08", memo: "Opening capital", deferRefresh: true, lines: [
      { accountId: account("1000"), currency: "USD", debitMinor: "50000000", creditMinor: "0" },
      { accountId: account("3000"), currency: "USD", debitMinor: "0", creditMinor: "50000000" },
    ] });
    const result = await execute(companyId, { action: "create_goal", definition, reason: "Fund the next stage" }, null, now);
    if (!("goal" in result)) throw new Error("Missing goal");
    return { companyId, goal: result.goal, spendId: items.find((item) => item.direction === "spend")!.id };
  }
  async function save(companyId: string, goalVersionId: string, planId?: string) {
    const preview = await loadGoalReview(companyId, now);
    const command = { action: "save_snapshot", kind: planId ? "review" : "plan", goalVersionId, ...(planId ? { planId } : {}), name: planId ? "Next review" : "Approved baseline", previewToken: preview.previewToken, requestKey: randomUUID(), acknowledgeLimitations: true };
    const result = await execute(companyId, command, null, now);
    if (!("saved" in result)) throw new Error("Missing snapshot");
    return { command, saved: result.saved };
  }
  afterAll(async () => { if (ids.length) await db.delete(companies).where(inArray(companies.id, ids)); await closeDatabase(); });

  it("preserves the plan, goal, inputs and review after assumptions change", async () => {
    const fixture = await seed();
    const plan = await save(fixture.companyId, fixture.goal.id);
    const original = await loadGoalSnapshot(fixture.companyId, plan.saved.id);
    expect(original.snapshot.evaluation).toMatchObject({ valueMinor: "40000000", headroomMinor: "0", assurance: "provisional" });
    expect(original.snapshot.outlook.actualJournalLines).toHaveLength(2);
    expect(original.snapshot.outlook.lineage.journalLines).toHaveLength(2);
    await db.update(economicItems).set({ amount: "170000" }).where(and(eq(economicItems.companyId, fixture.companyId), eq(economicItems.id, fixture.spendId)));
    const preview = await loadGoalReview(fixture.companyId, now);
    expect(preview.evaluations[fixture.goal.id]?.valueMinor).toBe("36000000");
    expect(preview.changes[plan.saved.id]).toBe("-4000000");
    const review = await save(fixture.companyId, fixture.goal.id, plan.saved.id);
    expect(review.saved.evaluation.valueMinor).toBe("36000000");
    expect(await loadGoalSnapshot(fixture.companyId, plan.saved.id)).toEqual(original);
    expect(evaluateCashGoal(original.snapshot.goal.definition, buildForecastRun(original.snapshot.outlook.input), original.snapshot.outlook.limitations)).toEqual(original.snapshot.evaluation);
    expect((await loadGoalReview(fixture.companyId, now)).goals[0]?.definition.targetMinor).toBe("40000000");
  });

  it("pins live attribution to a preview and saves plan and previous-review bridges without rewriting them", async () => {
    const fixture = await seed(); const plan = await save(fixture.companyId, fixture.goal.id);
    await db.update(economicItems).set({ amount: "170000" }).where(eq(economicItems.id, fixture.spendId));
    const preview = await loadGoalReview(fixture.companyId, now);
    const compared = await inspectGoalComparison(fixture.companyId, plan.saved.id, preview.previewToken, now);
    expect(compared.bridge).toMatchObject({ status: "complete", deltaMinor: "-4000000", residualMinor: "0" });
    const first = await save(fixture.companyId, fixture.goal.id, plan.saved.id);
    const savedFirst = await loadGoalSnapshot(fixture.companyId, first.saved.id);
    expect(savedFirst.snapshot.comparisons?.plan.bridge).toEqual(compared.bridge);
    expect(savedFirst.snapshot.comparisons?.previousReview).toBeUndefined();
    await db.update(economicItems).set({ amount: "180000" }).where(eq(economicItems.id, fixture.spendId));
    await expect(inspectGoalComparison(fixture.companyId, plan.saved.id, preview.previewToken, now)).rejects.toMatchObject({ status: 409 });
    const second = await save(fixture.companyId, fixture.goal.id, plan.saved.id);
    const savedSecond = await loadGoalSnapshot(fixture.companyId, second.saved.id);
    expect(savedSecond.snapshot.comparisons?.plan.bridge.deltaMinor).toBe("-6000000");
    expect(savedSecond.snapshot.comparisons?.previousReview).toMatchObject({ baselineId: first.saved.id, bridge: { deltaMinor: "-2000000", residualMinor: "0" } });
    expect(await loadGoalSnapshot(fixture.companyId, first.saved.id)).toEqual(savedFirst);
    const otherPlan = await save(fixture.companyId, fixture.goal.id);
    const otherReview = await save(fixture.companyId, fixture.goal.id, otherPlan.saved.id);
    expect((await loadGoalSnapshot(fixture.companyId, otherReview.saved.id)).snapshot.comparisons?.previousReview).toBeUndefined();
  });

  it("rejects foreign comparison baselines and superseded goal versions", async () => {
    const a = await seed(); const b = await seed(); const plan = await save(a.companyId, a.goal.id);
    const foreign = await loadGoalReview(b.companyId, now);
    await expect(inspectGoalComparison(b.companyId, plan.saved.id, foreign.previewToken, now)).rejects.toMatchObject({ status: 404 });
    await execute(a.companyId, { action: "revise_goal", goalId: a.goal.goalId, expectedVersion: 1, status: "active", definition: { ...definition, targetMinor: "45000000" }, reason: "New target" }, null, now);
    const current = await loadGoalReview(a.companyId, now);
    await expect(inspectGoalComparison(a.companyId, plan.saved.id, current.previewToken, now)).rejects.toMatchObject({ status: 409 });
  });

  it("rejects stale approvals even when a driver changed without a revision bump", async () => {
    const fixture = await seed(); const preview = await loadGoalReview(fixture.companyId, now);
    await db.update(economicItems).set({ amount: "180000" }).where(eq(economicItems.id, fixture.spendId));
    await expect(execute(fixture.companyId, { action: "save_snapshot", kind: "plan", goalVersionId: fixture.goal.id, name: "Stale", previewToken: preview.previewToken, requestKey: randomUUID(), acknowledgeLimitations: true }, null, now)).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(financialReviewSnapshots).where(eq(financialReviewSnapshots.companyId, fixture.companyId))).toHaveLength(0);
  });

  it("is idempotent for retries and rejects request-key reuse with changed intent", async () => {
    const fixture = await seed(); const plan = await save(fixture.companyId, fixture.goal.id);
    expect(await execute(fixture.companyId, plan.command, null, now)).toMatchObject({ saved: { id: plan.saved.id }, reused: true });
    await expect(execute(fixture.companyId, { ...plan.command, name: "Other" }, null, now)).rejects.toMatchObject({ status: 409 });
    const audits = await db.select().from(auditLog).where(and(eq(auditLog.companyId, fixture.companyId), eq(auditLog.action, "goal.plan_saved")));
    expect(audits).toHaveLength(1);
  });

  it("revises and archives goals without rewriting their history or accepting stale revisions", async () => {
    const fixture = await seed(); const plan = await save(fixture.companyId, fixture.goal.id);
    const command = { action: "revise_goal", goalId: fixture.goal.goalId, expectedVersion: 1, status: "archived", definition: { ...definition, targetMinor: "45000000" }, reason: "Management changed direction" };
    await execute(fixture.companyId, command, null, now);
    await expect(execute(fixture.companyId, command, null, now)).rejects.toMatchObject({ status: 409 });
    const current = await loadGoalReview(fixture.companyId, now);
    expect(current.goals[0]).toMatchObject({ version: 2, status: "archived" });
    expect(current.changes[plan.saved.id]).toBeNull();
    expect((await loadGoalSnapshot(fixture.companyId, plan.saved.id)).snapshot.goal.version).toBe(1);
    await expect(save(fixture.companyId, current.goals[0]!.id)).rejects.toMatchObject({ status: 409 });
  });

  it("rejects cross-company snapshot reads, goal revisions and plan references", async () => {
    const a = await seed(); const b = await seed(); const plan = await save(a.companyId, a.goal.id);
    await expect(loadGoalSnapshot(b.companyId, plan.saved.id)).rejects.toMatchObject({ status: 404 });
    await expect(execute(b.companyId, { action: "revise_goal", goalId: a.goal.goalId, expectedVersion: 1, definition, status: "active", reason: "Other company" }, null, now)).rejects.toMatchObject({ status: 404 });
    await expect(save(b.companyId, b.goal.id, plan.saved.id)).rejects.toMatchObject({ status: 404 });
    expect((await loadGoalReview(b.companyId, now)).snapshots).toHaveLength(0);
  });

  it("enforces immutable payloads and composite company references in the migration", async () => {
    const a = await seed(); const b = await seed(); const plan = await save(a.companyId, a.goal.id);
    await expect(db.update(financialReviewSnapshots).set({ name: "Rewrite history" }).where(eq(financialReviewSnapshots.id, plan.saved.id))).rejects.toThrow();
    await expect(db.update(cashGoalVersions).set({ reason: "Rewrite intent" }).where(eq(cashGoalVersions.id, a.goal.id))).rejects.toThrow();
    await expect(db.insert(financialReviewSnapshots).values({ companyId: b.companyId, goalVersionId: a.goal.id, kind: "plan", name: "Wrong company", requestKey: randomUUID(), requestHash: "test", snapshot: {} })).rejects.toThrow();
    const policies = await db.execute(sql`select tablename from pg_policies where tablename in ('cash_goal_versions', 'financial_review_snapshots')`);
    expect(policies).toHaveLength(2);
  });

  it("rejects invalid amounts, currency, horizon and unacknowledged saves", async () => {
    const fixture = await seed();
    for (const invalid of [{ ...definition, targetMinor: "-1" }, { ...definition, currency: "EUR" }, { ...definition, startMonth: "2027-10" }]) await expect(execute(fixture.companyId, { action: "create_goal", definition: invalid, reason: "Invalid" }, null, now)).rejects.toMatchObject({ status: 400 });
    const preview = await loadGoalReview(fixture.companyId, now);
    await expect(execute(fixture.companyId, { action: "save_snapshot", kind: "plan", goalVersionId: fixture.goal.id, name: "Unreviewed", previewToken: preview.previewToken, requestKey: randomUUID(), acknowledgeLimitations: false }, null, now)).rejects.toMatchObject({ status: 400 });
  });
  it("preserves draft goals and a company-scoped primary selection across revisions", async () => {
    const fixture = await seed(); const other = await seed();
    const draft = await execute(fixture.companyId, { action: "create_goal", status: "draft", definition: { ...definition, name: "Draft next stage" }, reason: "Exploring a new target" }, null, now);
    if (!("goal" in draft)) throw new Error("Missing draft goal");
    expect(draft.goal.status).toBe("draft");
    await expect(save(fixture.companyId, draft.goal.id)).rejects.toMatchObject({ status: 409 });
    await expect(execute(fixture.companyId, { action: "set_primary_goal", goalId: other.goal.goalId, expectedVersion: 0 }, null, now)).rejects.toMatchObject({ status: 404 });
    await execute(fixture.companyId, { action: "set_primary_goal", goalId: fixture.goal.goalId, expectedVersion: 0 }, null, now);
    expect(await loadGoalReview(fixture.companyId, now)).toMatchObject({ primaryGoalId: fixture.goal.goalId, preferenceVersion: 1 });
    await expect(execute(fixture.companyId, { action: "set_primary_goal", goalId: null, expectedVersion: 0 }, null, now)).rejects.toMatchObject({ status: 409 });
    await execute(fixture.companyId, { action: "revise_goal", goalId: fixture.goal.goalId, expectedVersion: 1, status: "active", definition: { ...definition, targetMinor: "42000000" }, reason: "Refined target" }, null, now);
    expect(await loadGoalReview(fixture.companyId, now)).toMatchObject({ primaryGoalId: fixture.goal.goalId, preferenceVersion: 2 });
    await execute(fixture.companyId, { action: "revise_goal", goalId: fixture.goal.goalId, expectedVersion: 2, status: "archived", definition, reason: "Retired goal" }, null, now);
    expect((await loadGoalReview(fixture.companyId, now)).primaryGoalId).toBeNull();
  });

});
