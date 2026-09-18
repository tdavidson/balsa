import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: fileURLToPath(new URL("../../../../.env.local", import.meta.url)) });
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!process.env.DATABASE_URL)("pin forecast as plan", async () => {
  if (!process.env.DATABASE_URL) return; // skipped suites still run their factory
  const { chartAccounts, closeDatabase, companies, economicItems, forecastEntryTemplates, getDatabase, journalEntries, policies } = await import("@finance/database");
  const { pinForecastAsPlan } = await import("./forecast-plan-pin");
  const db = getDatabase();
  let companyId = "";
  const revision = async () => (await db.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, companyId)))[0]!.revision;

  beforeAll(async () => {
    const [company] = await db.insert(companies).values({ name: `Plan pin ${Date.now()}` }).returning({ id: companies.id });
    companyId = company!.id;
    const [cash, payroll] = await db.insert(chartAccounts).values([
      { companyId, code: "1000", name: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" },
      { companyId, code: "6000", name: "Payroll", accountType: "expense", normalBalance: "debit" },
    ]).returning({ id: chartAccounts.id });
    const [policy] = await db.insert(policies).values({ companyId, name: "Forecast payroll", rule: "Payroll is expensed monthly." }).returning({ id: policies.id });
    await db.insert(forecastEntryTemplates).values({ companyId, name: "Payroll", itemType: "obligation", direction: "spend", debitAccountId: payroll!.id, creditAccountId: cash!.id, policyId: policy!.id });
    await db.insert(economicItems).values({ companyId, type: "obligation", direction: "spend", label: "Payroll", amount: "1000", cadence: "monthly", effectiveFrom: "2027-01", status: "confirmed" });
  });

  afterAll(async () => {
    if (companyId) await db.delete(companies).where(eq(companies.id, companyId));
    await closeDatabase();
  });

  it("posts plan-basis journals and advances the revision exactly once", async () => {
    const before = BigInt(await revision());
    const result = await pinForecastAsPlan(companyId, { start: "2027-01", end: "2027-03", actorUserId: null, baseCurrency: "USD" });
    expect(result.posted).toBe(3);
    expect(BigInt(await revision())).toBe(before + 1n);
    const entries = await db.select({ basis: journalEntries.basis }).from(journalEntries).where(and(eq(journalEntries.companyId, companyId)));
    expect(entries.every((entry) => entry.basis === "plan")).toBe(true);
  });
});
