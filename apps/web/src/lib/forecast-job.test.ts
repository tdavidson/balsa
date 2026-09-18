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
  const { chartAccounts, closeDatabase, companies, economicItems, financialStateRevisions, forecastConsequences, forecastEntryTemplates, getDatabase } = await import("@finance/database");
  const { refreshCurrentCalculationRun } = await import("./refresh-calculation-run");
  const { forecastAsOfMonth } = await import("./forecast-inputs");
  const { addMonths } = await import("@nevermodel/finance-engine");
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
});
