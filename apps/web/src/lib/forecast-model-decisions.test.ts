import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { and, desc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: fileURLToPath(new URL("../../../../.env.local", import.meta.url)) });
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!process.env.DATABASE_URL)("forecast model decisions", async () => {
  if (!process.env.DATABASE_URL) return;
  const { auditLog, closeDatabase, companies, decisionEffectApplications, decisions, economicItems, forecastConsequences, forecastDimensions, forecastVariables, getDatabase, reviewItems } = await import("@finance/database");
  const { seedModelCompany } = await import("./forecast-model-fixture");
  const { applyDecisionAndEnqueue, createAppliedDecisionAndEnqueue } = await import("./decision-effects");
  const { previewForecastChange } = await import("./forecast-preview");
  const { refreshCurrentCalculationRun } = await import("./refresh-calculation-run");
  const { createTestDatabase } = await import("./test-database");
  const db = getDatabase();
  let seeded!: Awaited<ReturnType<typeof seedModelCompany>>;
  let otherCompanyId = "";
  const noOpCalculationProcessor = async (receipt: { financialStateRevision: string; journalJobs: { id: string }[]; forecastJobId: string | null }) => ({ financialStateRevision: receipt.financialStateRevision, jobId: null, status: "not_queued" as const, journalJobIds: receipt.journalJobs.map((job) => job.id), forecastJobId: receipt.forecastJobId, forecastStatus: "not_queued" as const });
  const seedDecision = async (executor: typeof db, companyId: string, effect: object) => (await executor.insert(decisions).values({ companyId, question: "Apply model change?", answer: "Yes", status: "proposed", effect: JSON.stringify(effect) }).returning({ id: decisions.id }))[0]!.id;
  const markers = (companyId: string, decisionId: string) => db.select().from(decisionEffectApplications).where(and(eq(decisionEffectApplications.companyId, companyId), eq(decisionEffectApplications.decisionId, decisionId)));
  const headline = (delta: unknown) => { const value = delta as { horizonEndCash: unknown; cashOutMonth: unknown; runwayMonths: unknown; projectedSpending: unknown; projectedReceipts: unknown }; return { horizonEndCash: value.horizonEndCash, cashOutMonth: value.cashOutMonth, runwayMonths: value.runwayMonths, projectedSpending: value.projectedSpending, projectedReceipts: value.projectedReceipts }; };

  beforeAll(async () => {
    seeded = await seedModelCompany("Model decisions");
    const [other] = await db.insert(companies).values({ name: `Model decisions other ${Date.now()}` }).returning({ id: companies.id });
    otherCompanyId = other!.id;
  });
  afterAll(async () => {
    for (const id of [seeded?.companyId, otherCompanyId]) if (id) await db.delete(companies).where(eq(companies.id, id));
    await closeDatabase();
  });

  it("applies all model effect kinds once with durable lineage markers", async () => {
    const effects = [
      { kind: "set_dimension", dimension: { name: "region", items: ["US"] } },
      { kind: "set_variable", variable: { name: "headcount", kind: "number", dims: ["team"], formula: null, inputs: seeded.byTeam("4", "2") } },
      { kind: "set_item_formula", itemId: seeded.payrollItemId, amountFormula: "sum(payroll)" },
    ] as const;
    for (const effect of effects) {
      const id = await seedDecision(db, seeded.companyId, effect);
      const first = await applyDecisionAndEnqueue(seeded.companyId, id, null, { process: noOpCalculationProcessor });
      const second = await applyDecisionAndEnqueue(seeded.companyId, id, null, { process: noOpCalculationProcessor });
      expect(first.mutation?.applied).toBeTruthy();
      expect(second.calculationRun).toBeNull();
      expect(await markers(seeded.companyId, id)).toHaveLength(1);
      expect((await db.select({ status: decisions.status }).from(decisions).where(eq(decisions.id, id)))[0]!.status).toBe("applied");
    }
    expect((await db.select().from(forecastDimensions).where(and(eq(forecastDimensions.companyId, seeded.companyId), eq(forecastDimensions.name, "region"))))[0]!.items).toEqual(["US"]);
    expect((await db.select().from(forecastVariables).where(eq(forecastVariables.id, seeded.variableIds.headcount)))[0]!.decisionId).toBeTruthy();
    expect((await db.select().from(economicItems).where(eq(economicItems.id, seeded.payrollItemId)))[0]).toMatchObject({ amountFormula: "sum(payroll)" });
  });

  it("rolls back an invalid foreign item effect", async () => {
    const [foreign] = await db.insert(economicItems).values({ companyId: otherCompanyId, type: "obligation", direction: "spend", label: "Foreign", amount: "1", cadence: "monthly", effectiveFrom: seeded.firstMonth, status: "confirmed" }).returning({ id: economicItems.id });
    const id = await seedDecision(db, seeded.companyId, { kind: "set_item_formula", itemId: foreign!.id, amountFormula: "1" });
    const before = (await db.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, seeded.companyId)))[0]!.revision;
    await expect(applyDecisionAndEnqueue(seeded.companyId, id, null, { process: noOpCalculationProcessor })).rejects.toThrow("Economic item not found");
    expect(await markers(seeded.companyId, id)).toHaveLength(0);
    expect((await db.select({ status: decisions.status }).from(decisions).where(eq(decisions.id, id)))[0]!.status).toBe("proposed");
    expect((await db.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, seeded.companyId)))[0]!.revision).toBe(before);
  });

  it("matches a model preview when the decision is applied", async () => {
    await refreshCurrentCalculationRun(seeded.companyId, { cause: { kind: "entity_changed", subjectType: "company", subjectId: seeded.companyId, actorUserId: null, via: "worker" }, rebuildJournalGraphs: false });
    const effect = { kind: "set_variable", variable: { name: "salary", kind: "money", dims: ["team"], formula: null, inputs: seeded.byTeam("11000", "8000") } };
    const id = await seedDecision(db, seeded.companyId, effect);
    const preview = await previewForecastChange(seeded.companyId, { kind: "apply_decision", decisionId: id });
    await applyDecisionAndEnqueue(seeded.companyId, id, null);
    const [landed] = await db.select({ delta: forecastConsequences.delta }).from(forecastConsequences).where(eq(forecastConsequences.companyId, seeded.companyId)).orderBy(desc(sql`${forecastConsequences.revision}::bigint`)).limit(1);
    expect(headline(landed!.delta)).toEqual(headline(preview.consequence));
  });

  it("keeps committed effects durable after processing failure and rolls back enqueue failure", async () => {
    const durableId = await seedDecision(db, seeded.companyId, { kind: "set_dimension", dimension: { name: "market", items: ["Core"] } });
    await expect(applyDecisionAndEnqueue(seeded.companyId, durableId, null, { process: async () => { throw new Error("injected processing failure"); } })).rejects.toThrow("injected processing failure");
    expect(await markers(seeded.companyId, durableId)).toHaveLength(1);
    expect((await db.select({ status: decisions.status }).from(decisions).where(eq(decisions.id, durableId)))[0]!.status).toBe("applied");

    const rollbackId = await seedDecision(db, seeded.companyId, { kind: "set_dimension", dimension: { name: "rolled_back", items: ["No"] } });
    await expect(applyDecisionAndEnqueue(seeded.companyId, rollbackId, null, { enqueue: async () => { throw new Error("injected enqueue failure"); }, process: noOpCalculationProcessor })).rejects.toThrow("injected enqueue failure");
    expect(await markers(seeded.companyId, rollbackId)).toHaveLength(0);
    expect(await db.select().from(forecastDimensions).where(and(eq(forecastDimensions.companyId, seeded.companyId), eq(forecastDimensions.name, "rolled_back")))).toHaveLength(0);
    await applyDecisionAndEnqueue(seeded.companyId, rollbackId, null, { process: noOpCalculationProcessor });
    expect(await markers(seeded.companyId, rollbackId)).toHaveLength(1);
  });

  it("finishes and audits a requested status transition when the effect marker already exists", async () => {
    const id = await seedDecision(db, seeded.companyId, { kind: "set_dimension", dimension: { name: "marker_retry", items: ["One"] } });
    await applyDecisionAndEnqueue(seeded.companyId, id, null, { process: noOpCalculationProcessor });
    const revision = (await db.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, seeded.companyId)))[0]!.revision;
    await db.update(decisions).set({ status: "proposed" }).where(eq(decisions.id, id));
    const beforeAudits = await db.select({ id: auditLog.id }).from(auditLog).where(and(eq(auditLog.companyId, seeded.companyId), eq(auditLog.entityId, id), eq(auditLog.action, "decision.applied")));

    const retried = await applyDecisionAndEnqueue(seeded.companyId, id, null, { process: noOpCalculationProcessor });

    expect(retried.calculationRun).toBeNull();
    expect((await db.select({ status: decisions.status }).from(decisions).where(eq(decisions.id, id)))[0]!.status).toBe("applied");
    expect(await markers(seeded.companyId, id)).toHaveLength(1);
    expect((await db.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, seeded.companyId)))[0]!.revision).toBe(revision);
    expect(await db.select({ id: auditLog.id }).from(auditLog).where(and(eq(auditLog.companyId, seeded.companyId), eq(auditLog.entityId, id), eq(auditLog.action, "decision.applied")))).toHaveLength(beforeAudits.length + 1);
  });

  it("audits an effectless applied decision and resolves reviews without refreshing financial state", async () => {
    const question = `Effectless review ${Date.now()}`;
    await db.insert(reviewItems).values({ companyId: seeded.companyId, question, status: "open" });
    const revision = (await db.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, seeded.companyId)))[0]!.revision;

    const result = await createAppliedDecisionAndEnqueue(seeded.companyId, { question, answer: "Documented only" }, null, { process: noOpCalculationProcessor });

    expect(result.calculationRun).toBeNull();
    expect(result.resolvedReviewCount).toBe(1);
    expect(result.decision.status).toBe("applied");
    expect(await markers(seeded.companyId, result.decision.id)).toHaveLength(0);
    expect((await db.select({ status: reviewItems.status }).from(reviewItems).where(and(eq(reviewItems.companyId, seeded.companyId), eq(reviewItems.question, question))))[0]!.status).toBe("resolved");
    expect(await db.select({ id: auditLog.id }).from(auditLog).where(and(eq(auditLog.companyId, seeded.companyId), eq(auditLog.entityId, result.decision.id), eq(auditLog.action, "decision.applied")))).toHaveLength(1);
    expect((await db.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, seeded.companyId)))[0]!.revision).toBe(revision);
  });

  it("applies a model decision with a one-connection pool", { timeout: 3_000 }, async () => {
    const single = createTestDatabase(process.env.DATABASE_URL!, { max: 1 });
    const bounded = <T>(work: Promise<T>) => Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("single-connection decision timed out")), 2_000))]);
    try {
      const decisionId = await seedDecision(single as typeof db, seeded.companyId, { kind: "set_dimension", dimension: { name: "channel", items: ["Direct"] } });
      const result = await bounded(applyDecisionAndEnqueue(seeded.companyId, decisionId, null, { database: single, process: noOpCalculationProcessor }));
      expect(result.mutation).toMatchObject({ applied: "Sets model dimension channel" });
      expect(await single.select().from(decisionEffectApplications).where(and(eq(decisionEffectApplications.companyId, seeded.companyId), eq(decisionEffectApplications.decisionId, decisionId)))).toHaveLength(1);
    } finally { await single.end(); }
  });
});
