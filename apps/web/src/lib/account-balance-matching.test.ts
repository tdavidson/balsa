import { describe, expect, it } from "vitest";
import { compareStatementAndBookBalances } from "./account-balance-matching";

describe("account balance matching", () => {
  it("compares summed bank endings with book cash for the same month", () => {
    const comparisons = compareStatementAndBookBalances([
      { month: "2026-08", kind: "bank_statement", sourceName: "Operating", accountIdentifier: "001", endingBalance: "10,000.00" },
      { month: "2026-08", kind: "bank_statement", sourceName: "Savings", accountIdentifier: "002", endingBalance: "$2,500.00" },
      { month: "2026-08", kind: "balance_sheet", sourceName: "QuickBooks balance sheet", facts: [{ label: "Cash and cash equivalents ending balance", value: "$12,500.00", accountingRole: "ending_balance" }] },
    ]);
    expect(comparisons).toEqual([expect.objectContaining({ month: "2026-08", statementBalance: 12_500, bookBalance: 12_500, difference: 0 })]);
  });

  it("does not compare unsupported summaries", () => {
    expect(compareStatementAndBookBalances([{ month: "2026-08", kind: "brokerage_statement", sourceName: "Portfolio", endingBalance: "100" }])).toEqual([]);
  });
});
