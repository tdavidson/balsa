import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import ExcelJS from "exceljs";
import { afterAll, describe, expect, it } from "vitest";
import { buildStandardStatements, standardLayoutVersion, type StandardPeriodColumn } from "@balsa/finance-engine";
import { buildStandardWorkbook, readWorkbookEdits, type WorkbookEdit, type StandardWorkbookInput } from "@balsa/model-export";
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!process.env.DATABASE_URL)("returned workbooks", async () => {
  const { closeDatabase, companies, decisions, economicItems, evidence, forecastMetrics, forecastVariables, forecastDimensions, getDatabase, users } = await import("@finance/database");
  const { proposeWorkbookEditsWith } = await import("./workbook-round-trip");
  const { applyDecisionAndEnqueue } = await import("./decision-effects");
  const db = getDatabase(); const ids: string[] = []; const userIds: string[] = [];
  afterAll(async () => { if (ids.length) await db.delete(companies).where(inArray(companies.id, ids)); if (userIds.length) await db.delete(users).where(inArray(users.id, userIds)); await closeDatabase(); });

  const periods = ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]; const asOf = "2026-09";
  const forecastPeriods = periods.filter((period) => period > asOf);
  const empty = periods.map((period): StandardPeriodColumn => ({ period, basis: period <= asOf ? "actual" : "forecast", statement: buildStandardStatements([], period, { accounts: [], categories: [], currency: "USD" }).byCurrency.find((item) => item.currency === "USD") ?? buildStandardStatements([], period, { accounts: [], categories: [], currency: "USD" }).byCurrency[0]! }));

  async function seed() {
    const [company] = await db.insert(companies).values({ name: `Synthetic round trip ${randomUUID()}` }).returning(); ids.push(company!.id);
    const [user] = await db.insert(users).values({ authProvider: "fixture", authProviderUserId: randomUUID(), email: `${randomUUID()}@example.invalid` }).returning(); userIds.push(user!.id);
    const [rent] = await db.insert(economicItems).values({ companyId: company!.id, type: "obligation", direction: "spend", label: "Rent", amount: "3000", cadence: "monthly", effectiveFrom: "2026-10", status: "confirmed", pattern: { initialValue: "3000", repeatsEveryMonths: 1, change: { basis: "pct_change", everyMonths: 12, by: "0.03" } } }).returning();
    await db.insert(forecastMetrics).values({ companyId: company!.id, name: "customers", label: "Customers", unit: "customers", effectiveFrom: "2026-10", pattern: { initialValue: "100", repeatsEveryMonths: 1, change: { basis: "pct_change", everyMonths: 1, by: "0.05" } } });
    await db.insert(forecastVariables).values({ companyId: company!.id, name: "headcount", kind: "number", dims: [], inputs: [{ coords: {}, from: "2026-09", value: "2" }] });
    const [doc] = await db.insert(evidence).values({ companyId: company!.id, createdByUserId: user!.id, sourceName: "Returned workbook.xlsx", rawText: "Synthetic", status: "pending" }).returning();
    return { companyId: company!.id, userId: user!.id, rentId: rent!.id, evidenceId: doc!.id };
  }

  function workbookInput(companyId: string, rentId: string): StandardWorkbookInput {
    const rentAmounts = Object.fromEntries(forecastPeriods.map((period) => [period, "300000"]));
    return {
      company: { id: companyId, name: "Synthetic", currency: "USD" }, generatedAt: "2026-10-07T00:00:00.000Z", versions: { layout: standardLayoutVersion, forecast: null },
      timeline: { firstPeriod: periods[0]!, lastPeriod: periods.at(-1)!, asOfPeriod: asOf, fiscalYearEndMonth: 12, isDefault: false }, minimumCashMinor: "0",
      base: empty, baseRunway: null, plan: null, scenarios: [], accounts: [], mapping: { confirmed: 0, total: 0, complete: true },
      forecast: {
        forecastPeriods, seasonality: [], escalation: null, scenarios: [],
        drivers: [{ id: rentId, label: "Rent", direction: "spend", lineLabel: null, referenceLine: null, scenarioId: null, excludedIn: [], note: null, posting: null, settlement: null, exception: null, amountsByPeriod: rentAmounts, pattern: { initialValue: 3000, startsIn: "2026-10", endsIn: null, repeatsEvery: 1, basis: "% change", changesEvery: 12, changingBy: 0.03, using: null, maxMonths: null, maxValue: null, seasonality: null, escalation: null } }],
        metrics: [{ name: "customers", label: "Customers", unit: "customers", actuals: {}, valuesByPeriod: { "2026-10": "100", "2026-11": "105", "2026-12": "110.25" }, pattern: { initialValue: 100, startsIn: "2026-10", endsIn: null, repeatsEvery: 1, basis: "% change", changesEvery: 1, changingBy: 0.05, using: null, maxMonths: null, maxValue: null, seasonality: null, escalation: null } }],
      },
      model: { definition: { dimensions: [], variables: [{ name: "headcount", kind: "number", dims: [], inputs: [{ coords: {}, from: "2026-09", value: "2" }] }] }, months: ["2026-09", "2026-10", "2026-11", "2026-12"] },
    };
  }

  it("proposes each edit as a decision citing the workbook, and applying them changes Balsa", async () => {
    const f = await seed();
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load((await buildStandardWorkbook(workbookInput(f.companyId, f.rentId))).buffer as ArrayBuffer);
    const forecastSheet = workbook.getWorksheet("Forecast")!;
    const rowOf = (label: string) => { let found = 0; forecastSheet.eachRow((row, number) => { if (!found && row.getCell(1).value === label) found = number; }); return found; };
    forecastSheet.getCell(rowOf("Rent"), 10).value = 0.04; // changing by
    forecastSheet.getCell(rowOf("Rent"), 6).value = new Date(Date.UTC(2027, 11, 31)); // ends in
    forecastSheet.getCell(rowOf("Customers"), 10).value = 0.08;
    const model = workbook.getWorksheet("Model")!; let headcountRow = 0; model.eachRow((row, number) => { if (!headcountRow && row.getCell(1).value === "headcount" && row.getCell(4).value === "Input") headcountRow = number; });
    model.getCell(headcountRow, 7).value = 3; model.getCell(headcountRow, 8).value = 3; // November and December
    const edits = (await readWorkbookEdits(await workbook.xlsx.writeBuffer() as ArrayBuffer))!;
    expect(edits.manifest.companyId).toBe(f.companyId);

    const result = await db.transaction((tx) => proposeWorkbookEditsWith(tx, { companyId: f.companyId, actorUserId: f.userId, evidenceId: f.evidenceId, edits }));
    expect(result.notes).toEqual([]);
    const proposed = await db.select().from(decisions).where(eq(decisions.companyId, f.companyId));
    expect(proposed).toHaveLength(4);
    expect(proposed.every((decision) => decision.status === "proposed" && decision.evidenceId === f.evidenceId)).toBe(true);
    expect(proposed.map((decision) => JSON.parse(decision.effect!).kind).sort()).toEqual(["end_item", "set_item_pattern", "set_metric", "set_variable"]);
    // Proposing changed nothing yet.
    const [before] = await db.select().from(economicItems).where(eq(economicItems.id, f.rentId));
    expect((before!.pattern as { change: { by: string } }).change.by).toBe("0.03");

    for (const decision of proposed) await applyDecisionAndEnqueue(f.companyId, decision.id, f.userId);
    const [rent] = await db.select().from(economicItems).where(eq(economicItems.id, f.rentId));
    expect(rent!.pattern).toMatchObject({ initialValue: "3000", change: { basis: "pct_change", everyMonths: 12, by: "0.04" } });
    expect(rent!.effectiveTo).toBe("2027-12");
    const [metric] = await db.select().from(forecastMetrics).where(and(eq(forecastMetrics.companyId, f.companyId), eq(forecastMetrics.name, "customers")));
    expect(metric!.pattern).toMatchObject({ change: { by: "0.08" } });
    const [variable] = await db.select().from(forecastVariables).where(and(eq(forecastVariables.companyId, f.companyId), eq(forecastVariables.name, "headcount"), eq(forecastVariables.active, "Y")));
    expect(variable!.inputs).toEqual([{ coords: {}, from: "2026-09", value: "2" }, { coords: {}, from: "2026-11", value: "3" }, { coords: {}, from: "2027-01", value: "2" }]);
  });

  it("notes what it cannot propose and proposes nothing for another company's driver", async () => {
    const f = await seed(); const other = await seed();
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load((await buildStandardWorkbook(workbookInput(f.companyId, other.rentId))).buffer as ArrayBuffer);
    const forecastSheet = workbook.getWorksheet("Forecast")!; let rentRow = 0; forecastSheet.eachRow((row, number) => { if (!rentRow && row.getCell(1).value === "Rent") rentRow = number; });
    forecastSheet.getCell(rentRow, 10).value = 0.05;
    forecastSheet.getCell(rentRow, 5).value = new Date(Date.UTC(2026, 11, 31)); // a new start
    const edits = (await readWorkbookEdits(await workbook.xlsx.writeBuffer() as ArrayBuffer))!;
    const result = await db.transaction((tx) => proposeWorkbookEditsWith(tx, { companyId: f.companyId, actorUserId: f.userId, evidenceId: f.evidenceId, edits }));
    expect(result.proposed).toEqual([]);
    expect(result.notes).toEqual(["Rent: not proposed, because the driver no longer exists in Balsa."]);
    const [untouched] = await db.select().from(economicItems).where(eq(economicItems.id, other.rentId));
    expect((untouched!.pattern as { change: { by: string } }).change.by).toBe("0.03");
  });
  async function proposeInputs(f: Awaited<ReturnType<typeof seed>>, changes: WorkbookEdit[]) {
    const parsed = (await readWorkbookEdits((await buildStandardWorkbook(workbookInput(f.companyId, f.rentId))).buffer as ArrayBuffer))!;
    return db.transaction((tx) => proposeWorkbookEditsWith(tx, { companyId: f.companyId, actorUserId: f.userId, evidenceId: f.evidenceId, edits: { ...parsed, edits: changes } }));
  }
  const cellEdit = (coords: Record<string, string>, before: number[], after: number[]): WorkbookEdit => ({ kind: "model_input", variable: "headcount", key: JSON.stringify(coords), coords, months: ["2026-10", "2026-11"], before, after });
  const inputRow = async (companyId: string) => (await db.select().from(forecastVariables).where(and(eq(forecastVariables.companyId, companyId), eq(forecastVariables.name, "headcount"))))[0]!;

  it.each([false, true])("applies both coordinates atomically regardless of edit order (%s)", async (reverse) => {
    const f = await seed();
    await db.insert(forecastDimensions).values({ companyId: f.companyId, name: "team", items: ["eng", "sales"] });
    await db.update(forecastVariables).set({ dims: ["team"], inputs: [{ coords: { team: "eng" }, from: "2026-09", value: "2" }, { coords: { team: "sales" }, from: "2026-09", value: "3" }] }).where(eq(forecastVariables.companyId, f.companyId));
    const changes = [cellEdit({ team: "eng" }, [2, 2], [4, 4]), cellEdit({ team: "sales" }, [3, 3], [5, 5])];
    const result = await proposeInputs(f, reverse ? changes.reverse() : changes);
    expect(result.notes).toEqual([]); expect(result.proposed).toHaveLength(1);
    await applyDecisionAndEnqueue(f.companyId, result.proposed[0]!.id, f.userId);
    const row = await inputRow(f.companyId);
    expect(row.inputs).toEqual(expect.arrayContaining([{ coords: { team: "eng" }, from: "2026-10", value: "4" }, { coords: { team: "sales" }, from: "2026-10", value: "5" }]));
  });

  it("preserves unchanged months and the schedule beyond the export", async () => {
    const f = await seed();
    await db.update(forecastVariables).set({ inputs: [{ coords: {}, from: "2026-09", value: "2" }, { coords: {}, from: "2026-11", value: "7" }] }).where(eq(forecastVariables.companyId, f.companyId));
    const result = await proposeInputs(f, [cellEdit({}, [2, 2], [4, 2])]);
    expect(result.notes).toEqual([]);
    await applyDecisionAndEnqueue(f.companyId, result.proposed[0]!.id, f.userId);
    expect((await inputRow(f.companyId)).inputs).toEqual([{ coords: {}, from: "2026-09", value: "2" }, { coords: {}, from: "2026-10", value: "4" }, { coords: {}, from: "2026-11", value: "7" }]);
  });

  it("refuses conflicting cells at intake and stale approvals without changing state", async () => {
    const f = await seed();
    const first = await proposeInputs(f, [cellEdit({}, [2, 2], [4, 2])]);
    await db.update(forecastVariables).set({ inputs: [{ coords: {}, from: "2026-09", value: "7" }] }).where(eq(forecastVariables.companyId, f.companyId));
    const conflicting = await proposeInputs(f, [cellEdit({}, [2, 2], [4, 2])]);
    expect(conflicting.proposed).toEqual([]); expect(conflicting.notes[0]).toContain("changed in Balsa");
    await expect(applyDecisionAndEnqueue(f.companyId, first.proposed[0]!.id, f.userId)).rejects.toThrow("changed since");
    expect((await inputRow(f.companyId)).inputs[0]!.value).toBe("7");
    const [decision] = await db.select().from(decisions).where(eq(decisions.id, first.proposed[0]!.id));
    expect(decision!.status).toBe("proposed");
  });

  it("rejects old workbook variable proposals without conflict protection", async () => {
    const f = await seed(); const row = await inputRow(f.companyId);
    const [decision] = await db.insert(decisions).values({ companyId: f.companyId, evidenceId: f.evidenceId, question: "Old workbook edit", answer: "Synthetic", status: "proposed", effect: JSON.stringify({ kind: "set_variable", variable: { name: row.name, kind: row.kind, dims: row.dims, formula: null, inputs: [] } }) }).returning();
    await expect(applyDecisionAndEnqueue(f.companyId, decision!.id, f.userId)).rejects.toThrow("predates conflict checks");
  });

  it("serializes competing approvals so only one can replace the same input snapshot", async () => {
    const f = await seed();
    const first = await proposeInputs(f, [cellEdit({}, [2, 2], [4, 2])]);
    const second = await proposeInputs(f, [cellEdit({}, [2, 2], [5, 2])]);
    const outcomes = await Promise.allSettled([first, second].map((result) => applyDecisionAndEnqueue(f.companyId, result.proposed[0]!.id, f.userId)));
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    const rows = await db.select().from(decisions).where(eq(decisions.companyId, f.companyId));
    expect(rows.map((row) => row.status).sort()).toEqual(["applied", "proposed"]);
  });

});
