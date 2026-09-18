import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { and, desc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: fileURLToPath(new URL("../../../../.env.local", import.meta.url)) });
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

// Real Postgres: what is under test is revision attribution across the outbox, which a fake would not prove.
describe.skipIf(!process.env.DATABASE_URL)("forecast job", async () => {
  if (!process.env.DATABASE_URL) return; // skipped suites still run their factory
  const { calculationNodes, calculationOutbox, calculationRuns, chartAccounts, closeDatabase, companies, economicItems, financialStateRevisions, forecastConsequences, forecastEntryTemplates, getDatabase } = await import("@finance/database");
  const { refreshCurrentCalculationRun } = await import("./refresh-calculation-run");
  const { forecastAsOfMonth, loadForecastInputs } = await import("./forecast-inputs");
  const { persistForecastRun } = await import("./forecast-persistence");
  const { FORECAST_LOCK_NAMESPACE, runForecastJob } = await import("./forecast-job");
  const { processCalculationOutboxJob } = await import("./calculation-outbox");
  const { addMonths, buildForecastRun } = await import("@nevermodel/finance-engine");
  const db = getDatabase();
  let companyId = ""; let itemId = ""; let firstMonth = "";
  const cause = (kind: "entity_changed" | "item_confirmed" | "item_edited", subjectId: string | null) => ({ kind, subjectType: kind === "entity_changed" ? "company" : "economic_item", subjectId, actorUserId: null, via: "worker" as const });
  const latestConsequence = async () => (await db.select().from(forecastConsequences).where(eq(forecastConsequences.companyId, companyId)).orderBy(desc(sql`${forecastConsequences.revision}::bigint`)).limit(1))[0];

  beforeAll(async () => {
    const [company] = await db.insert(companies).values({ name: `Forecast job ${Date.now()}` }).returning({ id: companies.id });
    companyId = company!.id;
    const [cash, payroll] = await db.insert(chartAccounts).values([
      { companyId, code: "1000", name: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" },
      { companyId, code: "6000", name: "Payroll", accountType: "expense", normalBalance: "debit" },
    ]).returning({ id: chartAccounts.id });
    await db.insert(forecastEntryTemplates).values({ companyId, name: "Payroll", itemType: "obligation", direction: "spend", debitAccountId: payroll!.id, creditAccountId: cash!.id });
    firstMonth = addMonths(await forecastAsOfMonth(companyId, new Date()), 1);
    const [item] = await db.insert(economicItems).values({ companyId, type: "obligation", direction: "spend", label: "Payroll", amount: "1000", cadence: "monthly", effectiveFrom: firstMonth, status: "draft" }).returning({ id: economicItems.id });
    itemId = item!.id;
  });

  afterAll(async () => {
    if (companyId) await db.delete(companies).where(eq(companies.id, companyId));
    await closeDatabase();
  });

  it("records no consequence for the first forecast run", async () => {
    const result = await refreshCurrentCalculationRun(companyId, { cause: cause("entity_changed", companyId) });
    expect(result.forecastStatus).toBe("completed");
    expect(await latestConsequence()).toBeUndefined();
  });

  it("attributes a confirmed item's runway effect to the confirmation", async () => {
    await db.update(economicItems).set({ status: "confirmed" }).where(eq(economicItems.id, itemId));
    const result = await refreshCurrentCalculationRun(companyId, { cause: cause("item_confirmed", itemId) });
    const row = (await latestConsequence())!;
    expect(row.revision).toBe(result.financialStateRevision);
    const delta = row.delta as { cashOutMonth: { after: string | null }; runwayMonths: { after: number | null }; drivers: { added: { id: string }[] } };
    expect(delta.cashOutMonth.after).toBe(firstMonth);
    expect(delta.runwayMonths.after).toBe(0);
    expect(delta.drivers.added.map((driver) => driver.id)).toEqual([itemId]);
    expect((row.causes as { kind: string; subjectId: string }[]).map((entry) => [entry.kind, entry.subjectId])).toEqual([["item_confirmed", itemId]]);
  });

  it("carries the causes of revisions whose forecast jobs never ran", async () => {
    // A revision whose job was superseded: bumped and attributed, but never calculated.
    const [bumped] = await db.update(companies).set({ financialStateRevision: sql`(financial_state_revision::bigint + 1)::text` }).where(eq(companies.id, companyId)).returning({ revision: companies.financialStateRevision });
    await db.insert(financialStateRevisions).values({ companyId, revision: bumped!.revision, kind: "fx_changed", subjectType: "fx_rate_set", subjectId: null, via: "worker" });
    await db.update(economicItems).set({ amount: "2000" }).where(eq(economicItems.id, itemId));
    await refreshCurrentCalculationRun(companyId, { cause: cause("item_edited", itemId) });
    const row = (await latestConsequence())!;
    expect((row.causes as { kind: string }[]).map((entry) => entry.kind)).toEqual(["fx_changed", "item_edited"]);
    expect((await db.select().from(financialStateRevisions).where(and(eq(financialStateRevisions.companyId, companyId)))).length).toBe(4);
  });

  it("records the consequence when a retried job finds its run already persisted", async () => {
    // A job that persisted its run and then failed before recording the consequence.
    const [bumped] = await db.update(companies).set({ financialStateRevision: sql`(financial_state_revision::bigint + 1)::text` }).where(eq(companies.id, companyId)).returning({ revision: companies.financialStateRevision });
    const revision = bumped!.revision;
    await db.insert(financialStateRevisions).values({ companyId, revision, kind: "item_edited", subjectType: "economic_item", subjectId: itemId, via: "worker" });
    await db.update(economicItems).set({ amount: "3000" }).where(eq(economicItems.id, itemId));
    const input = await loadForecastInputs(companyId);
    const persisted = await persistForecastRun({ companyId, financialStateRevision: revision, run: buildForecastRun(input), input });
    expect(persisted.reused).toBe(false);
    expect((await db.select().from(calculationNodes).where(eq(calculationNodes.calculationRunId, persisted.id))).length).toBeGreaterThan(0);

    const retried = await runForecastJob(companyId, revision);
    expect(retried).toEqual({ id: persisted.id, reused: true });
    expect((await latestConsequence())?.revision).toBe(revision);
    await runForecastJob(companyId, revision);
    expect((await db.select().from(forecastConsequences).where(and(eq(forecastConsequences.companyId, companyId), eq(forecastConsequences.revision, revision)))).length).toBe(1);
  });

  it("persists nothing for a revision that has already moved", async () => {
    const [company] = await db.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, companyId));
    const stale = String(BigInt(company!.revision) - 1n);
    expect(await runForecastJob(companyId, stale)).toEqual({ superseded: true });
  });

  it("serializes concurrent jobs so an effect is counted once", async () => {
    // 4000, not 3000: the retry test above already left the item at 3000, and an unchanged forecast records no consequence.
    await db.update(economicItems).set({ amount: "4000" }).where(eq(economicItems.id, itemId));
    const [bumped] = await db.update(companies).set({ financialStateRevision: sql`(financial_state_revision::bigint + 1)::text` }).where(eq(companies.id, companyId)).returning({ revision: companies.financialStateRevision });
    await db.insert(financialStateRevisions).values({ companyId, revision: bumped!.revision, kind: "item_edited", subjectType: "economic_item", subjectId: itemId, via: "worker" });
    const previousRevision = String(BigInt(bumped!.revision) - 1n);
    const results = await Promise.all([runForecastJob(companyId, previousRevision), runForecastJob(companyId, bumped!.revision)]);
    expect(results.filter((result) => "superseded" in result)).toHaveLength(1);
    const rows = await db.select().from(forecastConsequences).where(and(eq(forecastConsequences.companyId, companyId), eq(forecastConsequences.revision, bumped!.revision)));
    expect(rows).toHaveLength(1);
  });

  it("rolls back a run whose revision moves while the job is computing", async () => {
    await db.update(economicItems).set({ amount: "5000" }).where(eq(economicItems.id, itemId));
    const [bumped] = await db.update(companies).set({ financialStateRevision: sql`(financial_state_revision::bigint + 1)::text` }).where(eq(companies.id, companyId)).returning({ revision: companies.financialStateRevision });
    const revision = bumped!.revision;
    await db.insert(financialStateRevisions).values({ companyId, revision, kind: "item_edited", subjectType: "economic_item", subjectId: itemId, via: "worker" });
    // A mutation landing mid-job, simulated through the job's own transaction.
    const result = await runForecastJob(companyId, revision, { afterCompute: async (tx) => { await tx.update(companies).set({ financialStateRevision: sql`(financial_state_revision::bigint + 1)::text` }).where(eq(companies.id, companyId)); } });
    expect(result).toEqual({ superseded: true });
    expect(await db.select().from(calculationRuns).where(and(eq(calculationRuns.companyId, companyId), eq(calculationRuns.financialStateRevision, revision)))).toHaveLength(0);
    expect(await db.select().from(forecastConsequences).where(and(eq(forecastConsequences.companyId, companyId), eq(forecastConsequences.revision, revision)))).toHaveLength(0);
    // The rollback also undid the simulated bump, so the job now completes and carries this revision's cause.
    expect(await runForecastJob(companyId, revision)).toMatchObject({ reused: false });
    expect((await latestConsequence())?.revision).toBe(revision);
  });

  it("makes a job that waited on the company lock re-read the revision it was queued for", async () => {
    // A fresh revision with a changed forecast, so a run for it could only come from this job.
    await db.update(economicItems).set({ amount: "6000" }).where(eq(economicItems.id, itemId));
    const [bumped] = await db.update(companies).set({ financialStateRevision: sql`(financial_state_revision::bigint + 1)::text` }).where(eq(companies.id, companyId)).returning({ revision: companies.financialStateRevision });
    const revision = bumped!.revision;
    await db.insert(financialStateRevisions).values({ companyId, revision, kind: "item_edited", subjectType: "economic_item", subjectId: itemId, via: "worker" });

    // A second, independent connection plays the job ahead: it holds the company's forecast lock while a mutation lands.
    const { Client } = await import("pg");
    const other = new Client({ connectionString: process.env.DATABASE_URL });
    await other.connect();
    // The same two-key lock runForecastJob takes: (namespace, hashtext(companyId)).
    // pg_locks shows a two-key advisory lock as classid = key1, objid = key2 (as an unsigned oid), objsubid = 2.
    const locksOnKey = async (granted: boolean) => (await other.query<{ n: number }>("select count(*)::int as n from pg_locks where locktype = 'advisory' and granted = $3 and objsubid = 2 and classid::bigint = $1 and objid::bigint = (hashtext($2)::bigint & 4294967295)", [FORECAST_LOCK_NAMESPACE, companyId, granted])).rows[0]!.n;
    try {
      await other.query("begin");
      await other.query("select pg_advisory_xact_lock($1, hashtext($2))", [FORECAST_LOCK_NAMESPACE, companyId]);
      expect(await locksOnKey(true)).toBe(1);

      const job = runForecastJob(companyId, revision);
      let sawWaiter = false;
      for (const deadline = Date.now() + 3_000; !sawWaiter && Date.now() < deadline; await new Promise((resolve) => setTimeout(resolve, 20))) sawWaiter = (await locksOnKey(false)) > 0;

      const moved = await other.query<{ revision: string }>("update companies set financial_state_revision = (financial_state_revision::bigint + 1)::text where id = $1 returning financial_state_revision as revision", [companyId]);
      await other.query("insert into financial_state_revisions (company_id, revision, kind, subject_type, subject_id, via) values ($1, $2, 'item_edited', 'economic_item', $3, 'worker')", [companyId, moved.rows[0]!.revision, itemId]);
      await other.query("commit"); // releases the lock

      expect(await job).toEqual({ superseded: true });
      expect(await db.select().from(calculationRuns).where(and(eq(calculationRuns.companyId, companyId), eq(calculationRuns.financialStateRevision, revision)))).toHaveLength(0);
      expect(sawWaiter).toBe(true);
    } finally {
      await other.end();
    }
  });

  it("processes a queued forecast job from an older formula version as the current forecast job", async () => {
    const [company] = await db.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, companyId));
    const [job] = await db.insert(calculationOutbox).values({ companyId, financialStateRevision: company!.revision, engineVersion: "forecast-run-2026-01-01.1", period: "forecast", status: "queued" }).returning({ id: calculationOutbox.id });
    const result = await processCalculationOutboxJob(job!.id);
    expect(result).toEqual({ id: job!.id, status: "completed" });
    const [run] = await db.select({ engineVersion: calculationRuns.engineVersion }).from(calculationRuns).innerJoin(calculationOutbox, eq(calculationOutbox.calculationRunId, calculationRuns.id)).where(eq(calculationOutbox.id, job!.id));
    expect(run?.engineVersion).toMatch(/^forecast-run-/);
    expect(run?.engineVersion).not.toBe("forecast-run-2026-01-01.1");
  });
});
