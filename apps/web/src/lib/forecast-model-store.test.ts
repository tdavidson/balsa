import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ForecastConsequence } from "@nevermodel/finance-engine";

config({ path: fileURLToPath(new URL("../../../../.env.local", import.meta.url)) });
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!process.env.DATABASE_URL)("forecast model store", async () => {
  if (!process.env.DATABASE_URL) return; // skipped suites still run their factory
  const { calculationOutbox, closeDatabase, companies, decisions, economicItems, financialStateRevisions, forecastVariables, getDatabase } = await import("@finance/database");
  const { addMonths } = await import("@nevermodel/finance-engine");
  const { seedModelCompany } = await import("./forecast-model-fixture");
  const store = await import("./forecast-model-store");
  const { loadForecastInputs, loadForecastModel } = await import("./forecast-inputs");
  const { loadLatestForecast, loadRecentConsequences } = await import("./forecast-read");
  const { refreshCurrentCalculationRun } = await import("./refresh-calculation-run");
  const { describeCause } = await import("./consequence-copy");
  const { commitModelWrite } = await import("./forecast-model-http");
  const { createTestDatabase } = await import("./test-database");
  const db = getDatabase();
  let seeded!: Awaited<ReturnType<typeof seedModelCompany>>;
  let otherCompanyId = "";
  const revision = async () => (await db.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, seeded.companyId)))[0]!.revision;
  const activeVariables = async () => (await db.select({ id: forecastVariables.id }).from(forecastVariables).where(and(eq(forecastVariables.companyId, seeded.companyId), eq(forecastVariables.active, "Y")))).length;

  beforeAll(async () => {
    seeded = await seedModelCompany("Model store");
    const [other] = await db.insert(companies).values({ name: `Model store other ${Date.now()}` }).returning({ id: companies.id });
    otherCompanyId = other!.id;
  });

  afterAll(async () => {
    for (const id of [seeded?.companyId, otherCompanyId]) if (id) await db.delete(companies).where(eq(companies.id, id));
    await closeDatabase();
  });

  it("loads the model canonically and runs the formula driver through the stored forecast", async () => {
    const input = await loadForecastInputs(seeded.companyId);
    expect(input.model!.variables.map((variable) => variable.name)).toEqual(["headcount", "payroll", "salary", "tax"]);
    expect(input.drivers.find((driver) => driver.id === seeded.payrollItemId)).toMatchObject({ amountFormula: "sum(payroll) + sum(tax)" });
    const latest = (await loadLatestForecast(seeded.companyId))!;
    expect(latest.run.exceptions).toEqual([]);
    expect(latest.run.runway.runwayMonths).toBe(20);
    expect(latest.run.modelSummary!.variables.map((variable) => variable.name)).toEqual(["headcount", "payroll", "salary", "tax"]);
  });

  it("rejects an invalid resulting model with 422 and writes nothing", async () => {
    const before = await activeVariables();
    await expect(store.createVariable(seeded.companyId, { name: "bonus", kind: "money", dims: [], formula: "sum(nope)", inputs: [] })).rejects.toMatchObject({ status: 422, issues: [{ variable: "bonus", position: 4, message: 'Unknown variable "nope"' }] });
    await expect(store.updateVariable(seeded.companyId, seeded.variableIds.payroll, { formula: "tax" })).rejects.toMatchObject({ status: 422 });
    // The item formula reads tax, and the variables read team: neither can be removed.
    await expect(store.deactivateVariable(seeded.companyId, seeded.variableIds.tax)).rejects.toMatchObject({ status: 422 });
    await expect(store.deactivateDimension(seeded.companyId, seeded.dimensionId)).rejects.toMatchObject({ status: 422 });
    expect(await activeVariables()).toBe(before);
  });

  it("commits the mutation, revision cause, and outbox atomically, then preserves the write when calculation fails", async () => {
    const before = await revision();
    const failed = await commitModelWrite(seeded.companyId, { kind: "model_changed", subjectType: "forecast_variable", actorUserId: null, via: "ui" }, async (tx) => {
      const row = await store.createVariableWith(tx, seeded.companyId, { name: "atomic_bonus", kind: "money", dims: [], formula: null, inputs: [{ coords: {}, from: seeded.firstMonth, value: "1" }] });
      return { value: row, subjectId: row.id };
    }, { process: async (receipt) => ({ financialStateRevision: receipt.financialStateRevision, status: "failed" as const, forecastJobId: receipt.forecastJobId, forecastStatus: "failed", error: "injected calculation failure" }) });
    expect(failed.calculationRun).toMatchObject({ status: "failed", error: "injected calculation failure" });
    expect(await revision()).toBe(String(BigInt(before) + 1n));
    expect((await loadForecastModel(seeded.companyId))!.variables.some((variable) => variable.name === "atomic_bonus")).toBe(true);
    const causes = await db.select().from(financialStateRevisions).where(and(eq(financialStateRevisions.companyId, seeded.companyId), eq(financialStateRevisions.revision, failed.calculationRun.financialStateRevision)));
    const jobs = await db.select().from(calculationOutbox).where(and(eq(calculationOutbox.companyId, seeded.companyId), eq(calculationOutbox.financialStateRevision, failed.calculationRun.financialStateRevision)));
    expect(causes).toHaveLength(1);
    expect(jobs.filter((job) => job.period === "forecast")).toHaveLength(1);

    const beforeRollback = await revision();
    await expect(commitModelWrite(seeded.companyId, { kind: "model_changed", subjectType: "forecast_variable", actorUserId: null, via: "ui" }, async (tx) => {
      const row = await store.createVariableWith(tx, seeded.companyId, { name: "must_rollback", kind: "number", dims: [], formula: null, inputs: [] });
      return { value: row, subjectId: row.id };
    }, { enqueue: async () => { throw new Error("injected enqueue failure"); } })).rejects.toThrow("injected enqueue failure");
    expect(await revision()).toBe(beforeRollback);
    expect((await loadForecastModel(seeded.companyId))!.variables.some((variable) => variable.name === "must_rollback")).toBe(false);
  });

  it("uses one database connection for an executor-aware store write and atomic enqueue", { timeout: 3_000 }, async () => {
    const [decision] = await db.insert(decisions).values({ companyId: seeded.companyId, question: "Keep headcount current?", answer: "Yes", status: "applied" }).returning({ id: decisions.id });
    const single = createTestDatabase(process.env.DATABASE_URL!, { max: 1 });
    const bounded = <T>(work: Promise<T>) => Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("single-connection path timed out")), 2_000))]);
    try {
      await bounded(commitModelWrite(seeded.companyId, { kind: "model_changed", subjectType: "forecast_variable", actorUserId: null, via: "ui" }, async (tx) => {
        const row = await store.upsertVariableByNameWith(tx, seeded.companyId, { name: "headcount", kind: "number", dims: ["team"], formula: null, inputs: seeded.byTeam("3", "2") }, decision!.id);
        return { value: row, subjectId: row.id };
      }, { database: single, process: async (receipt) => ({ financialStateRevision: receipt.financialStateRevision, status: "not_queued" as const, forecastJobId: receipt.forecastJobId, forecastStatus: "not_queued" }) }));
    } finally { await single.end(); }
  });

  it("rejects a duplicate active name with 409", async () => {
    await expect(store.createDimension(seeded.companyId, { name: "team", items: ["X"] })).rejects.toMatchObject({ status: 409 });
    await expect(store.createVariable(seeded.companyId, { name: "salary", kind: "money", dims: [], formula: null, inputs: [] })).rejects.toMatchObject({ status: 409 });
  });

  it("validates an item formula against the model", async () => {
    await expect(store.setItemFormula(seeded.companyId, seeded.payrollItemId, "payroll")).rejects.toMatchObject({ status: 422, issues: [{ driverId: seeded.payrollItemId, message: "The formula still has dimensions team; use sum(...) to collapse team" }] });
  });

  it("validates the final formula before confirming and rolls the whole commit back", async () => {
    const dependency = await store.createVariable(seeded.companyId, { name: "temporary_confirmation_input", kind: "money", dims: [], formula: null, inputs: [{ coords: {}, from: seeded.firstMonth, value: "25" }] });
    const [draft] = await db.insert(economicItems).values({ companyId: seeded.companyId, type: "obligation", direction: "spend", label: "Draft formula expense", cadence: "monthly", effectiveFrom: seeded.firstMonth, status: "draft" }).returning();
    await store.setItemFormula(seeded.companyId, draft!.id, "temporary_confirmation_input");
    await store.deactivateVariable(seeded.companyId, dependency.id);
    const before = await revision();

    await expect(commitModelWrite(seeded.companyId, { kind: "item_confirmed", subjectType: "economic_item", actorUserId: null, via: "ui" }, async (tx) => {
      const rows = await store.confirmItemsWith(tx, seeded.companyId, [draft!.id], { label: "Edited while confirming" });
      return { value: rows, subjectId: rows[0]!.id };
    })).rejects.toMatchObject({ status: 422, issues: [{ driverId: draft!.id, position: 0, message: 'Unknown variable "temporary_confirmation_input"' }] });

    const [unchanged] = await db.select().from(economicItems).where(eq(economicItems.id, draft!.id));
    expect(unchanged).toMatchObject({ status: "draft", label: "Draft formula expense", amountFormula: "temporary_confirmation_input" });
    expect(await revision()).toBe(before);
  });

  it("rejects foreign decision lineage on every accepting store path", async () => {
    const [foreignDecision] = await db.insert(decisions).values({ companyId: otherCompanyId, question: "Foreign model change?", answer: "Yes", status: "applied" }).returning({ id: decisions.id });
    const beforeFormula = (await db.select({ formula: economicItems.amountFormula }).from(economicItems).where(eq(economicItems.id, seeded.payrollItemId)))[0]!.formula;

    await expect(store.createVariable(seeded.companyId, { name: "foreign_lineage_create", kind: "number", dims: [], formula: null, inputs: [] }, { decisionId: foreignDecision!.id })).rejects.toMatchObject({ status: 404, message: "Decision not found" });
    await expect(store.upsertVariableByName(seeded.companyId, { name: "foreign_lineage_upsert", kind: "number", dims: [], formula: null, inputs: [] }, foreignDecision!.id)).rejects.toMatchObject({ status: 404, message: "Decision not found" });
    await expect(store.setItemFormula(seeded.companyId, seeded.payrollItemId, "sum(payroll)", { decisionId: foreignDecision!.id })).rejects.toMatchObject({ status: 404, message: "Decision not found" });

    expect((await loadForecastModel(seeded.companyId))!.variables.some((variable) => variable.name.startsWith("foreign_lineage_"))).toBe(false);
    expect((await db.select({ formula: economicItems.amountFormula }).from(economicItems).where(eq(economicItems.id, seeded.payrollItemId)))[0]!.formula).toBe(beforeFormula);
  });

  it("dry-runs a draft with samples and writes nothing", async () => {
    const before = await revision();
    const months = [seeded.firstMonth, addMonths(seeded.firstMonth, 1), addMonths(seeded.firstMonth, 2)];
    const values = (value: string) => Object.fromEntries(months.map((month) => [month, value]));
    const result = await store.validateModelDraft(seeded.companyId, { variables: [{ name: "salary", kind: "money", dims: ["team"], formula: null, inputs: seeded.byTeam("12000", "8000") }], itemFormula: "sum(payroll)" });
    expect(result.errors).toEqual([]);
    expect(result.sample.salary).toEqual({ dims: ["team"], rows: [{ coords: { team: "Eng" }, values: values("12000") }, { coords: { team: "Sales" }, values: values("8000") }] });
    expect(result.itemSample).toEqual(values("52000"));
    expect((await store.validateModelDraft(seeded.companyId, { itemFormula: "payroll" })).errors).toEqual([{ driverId: "draft", message: "The formula still has dimensions team; use sum(...) to collapse team" }]);
    expect(await revision()).toBe(before);
  });

  it("bumps the revision and records a consequence for a model write", async () => {
    const before = await revision();
    const salary = await store.updateVariable(seeded.companyId, seeded.variableIds.salary, { inputs: seeded.byTeam("12000", "8000") });
    const result = await refreshCurrentCalculationRun(seeded.companyId, { cause: { kind: "model_changed", subjectType: "forecast_variable", subjectId: salary.id, actorUserId: null, via: "ui" }, rebuildJournalGraphs: false });
    expect(BigInt(result.financialStateRevision)).toBe(BigInt(before) + 1n);
    const [cause] = await db.select().from(financialStateRevisions).where(and(eq(financialStateRevisions.companyId, seeded.companyId), eq(financialStateRevisions.revision, result.financialStateRevision)));
    expect(cause).toMatchObject({ kind: "model_changed", subjectType: "forecast_variable", subjectId: salary.id });
    const [consequence] = await loadRecentConsequences(seeded.companyId, 1);
    expect(consequence!.revision).toBe(result.financialStateRevision);
    // Eng salary +2,000 × 3 heads = +6,000 payroll and +459 tax: 645,900 minor units in each of 24 months.
    expect((consequence!.delta as ForecastConsequence).projectedSpending.deltaMinor).toBe("15501600");
    expect(describeCause(consequence!.causes[0]!)).toBe("Changed the model: salary");
  });

  it("scopes every write and read to the company", async () => {
    await expect(store.updateVariable(otherCompanyId, seeded.variableIds.salary, { inputs: [] })).rejects.toMatchObject({ status: 404 });
    await expect(store.deactivateDimension(otherCompanyId, seeded.dimensionId)).rejects.toMatchObject({ status: 404 });
    await expect(store.setItemFormula(otherCompanyId, seeded.payrollItemId, "1")).rejects.toMatchObject({ status: 404 });
    expect(await loadForecastModel(otherCompanyId)).toBeUndefined();
  });
});
