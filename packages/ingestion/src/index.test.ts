import { describe, expect, it } from "vitest";
import { expandFinancialFactDates, normalizeTransactions, parseCsvRows, parseOfx, transactionExternalKey } from "./index";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("transaction ingestion", () => {
  it("normalizes quoted CSV, debit/credit, and dates across months", () => {
    const rows = parseCsvRows('Date,Description,Debit,Credit\n2026-09-03,"Customer, payment",,12500\n2026-10-15,Contractor,3200,');
    expect(normalizeTransactions(rows, "2026-09")).toEqual([
      { date: "2026-09", postedDate: "2026-09-03", description: "Customer, payment", amount: 12500, direction: "receipt" },
      { date: "2026-10", postedDate: "2026-10-15", description: "Contractor", amount: 3200, direction: "spend" },
    ]);
  });
  it("bootstraps QuickBooks OFX transactions", () => {
    expect(parseOfx("<STMTTRN><DTPOSTED>20260903<TRNAMT>-3200<NAME>Contractor<MEMO>September invoice</STMTTRN>")).toEqual([{ date: "2026-09", postedDate: "2026-09-03", description: "Contractor · September invoice", amount: 3200, direction: "spend" }]);
  });

  it("keeps exact dates and note fields from bank transaction lists", () => {
    const rows = parseCsvRows("Date,Amount,Name,Note\n2026-07-14,60000,Incoming wire,Klingenstein Fund II management fee");
    expect(normalizeTransactions(rows, "2026-09")).toEqual([{
      date: "2026-07",
      postedDate: "2026-07-14",
      description: "Incoming wire · Klingenstein Fund II management fee",
      amount: 60000,
      direction: "receipt",
    }]);
  });

  it("expands abbreviated statement dates using the source year", () => {
    expect(expandFinancialFactDates([
      { label: "Cash Flow Activity 7/30", value: "Activity Date 7/30; $24,811.88" },
      { label: "Beginning value as of 7/1/26", value: "$348,126.13" },
    ], "2026-07-31")).toEqual([
      { label: "Cash Flow Activity 2026-07-30", value: "Activity Date 2026-07-30; $24,811.88" },
      { label: "Beginning value as of 2026-07-01", value: "$348,126.13" },
    ]);
  });

  it("gives the same transaction a stable identity across repeated imports", () => {
    const transaction = { date: "2026-09", description: "Customer payment", amount: 12500, direction: "receipt" as const };
    expect(transactionExternalKey(transaction)).toBe(transactionExternalKey({ ...transaction }));
    expect(transactionExternalKey(transaction)).not.toBe(transactionExternalKey({ ...transaction, amount: 12500.01 }));
    expect(transactionExternalKey({ ...transaction, postedDate: "2026-09-03" })).not.toBe(transactionExternalKey({ ...transaction, postedDate: "2026-09-04" }));
  });

  it("loads the Company Zero multi-month fixture without assigning it to the selected month", () => {
    const csv = readFileSync(resolve(process.cwd(), "../../fixtures/company-zero/bank-transactions.csv"), "utf8");
    const transactions = normalizeTransactions(parseCsvRows(csv), "2026-09");
    expect(transactions.map((transaction) => transaction.date)).toEqual(["2026-09", "2026-09", "2026-10", "2026-10"]);
    expect(transactions.reduce((sum, transaction) => sum + (transaction.direction === "receipt" ? transaction.amount : -transaction.amount), 0)).toBe(18600);
  });
});
