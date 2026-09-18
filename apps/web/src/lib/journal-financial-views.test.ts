import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

config({ path: fileURLToPath(new URL("../../../../.env.local", import.meta.url)) });
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

// Real Postgres: proves loadJournalFinancialMonths loads the derived forecast once and
// reuses it for every month's loadJournalReport call, which a fake forecast lookup would
// not prove (it would hide a caller that quietly reloads the forecast per month).
describe.skipIf(!process.env.DATABASE_URL)("journal financial months forecast reuse", async () => {
  if (!process.env.DATABASE_URL) return; // skipped suites still run their factory
  const { closeDatabase, companies, getDatabase } = await import("@finance/database");
  const { refreshCurrentCalculationRun } = await import("./refresh-calculation-run");
  const forecastRead = await import("./forecast-read");
  const { loadJournalFinancialMonths } = await import("./journal-financial-views");
  const db = getDatabase();
  let companyId = "";

  beforeAll(async () => {
    const [company] = await db.insert(companies).values({ name: `Financial months forecast reuse ${Date.now()}` }).returning({ id: companies.id });
    companyId = company!.id;
    const result = await refreshCurrentCalculationRun(companyId, { cause: { kind: "entity_changed", subjectType: "company", subjectId: companyId, actorUserId: null, via: "worker" } });
    expect(result.forecastStatus).toBe("completed");
  });

  afterAll(async () => {
    if (companyId) await db.delete(companies).where(eq(companies.id, companyId));
    await closeDatabase();
  });

  it("loads the forecast exactly once across a 12-month projected range", async () => {
    const forecast = await forecastRead.loadLatestForecast(companyId);
    expect(forecast).not.toBeNull();

    const spy = vi.spyOn(forecastRead, "loadLatestForecast");
    const baseline = forecastRead.__loadLatestForecastCallCount.current;
    const months = await loadJournalFinancialMonths({ companyId, start: "2026-01", end: "2026-12", currency: "USD", selection: { view: "projected", asOfPeriod: forecast!.run.asOfMonth }, asOfPeriod: forecast!.run.asOfMonth, view: "projected" });
    expect(months).toHaveLength(12);

    if (spy.mock.calls.length > 0) {
      // Spying on the ESM export intercepted the call from journal-financial-views.ts.
      expect(spy).toHaveBeenCalledTimes(1);
    } else {
      // Spying did not intercept a call from another module in this app's module graph;
      // fall back to the exported test-only counter, which the source increments directly.
      expect(forecastRead.__loadLatestForecastCallCount.current - baseline).toBe(1);
    }
    spy.mockRestore();
  });
});
