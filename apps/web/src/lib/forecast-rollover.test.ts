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
  const { calculationOutbox, calculationRuns, chartAccounts, closeDatabase, companies, economicItems, financialStateRevisions, forecastEntryTemplates, forecastRecurrencePolicies, forecastOccurrences, getDatabase, journalBatches, journalEntries, journalLines } = await import("@finance/database");
  const { refreshCurrentCalculationRun } = await import("./refresh-calculation-run");
  const { refreshRolledForecasts } = await import("./forecast-rollover");
  const db = getDatabase();
  let companyId = ""; let cashId = ""; let payrollId = "";

  const latestRun = async () => (await db.select({ id: calculationRuns.id, asOfMonth: calculationRuns.asOfMonth, revision: calculationRuns.financialStateRevision }).from(calculationRuns)
    .where(and(eq(calculationRuns.companyId, companyId), like(calculationRuns.engineVersion, "forecast-run-%")))
    .orderBy(desc(sql`${calculationRuns.financialStateRevision}::bigint`), desc(calculationRuns.createdAt)).limit(1))[0]!;
  const companyRevision = async () => (await db.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, companyId)))[0]!.revision;
  const rolledRevisionCount = async () => (await db.select({ id: financialStateRevisions.id }).from(financialStateRevisions).where(and(eq(financialStateRevisions.companyId, companyId), eq(financialStateRevisions.kind, "period_rolled")))).length;
  // Backdate only this company's own latest run, so the real clock finds only it stale, not any concurrently running test's company.
  const backdateLatestRun = async () => { const run = await latestRun(); await db.update(calculationRuns).set({ asOfMonth: "2020-01" }).where(eq(calculationRuns.id, run.id)); return run; };
  const latestRevisionCause = async () => (await db.select({ kind: financialStateRevisions.kind }).from(financialStateRevisions)
    .where(eq(financialStateRevisions.companyId, companyId)).orderBy(desc(sql`${financialStateRevisions.revision}::bigint`)).limit(1))[0]!;

  beforeAll(async () => {
    const [company] = await db.insert(companies).values({ name: `Forecast rollover ${Date.now()}` }).returning({ id: companies.id });
    companyId = company!.id;
    const [cash, payroll] = await db.insert(chartAccounts).values([
      { companyId, code: "1000", name: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" },
      { companyId, code: "6000", name: "Payroll", accountType: "expense", normalBalance: "debit" },
    ]).returning({ id: chartAccounts.id });
    cashId = cash!.id; payrollId = payroll!.id;
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
    const { loadForecastReconciliation } = await import("./forecast-reconciliation");
    const option = (await loadForecastReconciliation(companyId, now)).recurrence.options[0]!;
    await db.insert(forecastRecurrencePolicies).values({ companyId, driverId: option.driverId, status: "active", startMonth: now.toISOString().slice(0, 7), endMonth: now.toISOString().slice(0, 7), definition: option.definition, definitionHash: option.hash });
    const first = await refreshRolledForecasts(now, 20);
    expect(first.refreshed).toContain(companyId);

    const after = await latestRun();
    expect(after.asOfMonth).toBe(initial.asOfMonth);
    expect(Number(after.revision) > Number(initial.revision)).toBe(true);
    expect((await latestRevisionCause()).kind).toBe("period_rolled");

    const second = await refreshRolledForecasts(now, 20);
    expect(second.refreshed).not.toContain(companyId);
    expect(await db.select().from(forecastOccurrences).where(eq(forecastOccurrences.companyId, companyId))).toHaveLength(1);
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

  it("does not rebuild journal graphs for a calendar roll", async () => {
    // A posted entry, so a mutation-driven refresh would queue a journal graph for its period; the roll must not.
    const [batch] = await db.insert(journalBatches).values({ companyId, label: "Opening", source: "manual", status: "posted", idempotencyKey: `rollover-${Date.now()}`, postedAt: new Date() }).returning({ id: journalBatches.id });
    const [entry] = await db.insert(journalEntries).values({ companyId, batchId: batch!.id, postingDate: "2026-01-15", period: "2026-01", memo: "Opening cash", status: "posted", postedAt: new Date() }).returning({ id: journalEntries.id });
    await db.insert(journalLines).values([
      { companyId, entryId: entry!.id, accountId: cashId, currency: "USD", debitMinor: "500000", creditMinor: "0" },
      { companyId, entryId: entry!.id, accountId: payrollId, currency: "USD", debitMinor: "0", creditMinor: "500000" },
    ]);
    await backdateLatestRun();

    const result = await refreshRolledForecasts(new Date(), 20);
    expect(result.refreshed).toContain(companyId);
    const revision = await companyRevision();
    expect((await latestRevisionCause()).kind).toBe("period_rolled");
    const jobs = await db.select({ period: calculationOutbox.period }).from(calculationOutbox).where(and(eq(calculationOutbox.companyId, companyId), eq(calculationOutbox.financialStateRevision, revision)));
    expect(jobs.map((job) => job.period)).toEqual(["forecast"]);
  });

  it("retries a head revision's failed forecast job instead of bumping the revision again", async () => {
    // Deterministic failure, cleared below: buildForecastRun rejects a non-numeric minimum cash.
    await db.update(companies).set({ minimumCashMinor: "not-a-number" }).where(eq(companies.id, companyId));
    try {
      const failed = await refreshCurrentCalculationRun(companyId, { cause: { kind: "settings_changed", subjectType: "company", subjectId: companyId, actorUserId: null, via: "worker" } });
      expect(failed.forecastStatus).toBe("failed");
      const head = failed.financialStateRevision;
      await backdateLatestRun(); // the run behind the head revision now also trails the calendar
      const rolledBefore = await rolledRevisionCount();
      const jobAt = async () => (await db.select({ status: calculationOutbox.status, updatedAt: calculationOutbox.updatedAt }).from(calculationOutbox).where(and(eq(calculationOutbox.id, failed.forecastJobId!))))[0]!;
      let lastAttempt = (await jobAt()).updatedAt;

      for (let tick = 0; tick < 2; tick += 1) {
        const result = await refreshRolledForecasts(new Date(), 20);
        expect(result.refreshed).not.toContain(companyId);
        expect(result.failed.map((entry) => entry.companyId)).toContain(companyId);
        expect(await companyRevision()).toBe(head);
        expect(await rolledRevisionCount()).toBe(rolledBefore);
        const job = await jobAt();
        expect(job.status).toBe("failed");
        expect(job.updatedAt.getTime()).toBeGreaterThan(lastAttempt.getTime()); // the job was re-run
        lastAttempt = job.updatedAt;
      }

      await db.update(companies).set({ minimumCashMinor: "0" }).where(eq(companies.id, companyId));
      const recovered = await refreshRolledForecasts(new Date(), 20);
      expect(recovered.retried).toContain(companyId);
      expect(recovered.failed.map((entry) => entry.companyId)).not.toContain(companyId);
      expect((await jobAt()).status).toBe("completed");
      expect(await companyRevision()).toBe(head);
      expect(await rolledRevisionCount()).toBe(rolledBefore);
      const run = await latestRun();
      expect(run.revision).toBe(head);
      expect(run.asOfMonth > "2020-01").toBe(true);
    } finally {
      await db.update(companies).set({ minimumCashMinor: "0" }).where(eq(companies.id, companyId));
    }
  });

  it("defers every candidate once the time budget is spent", async () => {
    await backdateLatestRun();
    const revision = await companyRevision();
    const spent = await refreshRolledForecasts(new Date(), 20, { budgetMs: 0 });
    expect(spent.refreshed).not.toContain(companyId);
    expect(spent.deferred).toBeGreaterThanOrEqual(1);
    expect(await companyRevision()).toBe(revision);
    expect((await refreshRolledForecasts(new Date(), 20)).refreshed).toContain(companyId);
  });

  it("isolates a company that throws so the others still refresh", async () => {
    // A second company whose refresh throws: its revision is not a number, so bumping it fails in Postgres.
    const [broken] = await db.insert(companies).values({ name: `Rollover failure ${Date.now()}` }).returning({ id: companies.id });
    try {
      await refreshCurrentCalculationRun(broken!.id, { cause: { kind: "entity_changed", subjectType: "company", subjectId: broken!.id, actorUserId: null, via: "worker" } });
      await db.update(calculationRuns).set({ asOfMonth: "2020-01" }).where(eq(calculationRuns.companyId, broken!.id));
      await db.update(companies).set({ financialStateRevision: "corrupt" }).where(eq(companies.id, broken!.id));
      await backdateLatestRun();

      const result = await refreshRolledForecasts(new Date(), 20);
      expect(result.failed.find((entry) => entry.companyId === broken!.id)?.error).toBeTruthy();
      expect(result.refreshed).toContain(companyId);
      expect(result.refreshed).not.toContain(broken!.id);
    } finally {
      await db.delete(companies).where(eq(companies.id, broken!.id));
    }
  });
});
