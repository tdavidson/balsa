import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { type CashGoal } from "@balsa/finance-engine";

config({ path: fileURLToPath(new URL("../../../../.env.local", import.meta.url)), quiet: true });
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!process.env.DATABASE_URL)("goal-aware decisions and outcomes", async () => {
  if (!process.env.DATABASE_URL) return;
  const { chartAccounts, closeDatabase, companies, economicItems, forecastEntryTemplates, getDatabase, policies, scenarios, decisions, goalDecisionReviews, decisionEffectApplications } = await import("@finance/database");
  const { executeGoalReviewCommand: execute, loadGoalReview, loadGoalSnapshot } = await import("./goal-reviews");
  const { postApprovedJournal } = await import("./journal-posting");
  vi.stubEnv("NODE_ENV", "production");
  const db = getDatabase();
  vi.unstubAllEnvs(); // Multiple connections exercise real concurrent approval transactions.
  const ids: string[] = [];
  const now = new Date("2026-09-25T12:00:00.000Z");
  const conditionId = randomUUID();
  const definition: CashGoal = { name: "October cash", metric: "ending_cash_at_month", currency: "USD", startMonth: "2026-10", endMonth: "2026-10", targetMinor: "40000000", manualConditions: [{ id: conditionId, label: "Preserve the product team" }] };

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
    return { companyId, goal: result.goal, account, policyId: policy!.id, spendId: items.find((item) => item.direction === "spend")!.id };
  }
  async function save(companyId: string, goalVersionId: string, planId?: string) {
    const preview = await loadGoalReview(companyId, now);
    const command = { action: "save_snapshot", kind: planId ? "review" : "plan", goalVersionId, ...(planId ? { planId } : {}), name: planId ? "Next review" : "Approved baseline", previewToken: preview.previewToken, requestKey: randomUUID(), acknowledgeLimitations: true };
    const result = await execute(companyId, command, null, now);
    if (!("saved" in result)) throw new Error("Missing snapshot");
    return { command, saved: result.saved };
  }
  const { executeGoalDecision: decide, loadGoalDecisionReview: savedDecision } = await import("./goal-decisions");
  const { executeForecastReconciliation: reconcile, loadForecastReconciliation } = await import("./forecast-reconciliation");
  type Preview = import("./goal-decisions-contract").GoalDecisionPreview;
  type Outcome = import("./goal-decisions-contract").GoalDecisionOutcome;
  async function scenario(fixture: Awaited<ReturnType<typeof seed>>) {
    const [row] = await db.insert(scenarios).values({ companyId: fixture.companyId, name: "Move discretionary spending to November", changes: [
      { kind: "end_item", itemId: fixture.spendId, effectiveTo: "2026-09" },
      { kind: "add_driver", label: "October spending", direction: "spend", amount: 100000, cadence: "once", effectiveFrom: "2026-10", category: "other" },
      { kind: "add_driver", label: "November spending", direction: "spend", amount: 200000, cadence: "once", effectiveFrom: "2026-11", category: "other" },
      { kind: "add_driver", label: "Regular spending resumes", direction: "spend", amount: 150000, cadence: "monthly", effectiveFrom: "2026-12", category: "other" },
    ] }).returning();
    return row!;
  }
  const reviewed = (goalVersionId: string) => [{ goalVersionId, conditionId, status: "met", reason: "Only discretionary spending moves; all product roles remain funded." }];
  const approval = (selection: object, preview: Preview, action = "approve") => ({ ...selection, action, previewToken: preview.previewToken, name: "Reviewed spending timing", reason: "Preserve October headroom with visible November consequences", acknowledgeLimitations: true, requestKey: randomUUID() });
  const preview = async (companyId: string, selection: object) => await decide(companyId, { ...selection, action: "preview" }, null, now) as Preview;
  afterAll(async () => { if (ids.length) await db.delete(companies).where(inArray(companies.id, ids)); await closeDatabase(); });

  it("completes the release fixture from partial receipt to an atomic decision and preserved outcome", async () => {
    const fixture = await seed(); const { companyId } = fixture;
    await execute(companyId, { action: "create_goal", definition: { name: "Cash floor", metric: "minimum_month_end_cash", currency: "USD", startMonth: "2026-09", endMonth: "2026-10", targetMinor: "35000000" }, reason: "Minimum liquidity" }, null, now);
    const plan = await save(companyId, fixture.goal.id); const original = await loadGoalSnapshot(companyId, plan.saved.id);
    const reconciliation = await loadForecastReconciliation(companyId, now); const candidate = reconciliation.candidates.find((item) => item.definition.label === "Receipts")!;
    const captured = await reconcile(companyId, { action: "capture", candidateKey: candidate.definition.key, candidateHash: candidate.hash, independentObligation: true, reason: "Reviewed original obligation", requestKey: randomUUID() }, null, now) as unknown as { id: string };
    const actual = await postApprovedJournal(companyId, { policyId: fixture.policyId, idempotencyKey: randomUUID(), label: "Synthetic partial receipt", source: "synthetic_test", postingDate: "2026-09-15", period: "2026-09", memo: "First installment", deferRefresh: true, lines: [
      { accountId: fixture.account("1000"), currency: "USD", debitMinor: "6000000", creditMinor: "0" },
      { accountId: fixture.account("4000"), currency: "USD", debitMinor: "0", creditMinor: "6000000" },
    ] });
    await reconcile(companyId, { action: "allocate", occurrenceId: captured.id, actualEntryId: actual.entryId, amountMinor: "6000000", expectedVersion: 1, final: false, reason: "Reviewed installment", requestKey: randomUUID() }, null, now);
    expect((await loadGoalReview(companyId, now)).evaluations[fixture.goal.id]?.valueMinor).toBe("40000000");
    await reconcile(companyId, { action: "revise_occurrence", occurrenceId: captured.id, expectedVersion: 2, expectedDate: "2026-11-15", amountMinor: "10000000", status: "active", final: false, reason: "Remaining installment delayed", requestKey: randomUUID() }, null, now);
    expect((await loadGoalReview(companyId, now)).evaluations[fixture.goal.id]?.valueMinor).toBe("36000000");
    const draft = await scenario(fixture); const selection = { scenarioId: draft.id, planId: plan.saved.id };
    const pending = await preview(companyId, selection);
    expect(pending.conditions[0]?.status).toBe("pending"); expect(pending.blockers.join(" ")).toContain("manual condition is pending");
    await expect(decide(companyId, approval(selection, pending), null, now)).rejects.toMatchObject({ status: 422 });
    await decide(companyId, approval(selection, pending, "save_evaluation"), null, now);
    const readySelection = { ...selection, conditionReviews: reviewed(fixture.goal.id) };
    const ready = await preview(companyId, readySelection); expect(ready.blockers).toEqual([]);
    const october = ready.evaluations.find((item) => item.goalVersionId === fixture.goal.id)!;
    expect(october).toMatchObject({ before: { valueMinor: "36000000" }, after: { valueMinor: "41000000", headroomMinor: "1000000" } });
    expect(ready.scenarioRun.months.find((item) => item.month === "2026-11")?.endingCashMinor).toBe("35000000");
    const command = approval(readySelection, ready); const applied = await decide(companyId, command, null, now) as { saved: { id: string } };
    const preserved = await savedDecision(companyId, applied.saved.id);
    expect(preserved.snapshot.type).toBe("applied");
    if (preserved.snapshot.type === "outcome") throw new Error("Unexpected outcome");
    expect(preserved.snapshot.decisionIds).toHaveLength(4);
    expect(preserved.snapshot.appliedOutlook?.output.months.find((item) => item.month === "2026-10")?.endingCashMinor).toBe("41000000");
    expect(await decide(companyId, command, null, now)).toMatchObject({ saved: { id: applied.saved.id }, reused: true });
    expect(await db.select().from(decisions).where(eq(decisions.companyId, companyId))).toHaveLength(4);
    expect(await db.select().from(decisionEffectApplications).where(eq(decisionEffectApplications.companyId, companyId))).toHaveLength(4);
    expect((await db.select().from(scenarios).where(eq(scenarios.id, draft.id)))[0]?.active).toBe("N");
    expect(await loadGoalSnapshot(companyId, plan.saved.id)).toEqual(original);
    // A later expectation correction appears in an outcome review; it cannot rewrite approval.
    await reconcile(companyId, { action: "revise_occurrence", occurrenceId: captured.id, expectedVersion: 3, expectedDate: "2026-10-15", amountMinor: "10000000", status: "active", final: false, reason: "Customer confirmed earlier payment", requestKey: randomUUID() }, null, now);
    const outcome = await decide(companyId, { action: "preview_outcome", reviewId: applied.saved.id }, null, now) as Outcome;
    expect(outcome.bridge).toMatchObject({ beforeMinor: "41000000", afterMinor: "45000000", deltaMinor: "4000000", residualMinor: "0" });
    await decide(companyId, { action: "save_outcome", reviewId: applied.saved.id, previewToken: outcome.previewToken, name: "Customer timing improved", reason: "Reviewed new confirmation", requestKey: randomUUID(), acknowledgeLimitations: true }, null, now);
    expect(await savedDecision(companyId, applied.saved.id)).toEqual(preserved);
    await expect(db.update(goalDecisionReviews).set({ name: "Rewrite history" }).where(eq(goalDecisionReviews.id, applied.saved.id))).rejects.toThrow();
  });

  it("rejects stale previews, changed conditions, foreign references and request-key reuse", async () => {
    const a = await seed(); const b = await seed(); const plan = await save(a.companyId, a.goal.id); const draft = await scenario(a);
    const selection = { scenarioId: draft.id, planId: plan.saved.id, conditionReviews: reviewed(a.goal.id) };
    const first = await preview(a.companyId, selection);
    await expect(preview(b.companyId, selection)).rejects.toThrow();
    const bDraft = await scenario(b);
    await expect(preview(b.companyId, { ...selection, scenarioId: bDraft.id })).rejects.toMatchObject({ status: 404 });
    await expect(decide(a.companyId, { ...approval(selection, first), conditionReviews: [{ ...reviewed(a.goal.id)[0], reason: "Changed basis" }] }, null, now)).rejects.toMatchObject({ status: 409 });
    await db.update(economicItems).set({ amount: "155000" }).where(eq(economicItems.id, a.spendId));
    await expect(decide(a.companyId, approval(selection, first), null, now)).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(decisions).where(eq(decisions.companyId, a.companyId))).toHaveLength(0);
    const current = await preview(a.companyId, selection); const evaluation = approval(selection, current, "save_evaluation");
    const saved = await decide(a.companyId, evaluation, null, now) as { saved: { id: string } };
    await expect(savedDecision(b.companyId, saved.saved.id)).rejects.toMatchObject({ status: 404 });
    await expect(decide(a.companyId, { ...evaluation, name: "Different intent" }, null, now)).rejects.toMatchObject({ status: 409 });
    await execute(a.companyId, { action: "revise_goal", goalId: a.goal.goalId, expectedVersion: 1, status: "active", definition: { ...definition, targetMinor: "45000000" }, reason: "Changed management goal" }, null, now);
    await expect(decide(a.companyId, approval(selection, current), null, now)).rejects.toMatchObject({ status: 409 });
  });

  it("blocks cash-floor breaches and unsupported items without partially applying a scenario", async () => {
    const fixture = await seed(); const plan = await save(fixture.companyId, fixture.goal.id); const draft = await scenario(fixture);
    await execute(fixture.companyId, { action: "create_goal", definition: { name: "Strict floor", metric: "minimum_month_end_cash", currency: "USD", startMonth: "2026-09", endMonth: "2026-11", targetMinor: "45000000" }, reason: "Protect cash" }, null, now);
    const selection = { scenarioId: draft.id, planId: plan.saved.id, conditionReviews: reviewed(fixture.goal.id) };
    const blocked = await preview(fixture.companyId, selection); expect(blocked.blockers.join(" ")).toContain("breaches this cash floor");
    await expect(decide(fixture.companyId, approval(selection, blocked), null, now)).rejects.toMatchObject({ status: 422 });
    expect(await db.select().from(decisions).where(eq(decisions.companyId, fixture.companyId))).toHaveLength(0);
    await db.insert(economicItems).values({ companyId: fixture.companyId, scenarioId: draft.id, type: "obligation", direction: "spend", label: "Unsupported accrued item", amount: "1000", accountingTreatment: "accrual", cadence: "once", effectiveFrom: "2026-10", status: "confirmed" });
    const unsupported = await preview(fixture.companyId, selection); expect(unsupported.blockers.join(" ")).toContain("Non-cash treatment requires");
    await expect(decide(fixture.companyId, approval(selection, unsupported), null, now)).rejects.toMatchObject({ status: 422 });
  });
  it("rolls back every effect, audit and receipt when a later effect fails", async () => {
    const fixture = await seed(); const plan = await save(fixture.companyId, fixture.goal.id); const draft = await scenario(fixture);
    const selection = { scenarioId: draft.id, planId: plan.saved.id, conditionReviews: reviewed(fixture.goal.id) };
    const ready = await preview(fixture.companyId, selection);
    const before = await loadGoalReview(fixture.companyId, now);
    const effects = await import("./decision-effects"); const real = effects.applyDecisionIfEffectiveWith;
    const spy = vi.spyOn(effects, "applyDecisionIfEffectiveWith").mockImplementationOnce(real).mockRejectedValueOnce(new Error("Synthetic second-effect failure"));
    try { await expect(decide(fixture.companyId, approval(selection, ready), null, now)).rejects.toThrow("Synthetic second-effect failure"); }
    finally { spy.mockRestore(); }
    expect(await db.select().from(decisions).where(eq(decisions.companyId, fixture.companyId))).toHaveLength(0);
    expect(await db.select().from(decisionEffectApplications).where(eq(decisionEffectApplications.companyId, fixture.companyId))).toHaveLength(0);
    expect(await db.select().from(goalDecisionReviews).where(eq(goalDecisionReviews.companyId, fixture.companyId))).toHaveLength(0);
    const after = await loadGoalReview(fixture.companyId, now);
    expect(after.outlook.financialStateRevision).toBe(before.outlook.financialStateRevision);
    expect(after.forecastMonths).toEqual(before.forecastMonths);
    expect((await db.select().from(scenarios).where(eq(scenarios.id, draft.id)))[0]?.active).toBe("Y");
  });

  it("allows only one concurrent approval of the same checked scenario", async () => {
    const fixture = await seed(); const plan = await save(fixture.companyId, fixture.goal.id); const draft = await scenario(fixture);
    const selection = { scenarioId: draft.id, planId: plan.saved.id, conditionReviews: reviewed(fixture.goal.id) };
    const ready = await preview(fixture.companyId, selection);
    const results = await Promise.allSettled([decide(fixture.companyId, approval(selection, ready), null, now), decide(fixture.companyId, approval(selection, ready), null, now)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(decisions).where(eq(decisions.companyId, fixture.companyId))).toHaveLength(4);
    expect(await db.select().from(goalDecisionReviews).where(eq(goalDecisionReviews.companyId, fixture.companyId))).toHaveLength(1);
  });

  it("rejects a parity mismatch and rolls back all promoted decisions", async () => {
    const fixture = await seed(); const plan = await save(fixture.companyId, fixture.goal.id); const draft = await scenario(fixture);
    const selection = { scenarioId: draft.id, planId: plan.saved.id, conditionReviews: reviewed(fixture.goal.id) };
    const ready = await preview(fixture.companyId, selection);
    const effects = await import("./decision-effects"); const real = effects.applyDecisionIfEffectiveWith;
    const spy = vi.spyOn(effects, "applyDecisionIfEffectiveWith").mockImplementationOnce(async (...args) => {
      const result = await real(...args);
      await args[0].update(economicItems).set({ amount: "150001" }).where(eq(economicItems.id, fixture.spendId));
      return result;
    });
    try { await expect(decide(fixture.companyId, approval(selection, ready), null, now)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("does not reproduce") }); }
    finally { spy.mockRestore(); }
    expect(await db.select().from(decisions).where(eq(decisions.companyId, fixture.companyId))).toHaveLength(0);
    expect(await db.select().from(goalDecisionReviews).where(eq(goalDecisionReviews.companyId, fixture.companyId))).toHaveLength(0);
    expect((await db.select().from(economicItems).where(eq(economicItems.id, fixture.spendId)))[0]?.amount).toBe("150000");
  });

  it("preserves historical goal formulas when reviewing an outcome after an engine upgrade", async () => {
    const fixture = await seed(); const plan = await save(fixture.companyId, fixture.goal.id); const draft = await scenario(fixture);
    const selection = { scenarioId: draft.id, planId: plan.saved.id, conditionReviews: reviewed(fixture.goal.id) };
    const ready = await preview(fixture.companyId, selection);
    const applied = await decide(fixture.companyId, approval(selection, ready), null, now) as { saved: { id: string } };
    const original = (await savedDecision(fixture.companyId, applied.saved.id)).snapshot;
    if (original.type === "outcome") throw new Error("Unexpected outcome");
    // Seed a historical-version fixture, never mutate an existing immutable review.
    const historical = structuredClone(original);
    historical.preview.evaluations.find((item) => item.goalVersionId === fixture.goal.id)!.after.formulaVersion = "synthetic-older-goal-formula";
    const [row] = await db.insert(goalDecisionReviews).values({ companyId: fixture.companyId, goalVersionId: fixture.goal.id, planId: plan.saved.id, scenarioId: draft.id, kind: "applied", name: "Historical formula fixture", requestKey: randomUUID(), requestHash: "synthetic", previewToken: "synthetic", snapshot: historical }).returning();
    const outcome = await decide(fixture.companyId, { action: "preview_outcome", reviewId: row!.id }, null, now) as Outcome;
    expect(outcome.bridge.status).toBe("unavailable");
    expect(outcome.bridge.reasons.join(" ")).toContain("formula");
    expect((await savedDecision(fixture.companyId, row!.id)).snapshot).toEqual(historical);
  });

  it("attributes each ordered change and preserves formula and prepaid scenario items on approval", async () => {
    const fixture = await seed(); const plan = await save(fixture.companyId, fixture.goal.id);
    await db.insert(chartAccounts).values({ companyId: fixture.companyId, code: "1200", name: "Prepaid services", accountType: "asset", normalBalance: "debit", workingCapitalCategory: "prepaids" });
    const [draft] = await db.insert(scenarios).values({ companyId: fixture.companyId, name: "Synthetic formula and prepaid review", changes: [] }).returning();
    await db.insert(economicItems).values([
      { companyId: fixture.companyId, scenarioId: draft!.id, label: "Formula receipt", type: "agreement", direction: "receipt", amount: "1", amountFormula: "2500", cadence: "once", effectiveFrom: "2026-10", category: "other", accountingTreatment: "cash", status: "confirmed" },
      { companyId: fixture.companyId, scenarioId: draft!.id, label: "Prepaid service", type: "obligation", direction: "spend", amount: "900", cadence: "once", effectiveFrom: "2026-10", category: "other", accountingTreatment: "prepaid", recognitionStart: "2026-10", recognitionEnd: "2026-12", status: "confirmed" },
    ]);
    const selection = { scenarioId: draft!.id, planId: plan.saved.id, conditionReviews: reviewed(fixture.goal.id) };
    const view = await preview(fixture.companyId, selection); expect(view.blockers).toEqual([]);
    expect(view.attribution?.steps).toHaveLength(2); expect(view.attribution?.totals[0]).toMatchObject({ deltaMinor: "160000", residualMinor: "0", complete: true });
    const result = await decide(fixture.companyId, approval(selection, view), null, now) as { saved: { id: string } };
    const saved = await savedDecision(fixture.companyId, result.saved.id); if (saved.snapshot.type !== "applied") throw new Error("Missing applied review");
    const projection = (lines: typeof view.scenarioRun.projectedLines) => lines.map((line) => [line.period, line.accountId, line.debitMinor, line.creditMinor]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    expect(projection(saved.snapshot.appliedOutlook!.output.projectedLines)).toEqual(projection(view.scenarioRun.projectedLines));
    expect(saved.snapshot.preview.attribution).toEqual(view.attribution);
    const promoted = await db.select().from(economicItems).where(eq(economicItems.companyId, fixture.companyId));
    expect(promoted.find((item) => !item.scenarioId && item.label === "Formula receipt")?.amountFormula).toBe("2500");
  });

  it("continues a prepaid schedule from reviewed actuals and stops if a linked journal is reversed", async () => {
    const { correctFinancialProgress, loadFinancialProgress } = await import("./financial-progress");
    const fixture = await seed(); const [holding] = await db.insert(chartAccounts).values({ companyId: fixture.companyId, code: "1200", name: "Prepaid service", accountType: "asset", normalBalance: "debit", workingCapitalCategory: "prepaids" }).returning();
    const [driver] = await db.insert(economicItems).values({ companyId: fixture.companyId, type: "obligation", direction: "spend", label: "Annual prepaid service", amount: "1200", cadence: "once", effectiveFrom: "2026-10", recognitionStart: "2026-10", recognitionEnd: "2026-12", accountingTreatment: "prepaid", status: "confirmed" }).returning();
    async function post(debit: string, credit: string, amount: string, reversalOfEntryId?: string) { return postApprovedJournal(fixture.companyId, { policyId: fixture.policyId, idempotencyKey: randomUUID(), label: "Synthetic recognition", memo: "Synthetic recognition", source: "synthetic_test", period: "2026-10", postingDate: "2026-10-31", deferRefresh: true, ...(reversalOfEntryId ? { reversalOfEntryId } : {}), lines: [{ accountId: debit, currency: "USD", debitMinor: amount, creditMinor: "0" }, { accountId: credit, currency: "USD", debitMinor: "0", creditMinor: amount }] }); }
    const payment = await post(holding!.id, fixture.account("1000"), "120000"); const recognition = await post(fixture.account("6000"), holding!.id, "40000"); const november = new Date("2026-11-05T12:00:00Z");
    const before = await loadFinancialProgress(fixture.companyId, november); expect(before.recognition.exceptions.some((item) => item.driverId === driver!.id)).toBe(true);
    const body = { driverId: driver!.id, entryIds: [payment.entryId, recognition.entryId], previewToken: before.review.previewToken, reason: "Reviewed payment and October recognition", requestKey: randomUUID() };
    const preview = await correctFinancialProgress(fixture.companyId, { ...body, action: "preview_recognition" }, null, november) as { blockers: string[] };
    expect(preview.blockers).toEqual([]); expect((await loadFinancialProgress(fixture.companyId, november)).recognition.links).toHaveLength(0);
    await correctFinancialProgress(fixture.companyId, { ...body, action: "link_recognition" }, null, november);
    const after = await loadFinancialProgress(fixture.companyId, november); expect(after.recognition.exceptions.some((item) => item.driverId === driver!.id)).toBe(false); expect(after.recognition.links).toHaveLength(2);
    await post(fixture.account("1000"), holding!.id, "120000", payment.entryId);
    expect((await loadFinancialProgress(fixture.companyId, november)).recognition.exceptions.some((item) => item.driverId === driver!.id)).toBe(true);
  });

  it("preserves named cases and accuracy with stable previews, without applying scenarios", async () => {
    const { users, companyMembers, financialWorkReviews } = await import("@finance/database");
    const { executeFinancialReview: review, loadFinancialWorkReview } = await import("./financial-reviews");
    const f = await seed(); const baseline = await save(f.companyId, f.goal.id); const down = await scenario(f); const up = await scenario(f);
    const [user] = await db.insert(users).values({ authProvider: "fixture", authProviderUserId: randomUUID(), email: `${randomUUID()}@example.invalid` }).returning();
    await db.insert(companyMembers).values({ companyId: f.companyId, userId: user!.id, role: "owner" });
    try {
      const candidates = await loadForecastReconciliation(f.companyId, now); const candidate = candidates.candidates.find((item) => item.definition.label === "Receipts")!;
      const captured = await reconcile(f.companyId, { action: "capture", candidateKey: candidate.definition.key, candidateHash: candidate.hash, independentObligation: true, reason: "Synthetic timing", requestKey: randomUUID() }, null, now) as unknown as { id: string };
      await reconcile(f.companyId, { action: "revise_occurrence", occurrenceId: captured.id, expectedVersion: 1, expectedDate: "2026-10-10", amountMinor: "10000000", status: "active", final: false, reason: "Synthetic future receipt", requestKey: randomUUID() }, null, now);
      const scope = { kind: "sensitivity", planId: baseline.saved.id, downsideScenarioId: down.id, upsideScenarioId: up.id, occurrenceId: captured.id, maxDelayDays: 30 };
      const first = await review(f.companyId, user!.id, { action: "preview", scope }, now) as import("./financial-reviews").FinancialReviewPreview;
      const later = await review(f.companyId, user!.id, { action: "preview", scope }, new Date(now.getTime() + 60000)) as import("./financial-reviews").FinancialReviewPreview;
      expect(first.previewToken).toBe(later.previewToken); expect(first.report.detail.kind).toBe("sensitivity"); if (first.report.detail.kind === "sensitivity") { expect(first.report.detail.timing).toHaveLength(31); expect(first.report.detail.timing[0]?.expectedDate).toBe("2026-10-10"); expect(first.report.detail.timing[30]?.expectedDate).toBe("2026-11-09"); expect(first.report.detail.consecutivePassingDelayDays).toBeNull(); } expect(await db.select().from(financialWorkReviews).where(eq(financialWorkReviews.companyId, f.companyId))).toHaveLength(0);
      const saved = await review(f.companyId, user!.id, { action: "create", scope, previewToken: first.previewToken, reviewerUserId: user!.id, name: "Synthetic named cases", reason: "Test explicit cases", requestKey: randomUUID() }, now) as { id: string };
      expect((await loadFinancialWorkReview(f.companyId, user!.id, saved.id, now)).stale).toBe(false);
      expect((await db.select().from(scenarios).where(eq(scenarios.id, down.id)))[0]!.active).toBe("Y");
      const accuracy = await review(f.companyId, user!.id, { action: "preview", scope: { kind: "accuracy", baselineId: baseline.saved.id } }, now) as import("./financial-reviews").FinancialReviewPreview;
      expect(accuracy.report.detail.kind).toBe("accuracy"); if (accuracy.report.detail.kind === "accuracy") { expect(accuracy.report.detail.result.sampleCount).toBe(0); expect(accuracy.report.detail.result.weightedAbsoluteErrorBasisPoints).toBeNull(); }
      await expect(review(f.companyId, user!.id, { action: "preview", scope: { ...scope, upsideScenarioId: down.id } }, now)).rejects.toMatchObject({ status: 400 });
    } finally { await db.delete(companies).where(eq(companies.id, f.companyId)); await db.delete(users).where(eq(users.id, user!.id)); }
  });

});
