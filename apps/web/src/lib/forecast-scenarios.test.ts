import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

config({ path: fileURLToPath(new URL("../../../../.env.local", import.meta.url)) });
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!process.env.DATABASE_URL)("scenario forecast", async () => {
  if (!process.env.DATABASE_URL) return; // skipped suites still run their factory
  const { calculationRuns, chartAccounts, closeDatabase, companies, decisions, economicItems, evidence, forecastEntryTemplates, getDatabase, scenarios, users } = await import("@finance/database");
  const { refreshCurrentCalculationRun } = await import("./refresh-calculation-run");
  const { previewForecastChange } = await import("./forecast-preview");
  const { forecastAsOfMonth } = await import("./forecast-inputs");
  const { loadScenarioForecast } = await import("./forecast-scenarios");
  const { ScenarioNotFound } = await import("./scenarios");
  const { scenarioChangeToEffect } = await import("./scenario-changes");
  const { addMonths } = await import("@balsa/finance-engine");
  const db = getDatabase();
  let companyId = ""; let otherCompanyId = ""; let firstMonth = "";
  const headline = (delta: unknown) => { const value = delta as { horizonEndCash: unknown; cashOutMonth: unknown; runwayMonths: unknown; projectedSpending: unknown; projectedReceipts: unknown }; return { horizonEndCash: value.horizonEndCash, cashOutMonth: value.cashOutMonth, runwayMonths: value.runwayMonths, projectedSpending: value.projectedSpending, projectedReceipts: value.projectedReceipts }; };
  const newScenario = async (name: string, changes: unknown[] = [], company = companyId) => (await db.insert(scenarios).values({ companyId: company, name, changes }).returning({ id: scenarios.id }))[0]!.id;

  beforeAll(async () => {
    const [company, other] = await db.insert(companies).values([{ name: `Scenario forecast ${Date.now()}` }, { name: `Scenario forecast other ${Date.now()}` }]).returning({ id: companies.id });
    companyId = company!.id; otherCompanyId = other!.id;
    const accounts = await db.insert(chartAccounts).values([
      { companyId, code: "1000", name: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" },
      { companyId, code: "4000", name: "Revenue", accountType: "revenue", normalBalance: "credit" },
      { companyId, code: "6000", name: "Payroll", accountType: "expense", normalBalance: "debit" },
    ]).returning({ id: chartAccounts.id, code: chartAccounts.code });
    const account = (code: string) => accounts.find((row) => row.code === code)!.id;
    await db.insert(forecastEntryTemplates).values([
      { companyId, name: "Spend", itemType: "obligation", direction: "spend", debitAccountId: account("6000"), creditAccountId: account("1000") },
      { companyId, name: "Receipts", itemType: "agreement", direction: "receipt", debitAccountId: account("1000"), creditAccountId: account("4000") },
    ]);
    firstMonth = addMonths(await forecastAsOfMonth(companyId, new Date()), 1);
    await db.insert(economicItems).values({ companyId, type: "obligation", direction: "spend", label: "Payroll", amount: "1000", cadence: "monthly", effectiveFrom: firstMonth, category: "salary", status: "confirmed" });
    await refreshCurrentCalculationRun(companyId, { cause: { kind: "entity_changed", subjectType: "company", subjectId: companyId, actorUserId: null, via: "worker" } });
  });

  afterAll(async () => {
    for (const id of [companyId, otherCompanyId]) if (id) await db.delete(companies).where(eq(companies.id, id));
    await closeDatabase();
  });

  it("gives an add_driver the same consequence as previewing the equivalent proposed decision", async () => {
    const change = { kind: "add_driver" as const, label: "Contractor", direction: "spend" as const, amount: 250, cadence: "monthly" as const, effectiveFrom: firstMonth, category: "contractor" as const };
    const scenarioId = await newScenario("Contractor", [change]);
    const [decision] = await db.insert(decisions).values({ companyId, question: "Hire a contractor?", answer: "Yes", status: "proposed", effect: JSON.stringify(scenarioChangeToEffect(change)) }).returning({ id: decisions.id });
    const forecast = await loadScenarioForecast(companyId, scenarioId);
    const preview = await previewForecastChange(companyId, { kind: "apply_decision", decisionId: decision!.id });
    expect(forecast.consequence).not.toBeNull();
    expect(headline(forecast.consequence)).toEqual(headline(preview.consequence));
    expect(forecast.consequence!.drivers.added.map((driver) => driver.id)).toEqual([`scenario:${scenarioId}:0`]);
    expect(forecast.scenario).toEqual({ id: scenarioId, name: "Contractor", description: null, changes: [change], itemCount: 0 });
    expect(forecast.months.length).toBe(24);
    expect(forecast.months.every((month) => month.basis === "forecast")).toBe(true);
  });

  it("includes the scenario's confirmed items, not its drafts", async () => {
    const scenarioId = await newScenario("With items");
    await db.insert(economicItems).values([
      { companyId, scenarioId, type: "agreement", direction: "receipt", label: "Grant", amount: "400", cadence: "monthly", effectiveFrom: firstMonth, category: "other_revenue", status: "confirmed" },
      { companyId, scenarioId, type: "agreement", direction: "receipt", label: "Draft grant", amount: "900", cadence: "monthly", effectiveFrom: firstMonth, status: "draft" },
    ]);
    const forecast = await loadScenarioForecast(companyId, scenarioId);
    expect(forecast.scenario.itemCount).toBe(1);
    expect(forecast.consequence!.drivers.added.map((driver) => driver.label)).toEqual(["Grant"]);
    // 400.00 a month over the 24-month horizon that starts at firstMonth.
    expect(forecast.consequence!.projectedReceipts.deltaMinor).toBe("960000");
  });

  it("persists nothing and reuses the stored input instead of reading the ledger", async () => {
    const ledger = await import("./journal-ledger");
    const scenarioId = await newScenario("Read only", [{ kind: "add_driver", label: "Rent", direction: "spend", amount: 100, cadence: "monthly", effectiveFrom: firstMonth }]);
    const runsBefore = (await db.select({ id: calculationRuns.id }).from(calculationRuns).where(eq(calculationRuns.companyId, companyId))).length;
    const revisionBefore = (await db.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, companyId)))[0]!.revision;
    const spy = vi.spyOn(ledger, "loadPostedJournalLines");
    await loadScenarioForecast(companyId, scenarioId);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect((await db.select({ id: calculationRuns.id }).from(calculationRuns).where(eq(calculationRuns.companyId, companyId))).length).toBe(runsBefore);
    expect((await db.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, companyId)))[0]!.revision).toBe(revisionBefore);
  });

  it("resolves sources for the company's own evidence only", async () => {
    const stamp = Date.now();
    const [user] = await db.insert(users).values({ authProvider: "test", authProviderUserId: `scenario-sources-${stamp}`, email: `scenario-sources-${stamp}@example.com` }).returning({ id: users.id });
    try {
      const [own] = await db.insert(evidence).values({ companyId, createdByUserId: user!.id, sourceName: "Grant letter.pdf", rawText: "" }).returning({ id: evidence.id });
      const [foreign] = await db.insert(evidence).values({ companyId: otherCompanyId, createdByUserId: user!.id, sourceName: "Secret.pdf", rawText: "" }).returning({ id: evidence.id });
      const scenarioId = await newScenario("Sourced");
      await db.insert(economicItems).values([
        { companyId, scenarioId, evidenceId: own!.id, type: "agreement", direction: "receipt", label: "Grant A", amount: "100", cadence: "monthly", effectiveFrom: firstMonth, status: "confirmed" },
        { companyId, scenarioId, evidenceId: foreign!.id, type: "agreement", direction: "receipt", label: "Grant B", amount: "100", cadence: "monthly", effectiveFrom: firstMonth, status: "confirmed" },
      ]);
      expect((await loadScenarioForecast(companyId, scenarioId)).sources).toEqual([{ evidenceId: own!.id, sourceName: "Grant letter.pdf" }]);
    } finally {
      await db.delete(users).where(eq(users.id, user!.id));
    }
  });

  it("treats another company's, an inactive, or a malformed scenario id as not found", async () => {
    const foreign = await newScenario("Foreign", [], otherCompanyId);
    await expect(loadScenarioForecast(companyId, foreign)).rejects.toBeInstanceOf(ScenarioNotFound);
    const inactive = await newScenario("Gone");
    await db.update(scenarios).set({ active: "N" }).where(eq(scenarios.id, inactive));
    await expect(loadScenarioForecast(companyId, inactive)).rejects.toBeInstanceOf(ScenarioNotFound);
    await expect(loadScenarioForecast(companyId, "not-a-uuid")).rejects.toBeInstanceOf(ScenarioNotFound);
  });
});
