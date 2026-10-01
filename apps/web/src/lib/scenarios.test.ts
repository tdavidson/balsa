import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: fileURLToPath(new URL("../../../../.env.local", import.meta.url)) });
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!process.env.DATABASE_URL)("scenarios", async () => {
  if (!process.env.DATABASE_URL) return; // skipped suites still run their factory
  const { chartAccounts, closeDatabase, companies, decisions, economicItems, forecastEntryTemplates, getDatabase, scenarios } = await import("@finance/database");
  const { refreshCurrentCalculationRun } = await import("./refresh-calculation-run");
  const { applyDecisionEffect, applyDecisionIfEffective, parseStoredEffect } = await import("./decision-effects");
  const { forecastAsOfMonth, loadForecastInputs } = await import("./forecast-inputs");
  const { loadScenarioForecast } = await import("./forecast-scenarios");
  const { createScenario, deactivateScenario, listScenarios, loadActiveScenario, promoteScenario, scenarioFromDecision, updateScenario, ScenarioConflict, ScenarioInvalid, ScenarioNotFound } = await import("./scenarios");
  const { addMonths, buildForecastRun } = await import("@balsa/finance-engine");
  const db = getDatabase();
  const companyIds: string[] = [];
  let main = { id: "", firstMonth: "", payrollId: "", softwareId: "" };
  let other = { id: "", firstMonth: "", payrollId: "", softwareId: "" };

  /** A company with cash, revenue, and payroll accounts; spend and receipt templates; confirmed Payroll and Software items; and a persisted forecast run. */
  async function seedCompany(label: string) {
    const [company] = await db.insert(companies).values({ name: `${label} ${Date.now()}` }).returning({ id: companies.id });
    const id = company!.id; companyIds.push(id);
    const accounts = await db.insert(chartAccounts).values([
      { companyId: id, code: "1000", name: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" },
      { companyId: id, code: "4000", name: "Revenue", accountType: "revenue", normalBalance: "credit" },
      { companyId: id, code: "6000", name: "Payroll", accountType: "expense", normalBalance: "debit" },
    ]).returning({ id: chartAccounts.id, code: chartAccounts.code });
    const account = (code: string) => accounts.find((row) => row.code === code)!.id;
    await db.insert(forecastEntryTemplates).values([
      { companyId: id, name: "Spend", itemType: "obligation", direction: "spend", debitAccountId: account("6000"), creditAccountId: account("1000") },
      { companyId: id, name: "Receipts", itemType: "agreement", direction: "receipt", debitAccountId: account("1000"), creditAccountId: account("4000") },
    ]);
    const firstMonth = addMonths(await forecastAsOfMonth(id, new Date()), 1);
    const items = await db.insert(economicItems).values([
      { companyId: id, type: "obligation", direction: "spend", label: "Payroll", amount: "1000", cadence: "monthly", effectiveFrom: firstMonth, category: "salary", status: "confirmed" },
      { companyId: id, type: "obligation", direction: "spend", label: "Software", amount: "120", cadence: "monthly", effectiveFrom: firstMonth, category: "software", status: "confirmed" },
    ]).returning({ id: economicItems.id, label: economicItems.label });
    await refreshCurrentCalculationRun(id, { cause: { kind: "entity_changed", subjectType: "company", subjectId: id, actorUserId: null, via: "worker" } });
    return { id, firstMonth, payrollId: items.find((item) => item.label === "Payroll")!.id, softwareId: items.find((item) => item.label === "Software")!.id };
  }

  beforeAll(async () => {
    main = await seedCompany("Scenarios");
    other = await seedCompany("Scenarios other");
  });

  afterAll(async () => {
    if (companyIds.length) await db.delete(companies).where(inArray(companies.id, companyIds));
    await closeDatabase();
  });

  it("creates, lists, updates, and deactivates, with names unique among active scenarios", async () => {
    const change = { kind: "end_item" as const, itemId: main.softwareId, effectiveTo: main.firstMonth };
    const created = await createScenario(main.id, { name: "Hiring", description: " Two hires " }, null);
    expect(created).toMatchObject({ name: "Hiring", description: "Two hires", changes: [], itemCount: 0 });
    await expect(createScenario(main.id, { name: "Hiring" }, null)).rejects.toBeInstanceOf(ScenarioConflict);
    expect(await createScenario(other.id, { name: "Hiring" }, null)).toMatchObject({ name: "Hiring" });
    expect((await listScenarios(main.id)).find((scenario) => scenario.id === created.id)).toEqual({ id: created.id, name: "Hiring", description: "Two hires", changeCount: 0, itemCount: 0 });

    const updated = await updateScenario(main.id, created.id, { changes: [change], description: null }, null);
    expect(updated).toMatchObject({ name: "Hiring", description: null, changes: [change] });
    expect((await listScenarios(main.id)).find((scenario) => scenario.id === created.id)?.changeCount).toBe(1);
    const second = await createScenario(main.id, { name: "Hiring later" }, null);
    await expect(updateScenario(main.id, second.id, { name: "Hiring" }, null)).rejects.toBeInstanceOf(ScenarioConflict);

    await deactivateScenario(main.id, created.id, null);
    expect((await listScenarios(main.id)).some((scenario) => scenario.id === created.id)).toBe(false);
    await expect(updateScenario(main.id, created.id, { name: "Back" }, null)).rejects.toBeInstanceOf(ScenarioNotFound);
    await expect(deactivateScenario(main.id, created.id, null)).rejects.toBeInstanceOf(ScenarioNotFound);
    expect(await createScenario(main.id, { name: "Hiring" }, null)).toMatchObject({ name: "Hiring" });
  });

  it("serializes concurrent active-name allocation", async () => {
    const creates = await Promise.allSettled([
      createScenario(main.id, { name: "Concurrent create" }, null),
      createScenario(main.id, { name: "Concurrent create" }, null),
    ]);
    expect(creates.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = creates.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(ScenarioConflict);

    const [decision] = await db.insert(decisions).values({ companyId: main.id, question: "Concurrent decision", answer: "Yes", status: "proposed", effect: JSON.stringify({ kind: "end_item", itemId: main.softwareId, effectiveTo: main.firstMonth }) }).returning({ id: decisions.id });
    const generated = await Promise.all([
      scenarioFromDecision(main.id, decision!.id, null),
      scenarioFromDecision(main.id, decision!.id, null),
    ]);
    expect(generated.map((scenario) => scenario.name).sort()).toEqual(["Concurrent decision", "Concurrent decision (2)"]);
  });

  it("shares active-name allocation with decision effects that create scenarios", async () => {
    const [decision] = await db.insert(decisions).values({ companyId: main.id, question: "Concurrent named effect", answer: "Yes", status: "applied" }).returning({ id: decisions.id });
    const effect = { kind: "add_item" as const, scenario: "Concurrent effect scenario", item: { label: "Concurrent grant", direction: "receipt" as const, amount: 25, cadence: "monthly" as const, effectiveFrom: main.firstMonth, category: "other_revenue" as const, accountingTreatment: "cash" as const } };
    const [created, applied] = await Promise.allSettled([
      createScenario(main.id, { name: effect.scenario }, null),
      applyDecisionEffect(main.id, decision!.id, effect, null),
    ]);
    expect(applied.status).toBe("fulfilled");
    if (created.status === "rejected") expect(created.reason).toBeInstanceOf(ScenarioConflict);
    const active = await db.select({ id: scenarios.id }).from(scenarios).where(and(eq(scenarios.companyId, main.id), eq(scenarios.name, effect.scenario), eq(scenarios.active, "Y")));
    expect(active).toHaveLength(1);
    const [item] = await db.select({ scenarioId: economicItems.scenarioId }).from(economicItems).where(eq(economicItems.decisionId, decision!.id));
    expect(item?.scenarioId).toBe(active[0]!.id);
  });

  it("applies one decision effect at most once under concurrent retries", async () => {
    const effect = { kind: "add_item", item: { label: "One grant", direction: "receipt", amount: 40, cadence: "monthly", effectiveFrom: main.firstMonth, category: "other_revenue", accountingTreatment: "cash" } };
    const [decision] = await db.insert(decisions).values({ companyId: main.id, question: "One concurrent grant", answer: "Yes", status: "applied", effect: JSON.stringify(effect) }).returning({ id: decisions.id });
    const results = await Promise.all([
      applyDecisionIfEffective(main.id, decision!.id, null),
      applyDecisionIfEffective(main.id, decision!.id, null),
    ]);
    expect(results.map((result) => result?.applied).sort()).toEqual(["Adds a receipt: One grant $40 monthly from " + main.firstMonth, "already applied"].sort());
    const items = await db.select({ id: economicItems.id }).from(economicItems).where(and(eq(economicItems.companyId, main.id), eq(economicItems.decisionId, decision!.id)));
    expect(items).toHaveLength(1);
  });

  it("serializes promotion with scenario deactivation", async () => {
    const scenario = await createScenario(main.id, { name: "Promote or deactivate", changes: [{ kind: "end_item", itemId: main.softwareId, effectiveTo: main.firstMonth }] }, null);
    const [promotion, deactivation] = await Promise.allSettled([
      promoteScenario(main.id, scenario.id, null),
      deactivateScenario(main.id, scenario.id, null),
    ]);
    expect(deactivation.status).toBe("fulfilled");
    if (promotion.status === "rejected") expect(promotion.reason).toBeInstanceOf(ScenarioNotFound);
    else expect(promotion.value.decisionIds).toHaveLength(1);
    await expect(loadActiveScenario(main.id, scenario.id)).rejects.toBeInstanceOf(ScenarioNotFound);
  });

  it("rejects changes that target another company's item, a draft, or a scenario item", async () => {
    const [draft] = await db.insert(economicItems).values({ companyId: main.id, type: "obligation", direction: "spend", label: "Draft", amount: "5", cadence: "monthly", effectiveFrom: main.firstMonth, status: "draft" }).returning({ id: economicItems.id });
    const holder = await createScenario(main.id, { name: "Holder" }, null);
    const [tagged] = await db.insert(economicItems).values({ companyId: main.id, scenarioId: holder.id, type: "obligation", direction: "spend", label: "Tagged", amount: "5", cadence: "monthly", effectiveFrom: main.firstMonth, status: "confirmed" }).returning({ id: economicItems.id });
    for (const itemId of [other.payrollId, draft!.id, tagged!.id]) {
      await expect(createScenario(main.id, { name: `Bad ${itemId}`, changes: [{ kind: "end_item", itemId, effectiveTo: main.firstMonth }] }, null)).rejects.toBeInstanceOf(ScenarioInvalid);
      await expect(updateScenario(main.id, holder.id, { changes: [{ kind: "change_amount", itemId, amount: 1, effectiveFrom: main.firstMonth }] }, null)).rejects.toBeInstanceOf(ScenarioInvalid);
    }
  });

  it("scopes every read and write to the company", async () => {
    const foreign = await createScenario(other.id, { name: "Foreign" }, null);
    const [foreignDecision] = await db.insert(decisions).values({ companyId: other.id, question: "Foreign?", answer: "Yes", status: "proposed", effect: JSON.stringify({ kind: "end_item", itemId: other.softwareId, effectiveTo: other.firstMonth }) }).returning({ id: decisions.id });
    await expect(loadActiveScenario(main.id, foreign.id)).rejects.toBeInstanceOf(ScenarioNotFound);
    await expect(loadScenarioForecast(main.id, foreign.id)).rejects.toBeInstanceOf(ScenarioNotFound);
    await expect(updateScenario(main.id, foreign.id, { name: "Stolen" }, null)).rejects.toBeInstanceOf(ScenarioNotFound);
    await expect(deactivateScenario(main.id, foreign.id, null)).rejects.toBeInstanceOf(ScenarioNotFound);
    await expect(promoteScenario(main.id, foreign.id, null)).rejects.toBeInstanceOf(ScenarioNotFound);
    await expect(scenarioFromDecision(main.id, foreignDecision!.id, null)).rejects.toBeInstanceOf(ScenarioNotFound);
    expect((await listScenarios(main.id)).some((scenario) => scenario.id === foreign.id)).toBe(false);
    expect((await loadActiveScenario(other.id, foreign.id)).name).toBe("Foreign");
  });

  it("promotes to proposed decisions that, applied one by one, reach the scenario's forecast", async () => {
    const company = await seedCompany("Scenario promotion");
    const scenario = await createScenario(company.id, { name: "Promote me", changes: [
      { kind: "add_driver", label: "Contractor", direction: "spend", amount: 250, cadence: "monthly", effectiveFrom: company.firstMonth, category: "contractor" },
      { kind: "change_amount", itemId: company.payrollId, amount: 1200, effectiveFrom: addMonths(company.firstMonth, 3) },
      { kind: "end_item", itemId: company.softwareId, effectiveTo: addMonths(company.firstMonth, 5) },
    ] }, null);
    await db.insert(economicItems).values({ companyId: company.id, scenarioId: scenario.id, type: "agreement", direction: "receipt", label: "Grant", amount: "400", cadence: "monthly", effectiveFrom: company.firstMonth, category: "other_revenue", status: "confirmed" });
    const expected = await loadScenarioForecast(company.id, scenario.id);
    expect(expected.consequence).not.toBeNull();

    const { decisionIds, skippedItems } = await promoteScenario(company.id, scenario.id, null);
    expect(skippedItems).toBe(0);
    expect(decisionIds).toHaveLength(4);
    const rows = await db.select().from(decisions).where(inArray(decisions.id, decisionIds));
    expect(rows.every((row) => row.status === "proposed" && row.question.startsWith("Apply from scenario Promote me: "))).toBe(true);
    expect(rows.map((row) => row.question)).toContain(`Apply from scenario Promote me: Changes Payroll to $1,200 from ${addMonths(company.firstMonth, 3)}`);
    // Promotion alone changes nothing: until the CFO applies each proposal, the base is still the scenario's "before".
    expect(buildForecastRun(await loadForecastInputs(company.id)).runway.runwayMonths).toBe(expected.consequence!.runwayMonths.before);

    for (const id of decisionIds) {
      await db.update(decisions).set({ status: "applied" }).where(eq(decisions.id, id));
      await applyDecisionIfEffective(company.id, id, null);
    }
    const after = buildForecastRun(await loadForecastInputs(company.id));
    expect(after.runway).toEqual(expected.runway);
    expect(after.months.filter((month) => month.basis === "forecast").map((month) => month.endingCashMinor)).toEqual(expected.months.map((month) => month.endingCashMinor));
  });

  it("round-trips a proposed decision through a scenario", async () => {
    const effect = { kind: "add_item", item: { label: "Designer", direction: "spend", amount: 300, cadence: "monthly", effectiveFrom: main.firstMonth, category: "contractor", accountingTreatment: "cash" } };
    const [decision] = await db.insert(decisions).values({ companyId: main.id, question: "Hire a designer?", answer: "Yes", status: "proposed", effect: JSON.stringify(effect) }).returning({ id: decisions.id });
    const scenario = await scenarioFromDecision(main.id, decision!.id, null);
    expect(scenario).toMatchObject({ name: "Hire a designer?", description: "From proposed decision: Hire a designer?", itemCount: 0 });
    expect(scenario.changes).toEqual([{ kind: "add_driver", label: "Designer", direction: "spend", amount: 300, cadence: "monthly", effectiveFrom: main.firstMonth, category: "contractor" }]);
    expect((await scenarioFromDecision(main.id, decision!.id, null)).name).toBe("Hire a designer? (2)");

    const { decisionIds } = await promoteScenario(main.id, scenario.id, null);
    const [promoted] = await db.select({ effect: decisions.effect }).from(decisions).where(eq(decisions.id, decisionIds[0]!));
    expect(parseStoredEffect(promoted!.effect)).toEqual(parseStoredEffect(JSON.stringify(effect)));
  });

  it("refuses decisions that are not proposed or hold no driver change", async () => {
    const [applied] = await db.insert(decisions).values({ companyId: main.id, question: "Done?", answer: "Yes", status: "applied", effect: JSON.stringify({ kind: "end_item", itemId: main.softwareId, effectiveTo: main.firstMonth }) }).returning({ id: decisions.id });
    const [plain] = await db.insert(decisions).values({ companyId: main.id, question: "Just a note?", answer: "Yes", status: "proposed" }).returning({ id: decisions.id });
    await expect(scenarioFromDecision(main.id, applied!.id, null)).rejects.toBeInstanceOf(ScenarioConflict);
    await expect(scenarioFromDecision(main.id, plain!.id, null)).rejects.toBeInstanceOf(ScenarioInvalid);
    await expect(scenarioFromDecision(main.id, "not-a-uuid", null)).rejects.toBeInstanceOf(ScenarioNotFound);
  });

  it("files a decision's scenario item under an active scenario, never a deactivated one of the same name", async () => {
    const old = await createScenario(main.id, { name: "Revived" }, null);
    await deactivateScenario(main.id, old.id, null);
    const [decision] = await db.insert(decisions).values({ companyId: main.id, question: "Assume a grant?", answer: "Yes", status: "applied", effect: JSON.stringify({ kind: "add_item", scenario: "Revived", item: { label: "Grant", direction: "receipt", amount: 100, cadence: "monthly", effectiveFrom: main.firstMonth, category: "other_revenue", accountingTreatment: "cash" } }) }).returning({ id: decisions.id });
    await applyDecisionIfEffective(main.id, decision!.id, null);
    const [item] = await db.select({ scenarioId: economicItems.scenarioId }).from(economicItems).where(eq(economicItems.decisionId, decision!.id));
    expect(item!.scenarioId).not.toBe(old.id);
    expect((await listScenarios(main.id)).find((scenario) => scenario.name === "Revived")).toMatchObject({ id: item!.scenarioId, itemCount: 1 });
  });
});
