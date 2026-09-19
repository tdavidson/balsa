import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: fileURLToPath(new URL("../../../../.env.local", import.meta.url)) });
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!process.env.DATABASE_URL)("pin forecast as plan", async () => {
  if (!process.env.DATABASE_URL) return; // skipped suites still run their factory
  const { chartAccounts, closeDatabase, companies, economicItems, forecastEntryTemplates, forecastVariables, getDatabase, journalEntries, journalLines, policies } = await import("@finance/database");
  const { pinForecastAsPlan } = await import("./forecast-plan-pin");
  const { postApprovedJournal } = await import("./journal-posting");
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

  it("reverses a legacy forecast-basis prior using its own basis, not plan", async () => {
    // A separate company: isolates this scenario from the payroll driver/entries above.
    const [legacyCompany] = await db.insert(companies).values({ name: `Plan pin legacy ${Date.now()}` }).returning({ id: companies.id });
    const legacyCompanyId = legacyCompany!.id;
    try {
      const [cash, payroll] = await db.insert(chartAccounts).values([
        { companyId: legacyCompanyId, code: "1000", name: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" },
        { companyId: legacyCompanyId, code: "6000", name: "Payroll", accountType: "expense", normalBalance: "debit" },
      ]).returning({ id: chartAccounts.id });
      const [policy] = await db.insert(policies).values({ companyId: legacyCompanyId, name: "Forecast payroll", rule: "Payroll is expensed monthly." }).returning({ id: policies.id });
      await db.insert(forecastEntryTemplates).values({ companyId: legacyCompanyId, name: "Payroll", itemType: "obligation", direction: "spend", debitAccountId: payroll!.id, creditAccountId: cash!.id, policyId: policy!.id });
      const [item] = await db.insert(economicItems).values({ companyId: legacyCompanyId, type: "obligation", direction: "spend", label: "Payroll", amount: "1000", cadence: "monthly", effectiveFrom: "2027-01", status: "confirmed" }).returning({ id: economicItems.id });
      const itemId = item!.id;
      // Posted by the old "apply projections" route: basis "forecast", source
      // "forecast_projection", same sourceLocation/period as the projection
      // below, but a different idempotencyKey/amount so it reads as an
      // earlier version that the pin must reverse.
      const legacy = await postApprovedJournal(legacyCompanyId, { idempotencyKey: `legacy-projection:${itemId}:2027-01`, label: "Projected: Payroll", source: "forecast_projection", postingDate: "2027-01-01", period: "2027-01", memo: "Projected: Payroll", basis: "forecast", policyId: policy!.id, deferRefresh: true, lines: [
        { accountId: payroll!.id, debitMinor: "90000", creditMinor: "0", currency: "USD", externalKey: "legacy:0", sourceLocation: `forecast-driver:${itemId}`, policyId: policy!.id },
        { accountId: cash!.id, debitMinor: "0", creditMinor: "90000", currency: "USD", externalKey: "legacy:1", sourceLocation: `forecast-driver:${itemId}`, policyId: policy!.id },
      ] });
      const before = BigInt((await db.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, legacyCompanyId)))[0]!.revision);
      const result = await pinForecastAsPlan(legacyCompanyId, { start: "2027-01", end: "2027-01", actorUserId: null, baseCurrency: "USD" });
      expect(result.posted).toBe(1);
      expect(result.reversed).toBe(1);
      const after = BigInt((await db.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, legacyCompanyId)))[0]!.revision);
      expect(after).toBe(before + 1n);
      const [reversalEntry] = await db.select({ basis: journalEntries.basis, reversalOfEntryId: journalEntries.reversalOfEntryId }).from(journalEntries).where(eq(journalEntries.reversalOfEntryId, legacy.entryId));
      expect(reversalEntry?.basis).toBe("forecast");
      expect(reversalEntry?.reversalOfEntryId).toBe(legacy.entryId);
    } finally {
      await db.delete(companies).where(eq(companies.id, legacyCompanyId));
    }
  });

  it("reverses a pinned formula identity that disappears when its amount becomes zero", async () => {
    const [formulaCompany] = await db.insert(companies).values({ name: `Plan pin formula ${Date.now()}` }).returning({ id: companies.id });
    const formulaCompanyId = formulaCompany!.id;
    try {
      const [cash, payroll] = await db.insert(chartAccounts).values([
        { companyId: formulaCompanyId, code: "1000", name: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" },
        { companyId: formulaCompanyId, code: "6000", name: "Payroll", accountType: "expense", normalBalance: "debit" },
      ]).returning({ id: chartAccounts.id });
      const [policy] = await db.insert(policies).values({ companyId: formulaCompanyId, name: "Formula payroll", rule: "Formula payroll is expensed monthly." }).returning({ id: policies.id });
      await db.insert(forecastEntryTemplates).values({ companyId: formulaCompanyId, name: "Payroll", itemType: "obligation", direction: "spend", debitAccountId: payroll!.id, creditAccountId: cash!.id, policyId: policy!.id });
      const [variable] = await db.insert(forecastVariables).values({ companyId: formulaCompanyId, name: "payroll", kind: "money", dims: [], inputs: [{ coords: {}, from: "2026-12", value: "1000" }] }).returning({ id: forecastVariables.id });
      const [item] = await db.insert(economicItems).values({ companyId: formulaCompanyId, type: "obligation", direction: "spend", label: "Payroll", amountFormula: "payroll", cadence: "monthly", effectiveFrom: "2027-01", status: "confirmed" }).returning({ id: economicItems.id });

      const first = await pinForecastAsPlan(formulaCompanyId, { start: "2027-01", end: "2027-01", actorUserId: null, baseCurrency: "USD" });
      expect(first).toMatchObject({ posted: 1, reversed: 0, exceptions: [] });
      const [original] = await db.select({ id: journalEntries.id }).from(journalEntries).innerJoin(journalLines, eq(journalLines.entryId, journalEntries.id)).where(and(eq(journalEntries.companyId, formulaCompanyId), eq(journalLines.sourceLocation, `forecast-driver:${item!.id}`), eq(journalEntries.basis, "plan"), eq(journalEntries.period, "2027-01"))).limit(1);
      expect(original).toBeDefined();

      await db.update(forecastVariables).set({ inputs: [{ coords: {}, from: "2026-12", value: "0" }] }).where(and(eq(forecastVariables.id, variable!.id), eq(forecastVariables.companyId, formulaCompanyId)));
      const second = await pinForecastAsPlan(formulaCompanyId, { start: "2027-01", end: "2027-01", actorUserId: null, baseCurrency: "USD" });
      expect(second).toMatchObject({ posted: 0, reversed: 1, exceptions: [] });
      const reversals = await db.select({ id: journalEntries.id }).from(journalEntries).where(and(eq(journalEntries.companyId, formulaCompanyId), eq(journalEntries.reversalOfEntryId, original!.id)));
      expect(reversals).toHaveLength(1);
      const contribution = await db.select({ debitMinor: journalLines.debitMinor, creditMinor: journalLines.creditMinor }).from(journalLines).where(and(eq(journalLines.companyId, formulaCompanyId), eq(journalLines.accountId, payroll!.id), inArray(journalLines.entryId, [original!.id, reversals[0]!.id])));
      expect(contribution.reduce((total, line) => total + BigInt(line.debitMinor) - BigInt(line.creditMinor), 0n)).toBe(0n);

      const third = await pinForecastAsPlan(formulaCompanyId, { start: "2027-01", end: "2027-01", actorUserId: null, baseCurrency: "USD" });
      expect(third).toMatchObject({ posted: 0, reversed: 0, exceptions: [] });
      expect(await db.select({ id: journalEntries.id }).from(journalEntries).where(and(eq(journalEntries.companyId, formulaCompanyId), eq(journalEntries.reversalOfEntryId, original!.id)))).toHaveLength(1);

      await db.update(forecastVariables).set({ inputs: [{ coords: {}, from: "2026-12", value: "1000" }] }).where(and(eq(forecastVariables.id, variable!.id), eq(forecastVariables.companyId, formulaCompanyId)));
      const restored = await pinForecastAsPlan(formulaCompanyId, { start: "2027-01", end: "2027-01", actorUserId: null, baseCurrency: "USD" });
      expect(restored).toMatchObject({ posted: 1, idempotent: 0, reversed: 0, exceptions: [] });
      const activeContribution = await db.select({ debitMinor: journalLines.debitMinor, creditMinor: journalLines.creditMinor }).from(journalLines).innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId)).where(and(eq(journalLines.companyId, formulaCompanyId), eq(journalLines.accountId, payroll!.id), eq(journalEntries.period, "2027-01")));
      expect(activeContribution.reduce((total, line) => total + BigInt(line.debitMinor) - BigInt(line.creditMinor), 0n)).toBe(100000n);

      const retry = await pinForecastAsPlan(formulaCompanyId, { start: "2027-01", end: "2027-01", actorUserId: null, baseCurrency: "USD" });
      expect(retry).toMatchObject({ posted: 1, idempotent: 1, reversed: 0, exceptions: [] });
    } finally {
      await db.delete(companies).where(eq(companies.id, formulaCompanyId));
    }
  });
});
