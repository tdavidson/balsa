import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!process.env.DATABASE_URL)("cash explorer approval integration", async () => {
  if (!process.env.DATABASE_URL) return;
  const { companies, chartAccounts, policies, economicItems, forecastEntryTemplates, decisions, getDatabase, closeDatabase } = await import("@finance/database");
  const { postApprovedJournal } = await import("./journal-posting");
  const { loadFinancialProgress } = await import("./financial-progress");
  const { applyDecisionAndEnqueue } = await import("./decision-effects");
  const db = getDatabase(); let companyId = "";
  const now = new Date("2026-10-03T12:00:00Z");
  afterAll(async () => { if (companyId) await db.delete(companies).where(eq(companies.id, companyId)); await closeDatabase(); });

  it("excludes proposed and rejected decisions and refreshes every cash view after a real approval", async () => {
    const [company] = await db.insert(companies).values({ name: `Synthetic cash explorer ${crypto.randomUUID()}` }).returning(); companyId = company!.id;
    const accounts = await db.insert(chartAccounts).values([
      { companyId, code: "1000", name: "Cash", statementLine: "Cash", accountType: "asset", normalBalance: "debit" },
      { companyId, code: "3000", name: "Capital", accountType: "equity", normalBalance: "credit" },
      { companyId, code: "4000", name: "Revenue", accountType: "revenue", normalBalance: "credit" },
      { companyId, code: "6000", name: "Payroll", accountType: "expense", normalBalance: "debit" },
    ]).returning();
    const account = (code: string) => accounts.find((item) => item.code === code)!.id;
    await db.insert(forecastEntryTemplates).values([
      { companyId, name: "Receipts", itemType: "agreement", direction: "receipt", debitAccountId: account("1000"), creditAccountId: account("4000") },
      { companyId, name: "Spending", itemType: "obligation", direction: "spend", debitAccountId: account("6000"), creditAccountId: account("1000") },
    ]);
    const [policy] = await db.insert(policies).values({ companyId, name: "Synthetic opening", rule: "Approved synthetic opening capital", active: "Y" }).returning();
    await postApprovedJournal(companyId, { policyId: policy!.id, idempotencyKey: "synthetic-opening", label: "Synthetic opening", source: "synthetic_test", postingDate: "2026-06-30", period: "2026-06", memo: "Synthetic capital", deferRefresh: true, lines: [
      { accountId: account("1000"), currency: "USD", debitMinor: "10000000", creditMinor: "0" },
      { accountId: account("3000"), currency: "USD", debitMinor: "0", creditMinor: "10000000" },
    ] });
    await db.insert(economicItems).values({ companyId, type: "obligation", direction: "spend", label: "Synthetic payroll", amount: "20000", cadence: "monthly", effectiveFrom: "2026-10", status: "confirmed" });
    const effect = JSON.stringify({ kind: "add_item", item: { type: "agreement", direction: "receipt", label: "Synthetic customer agreement", amount: 20000, cadence: "once", effectiveFrom: "2026-10", category: "other" } });
    const [proposal] = await db.insert(decisions).values({ companyId, question: "Include the synthetic October agreement?", answer: "Receive $20,000 in October", effect, status: "proposed" }).returning();
    await db.insert(decisions).values({ companyId, question: "Rejected duplicate agreement", answer: "Exclude", effect, status: "rejected" });
    const before = await loadFinancialProgress(companyId, now);
    expect(before.cashExplorer.months.find((m) => m.month === "2026-10")?.endingCashMinor).toBe("8000000");
    expect(before.cashExplorer.categories.some((row) => row.label === "Synthetic customer agreement")).toBe(false);
    await applyDecisionAndEnqueue(companyId, proposal!.id, null);
    const after = await loadFinancialProgress(companyId, now);
    expect(after.cashExplorer.months.find((m) => m.month === "2026-10")?.endingCashMinor).toBe("10000000");
    for (const month of after.cashExplorer.months) {
      const old = before.cashExplorer.months.find((m) => m.month === month.month)!;
      if (month.basis === "actual") expect(month).toEqual(old);
      else expect(BigInt(month.endingCashMinor) - BigInt(old.endingCashMinor)).toBe(2000000n);
      expect(month.reconciles).toBe(true);
      expect(after.review.forecastMonths.find((m) => m.month === month.month)?.endingCashMinor).toBe(month.endingCashMinor);
    }
    expect(after.cashExplorer.categories.find((row) => row.label === "Synthetic customer agreement")?.amounts).toEqual({ "2026-10": "2000000" });
    expect(after.review.previewToken).not.toBe(before.review.previewToken);
  });
});
