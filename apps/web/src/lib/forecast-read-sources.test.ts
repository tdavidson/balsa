import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: fileURLToPath(new URL("../../../../.env.local", import.meta.url)) });
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

// Real Postgres: `sources` must resolve a driver's evidenceId to that company's own evidence row,
// and never leak another company's evidence label even when the id happens to be reachable.
describe.skipIf(!process.env.DATABASE_URL)("loadRecentConsequences sources", async () => {
  if (!process.env.DATABASE_URL) return; // skipped suites still run their factory
  const { chartAccounts, closeDatabase, companies, economicItems, evidence, forecastEntryTemplates, getDatabase, users } = await import("@finance/database");
  const { refreshCurrentCalculationRun } = await import("./refresh-calculation-run");
  const { forecastAsOfMonth } = await import("./forecast-inputs");
  const { addMonths } = await import("@balsa/finance-engine");
  const { loadRecentConsequences } = await import("./forecast-read");
  const db = getDatabase();
  let companyId = ""; let otherCompanyId = ""; let userId = ""; let firstMonth = "";

  beforeAll(async () => {
    const [company] = await db.insert(companies).values({ name: `Sources ${Date.now()}` }).returning({ id: companies.id });
    companyId = company!.id;
    const [otherCompany] = await db.insert(companies).values({ name: `Sources other ${Date.now()}` }).returning({ id: companies.id });
    otherCompanyId = otherCompany!.id;
    const [user] = await db.insert(users).values({ authProvider: "test", authProviderUserId: `sources-${Date.now()}`, email: `sources-${Date.now()}@example.com` }).returning({ id: users.id });
    userId = user!.id;
    const [cash, payroll] = await db.insert(chartAccounts).values([
      { companyId, code: "1000", name: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" },
      { companyId, code: "6000", name: "Payroll", accountType: "expense", normalBalance: "debit" },
    ]).returning({ id: chartAccounts.id });
    await db.insert(forecastEntryTemplates).values({ companyId, name: "Spend", itemType: "obligation", direction: "spend", debitAccountId: payroll!.id, creditAccountId: cash!.id });
    firstMonth = addMonths(await forecastAsOfMonth(companyId, new Date()), 1);
    await refreshCurrentCalculationRun(companyId, { cause: { kind: "entity_changed", subjectType: "company", subjectId: companyId, actorUserId: null, via: "worker" } });
  });

  afterAll(async () => {
    if (companyId) await db.delete(companies).where(eq(companies.id, companyId));
    if (otherCompanyId) await db.delete(companies).where(eq(companies.id, otherCompanyId));
    if (userId) await db.delete(users).where(eq(users.id, userId));
    await closeDatabase();
  });

  it("resolves the evidence behind an added driver, scoped to the company", async () => {
    const [source] = await db.insert(evidence).values({ companyId, createdByUserId: userId, sourceName: "Acme MSA.pdf", rawText: "" }).returning({ id: evidence.id });
    const [item] = await db.insert(economicItems).values({ companyId, evidenceId: source!.id, type: "obligation", direction: "spend", label: "Rent", amount: "500", cadence: "monthly", effectiveFrom: firstMonth, status: "confirmed" }).returning({ id: economicItems.id });
    await refreshCurrentCalculationRun(companyId, { cause: { kind: "item_confirmed", subjectType: "economic_item", subjectId: item!.id, actorUserId: null, via: "worker" } });
    const [row] = await loadRecentConsequences(companyId, 1);
    expect(row!.sources).toEqual([{ evidenceId: source!.id, sourceName: "Acme MSA.pdf" }]);
  });

  it("never returns another company's evidence, even when a driver's evidenceId points at it", async () => {
    const [otherSource] = await db.insert(evidence).values({ companyId: otherCompanyId, createdByUserId: userId, sourceName: "Other company's contract.pdf", rawText: "" }).returning({ id: evidence.id });
    const [item] = await db.insert(economicItems).values({ companyId, evidenceId: otherSource!.id, type: "obligation", direction: "spend", label: "Cross-tenant item", amount: "75", cadence: "monthly", effectiveFrom: firstMonth, status: "confirmed" }).returning({ id: economicItems.id });
    await refreshCurrentCalculationRun(companyId, { cause: { kind: "item_confirmed", subjectType: "economic_item", subjectId: item!.id, actorUserId: null, via: "worker" } });
    const [row] = await loadRecentConsequences(companyId, 1);
    expect(row!.sources).toEqual([]);
    expect(JSON.stringify(row!.sources)).not.toContain("Other company's contract.pdf");
  });
});
