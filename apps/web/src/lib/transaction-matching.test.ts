import { describe, expect, it } from "vitest";
import { matchTransactionsAcrossSources } from "./transaction-matching";

describe("cross-source transaction matching", () => {
  it("matches same-day same-amount activity with different source descriptions", () => {
    const groups = matchTransactionsAcrossSources([
      { id: "statement-1", date: "2026-09-03", amount: "3100.00", direction: "receipt", description: "Direct deposit Den Technologies", sourceName: "September bank statement" },
      { id: "qb-1", date: "2026-09-03", amount: 3100, direction: "receipt", description: "Den Technologies client payment", sourceName: "QuickBooks transaction detail" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ transactionIds: ["statement-1", "qb-1"], sources: ["September bank statement", "QuickBooks transaction detail"], amount: 3100 });
  });

  it("does not match different directions or amounts", () => {
    expect(matchTransactionsAcrossSources([
      { id: "receipt", date: "2026-09-03", amount: 100, direction: "receipt", description: "Client payment", sourceName: "Bank" },
      { id: "spend", date: "2026-09-03", amount: 100, direction: "spend", description: "Client payment", sourceName: "Books" },
    ])).toEqual([]);
  });

  it("matches opposite-direction transfer counterparts across accounts", () => {
    const groups = matchTransactionsAcrossSources([
      { id: "bank-out", date: "2026-09-03", amount: 25000, direction: "spend", description: "Funds transferred to account ending 255", sourceName: "Operating account statement" },
      { id: "bank-in", date: "2026-09-04", amount: 25000, direction: "receipt", description: "Funds transferred from account ending 256", sourceName: "Savings account statement" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: "transfer", transactionIds: ["bank-out", "bank-in"], amount: 25000 });
  });

  it("matches a bank item to a QuickBooks item only with supporting source and memo evidence", () => {
    const groups = matchTransactionsAcrossSources([
      { id: "bank", date: "2026-09-03", amount: 3_100, direction: "receipt", description: "ACH Den Technologies", sourceName: "Bank", sourceKind: "bank_statement" },
      { id: "books", date: "2026-09-04", amount: 3_100, direction: "receipt", description: "Den Technologies payment", sourceName: "QuickBooks", sourceKind: "quickbooks_transactions" },
    ]);
    expect(groups).toEqual([expect.objectContaining({ kind: "book_match", transactionIds: ["bank", "books"] })]);
  });

  it("uses a shared bank or book reference when source descriptions use different language", () => {
    const groups = matchTransactionsAcrossSources([
      { id: "bank", date: "2026-09-03", amount: 12_500, direction: "receipt", description: "Wire received confirmation: WIR-8F42A", sourceName: "Bank", sourceKind: "bank_statement" },
      { id: "books", date: "2026-09-07", amount: 12_500, direction: "receipt", description: "Client collection · wire no. WIR-8F42A", sourceName: "QuickBooks", sourceKind: "quickbooks_transactions" },
    ]);
    expect(groups).toEqual([expect.objectContaining({ kind: "book_match", transactionIds: ["bank", "books"] })]);
  });

  it("does not label a shared reference as a bank-to-books match without a bank-to-books pair", () => {
    const groups = matchTransactionsAcrossSources([
      { id: "bank-one", date: "2026-09-03", amount: 12_500, direction: "receipt", description: "Wire reference WIR-8F42A", sourceName: "Bank one", sourceKind: "bank_statement" },
      { id: "bank-two", date: "2026-09-03", amount: 12_500, direction: "receipt", description: "Incoming wire WIR-8F42A", sourceName: "Bank two", sourceKind: "bank_statement" },
    ]);
    expect(groups).toEqual([expect.objectContaining({ kind: "duplicate" })]);
  });
});
