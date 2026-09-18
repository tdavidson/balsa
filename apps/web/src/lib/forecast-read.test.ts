import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: fileURLToPath(new URL("../../../../.env.local", import.meta.url)) });
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

// Real Postgres: effectiveAsOfPeriod must agree with the forecast row withDerivedForecast
// (journal-ledger.ts) actually reads, which a fake forecast lookup would not prove.
describe.skipIf(!process.env.DATABASE_URL)("effective as-of period", async () => {
  if (!process.env.DATABASE_URL) return; // skipped suites still run their factory
  const { closeDatabase, companies, getDatabase } = await import("@finance/database");
  const { refreshCurrentCalculationRun } = await import("./refresh-calculation-run");
  const { effectiveAsOfPeriod, loadLatestForecast } = await import("./forecast-read");
  const db = getDatabase();
  let companyId = "";

  beforeAll(async () => {
    const [company] = await db.insert(companies).values({ name: `Effective as-of ${Date.now()}` }).returning({ id: companies.id });
    companyId = company!.id;
  });

  afterAll(async () => {
    if (companyId) await db.delete(companies).where(eq(companies.id, companyId));
    await closeDatabase();
  });

  it("passes the caller's requested value through untouched before any forecast run exists", async () => {
    expect(await effectiveAsOfPeriod(companyId, "actual", "2026-01")).toEqual({ asOfPeriod: "2026-01", forecastAnchored: false });
    expect(await effectiveAsOfPeriod(companyId, "projected", "2026-01")).toEqual({ asOfPeriod: "2026-01", forecastAnchored: false });
    expect(await effectiveAsOfPeriod(companyId, "scenario", undefined)).toEqual({ asOfPeriod: undefined, forecastAnchored: false });
  });

  it("anchors projected/scenario views at the latest forecast's as-of month once one exists; actual is unaffected", async () => {
    const result = await refreshCurrentCalculationRun(companyId, { cause: { kind: "entity_changed", subjectType: "company", subjectId: companyId, actorUserId: null, via: "worker" } });
    expect(result.forecastStatus).toBe("completed");
    const forecast = await loadLatestForecast(companyId);
    expect(forecast).not.toBeNull();
    expect(await effectiveAsOfPeriod(companyId, "projected", "2020-01")).toEqual({ asOfPeriod: forecast!.run.asOfMonth, forecastAnchored: true });
    expect(await effectiveAsOfPeriod(companyId, "scenario", undefined)).toEqual({ asOfPeriod: forecast!.run.asOfMonth, forecastAnchored: true });
    expect(await effectiveAsOfPeriod(companyId, "actual", "2020-01")).toEqual({ asOfPeriod: "2020-01", forecastAnchored: false });
  });
});
