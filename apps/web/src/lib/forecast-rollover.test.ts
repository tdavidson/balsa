import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { and, desc, eq, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: fileURLToPath(new URL("../../../../.env.local", import.meta.url)) });
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

// Real Postgres: what is under test is which companies get picked up across a real revision and outbox pipeline.
// refreshRolledForecasts scans every company with a forecast run, so this suite backdates only its own company's
// run and calls it with the real clock — other test files' companies stay current for the real clock and are
// never candidates, so this suite cannot race them even though vitest runs test files concurrently.
describe.skipIf(!process.env.DATABASE_URL)("forecast rollover", async () => {
  if (!process.env.DATABASE_URL) return; // skipped suites still run their factory
  const { calculationRuns, chartAccounts, closeDatabase, companies, economicItems, financialStateRevisions, forecastEntryTemplates, getDatabase } = await import("@finance/database");
  const { refreshCurrentCalculationRun } = await import("./refresh-calculation-run");
  const { refreshRolledForecasts } = await import("./forecast-rollover");
  const db = getDatabase();
  let companyId = "";

  const latestRun = async () => (await db.select({ id: calculationRuns.id, asOfMonth: calculationRuns.asOfMonth, revision: calculationRuns.financialStateRevision }).from(calculationRuns)
    .where(and(eq(calculationRuns.companyId, companyId), like(calculationRuns.engineVersion, "forecast-run-%")))
    .orderBy(desc(sql`${calculationRuns.financialStateRevision}::bigint`), desc(calculationRuns.createdAt)).limit(1))[0]!;
  const latestRevisionCause = async () => (await db.select({ kind: financialStateRevisions.kind }).from(financialStateRevisions)
    .where(eq(financialStateRevisions.companyId, companyId)).orderBy(desc(sql`${financialStateRevisions.revision}::bigint`)).limit(1))[0]!;

  beforeAll(async () => {
    const [company] = await db.insert(companies).values({ name: `Forecast rollover ${Date.now()}` }).returning({ id: companies.id });
    companyId = company!.id;
    const [cash, payroll] = await db.insert(chartAccounts).values([
      { companyId, code: "1000", name: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" },
      { companyId, code: "6000", name: "Payroll", accountType: "expense", normalBalance: "debit" },
    ]).returning({ id: chartAccounts.id });
    await db.insert(forecastEntryTemplates).values({ companyId, name: "Payroll", itemType: "obligation", direction: "spend", debitAccountId: payroll!.id, creditAccountId: cash!.id });
    await db.insert(economicItems).values({ companyId, type: "obligation", direction: "spend", label: "Payroll", amount: "1000", cadence: "monthly", effectiveFrom: "2026-09", status: "confirmed" });
    // Establishes the company's first forecast run, as of today.
    await refreshCurrentCalculationRun(companyId, { cause: { kind: "entity_changed", subjectType: "company", subjectId: companyId, actorUserId: null, via: "worker" } });
  });

  afterAll(async () => {
    if (companyId) await db.delete(companies).where(eq(companies.id, companyId));
    await closeDatabase();
  });

  it("refreshes a company whose stored run fell behind the calendar, and does nothing on a repeat tick", async () => {
    const initial = await latestRun();
    // Backdate only this company's own run, so the real clock finds only it stale, not any concurrently running test's company.
    await db.update(calculationRuns).set({ asOfMonth: "2020-01" }).where(eq(calculationRuns.id, initial.id));

    const now = new Date();
    const first = await refreshRolledForecasts(now, 20);
    expect(first.refreshed).toContain(companyId);

    const after = await latestRun();
    expect(after.asOfMonth).toBe(initial.asOfMonth);
    expect(Number(after.revision) > Number(initial.revision)).toBe(true);
    expect((await latestRevisionCause()).kind).toBe("period_rolled");

    const second = await refreshRolledForecasts(now, 20);
    expect(second.refreshed).not.toContain(companyId);
  });

  it("does not consider a company that has never had a forecast run", async () => {
    const [other] = await db.insert(companies).values({ name: `No forecast yet ${Date.now()}` }).returning({ id: companies.id });
    try {
      const result = await refreshRolledForecasts(new Date(), 20);
      expect(result.refreshed).not.toContain(other!.id);
    } finally {
      await db.delete(companies).where(eq(companies.id, other!.id));
    }
  });
});
