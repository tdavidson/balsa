import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: fileURLToPath(new URL("../../../../.env.local", import.meta.url)) });
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!process.env.DATABASE_URL)("forecast model loading", async () => {
  if (!process.env.DATABASE_URL) return; // skipped suites still run their factory
  const { closeDatabase, companies, economicItems, forecastDimensions, forecastVariables, getDatabase } = await import("@finance/database");
  const { addMonths } = await import("@nevermodel/finance-engine");
  const { forecastAsOfMonth, loadForecastInputs, loadForecastModel, resolveDriversForWindow } = await import("./forecast-inputs");
  const db = getDatabase();
  let companyId = ""; let otherId = "";

  beforeAll(async () => {
    const [company, other] = await db.insert(companies).values([{ name: `Model load ${Date.now()}` }, { name: `Model load other ${Date.now()}` }]).returning({ id: companies.id });
    companyId = company!.id; otherId = other!.id;
  });

  afterAll(async () => {
    for (const id of [companyId, otherId]) if (id) await db.delete(companies).where(eq(companies.id, id));
    await closeDatabase();
  });

  it("omits the model when the company has none", async () => {
    expect("model" in (await loadForecastInputs(companyId))).toBe(false);
  });

  it("loads active rows canonically and scoped to the company", async () => {
    await db.insert(forecastDimensions).values([{ companyId, name: "team", items: ["Eng", "Sales"] }, { companyId, name: "old", items: ["x"], active: "N" }]);
    await db.insert(forecastVariables).values([
      { companyId, name: "salary", kind: "money", dims: ["team"], inputs: [{ coords: { team: "Sales" }, from: "2026-01", value: "8000" }, { coords: { team: "Eng" }, from: "2026-01", value: "10000" }] },
      { companyId, name: "headcount", kind: "number", dims: ["team"], inputs: [] },
    ]);
    const input = await loadForecastInputs(companyId);
    expect(input.model).toEqual({
      dimensions: [{ name: "team", items: ["Eng", "Sales"] }],
      variables: [
        { name: "headcount", kind: "number", dims: ["team"], inputs: [] },
        { name: "salary", kind: "money", dims: ["team"], inputs: [{ coords: { team: "Eng" }, from: "2026-01", value: "10000" }, { coords: { team: "Sales" }, from: "2026-01", value: "8000" }] },
      ],
    });
    expect(await loadForecastModel(otherId)).toBeUndefined();
  });

  it("carries an item's formula and resolves it for a projection window", async () => {
    const firstMonth = addMonths(await forecastAsOfMonth(companyId, new Date()), 1);
    const [item] = await db.insert(economicItems).values({ companyId, type: "obligation", direction: "spend", label: "Salaries", amountFormula: "sum(salary)", cadence: "monthly", effectiveFrom: firstMonth, status: "confirmed" }).returning({ id: economicItems.id });
    const input = await loadForecastInputs(companyId);
    expect(input.drivers.find((driver) => driver.id === item!.id)).toMatchObject({ amountFormula: "sum(salary)" });
    const window = resolveDriversForWindow(input.drivers, input.model, { start: firstMonth, end: firstMonth });
    expect(window.exceptions).toEqual([]);
    expect(window.drivers.find((driver) => driver.id === item!.id)!.amountByMonth![firstMonth]).toBe("1800000");
  });
});
