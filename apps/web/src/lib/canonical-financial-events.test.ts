import { describe, expect, it } from "vitest";
import { canonicalFinancialEvents } from "./canonical-financial-events";

describe("canonical financial events", () => {
  it("keeps repeated same-source events", () => {
    const events = ["a", "b"].map((id) => ({ id, date: "2026-08-01", amount: "100", direction: "spend", description: "Payroll", sourceName: "Bank", sourceKind: "bank_statement" }));
    expect(canonicalFinancialEvents(events)).toHaveLength(2);
  });

  it("uses one explicit bank/books match for cash reporting", () => {
    const events = [
      { id: "bank", date: "2026-08-01", amount: "100", direction: "spend", description: "Vendor", sourceName: "Bank", sourceKind: "bank_statement" },
      { id: "books", date: "2026-08-01", amount: "100", direction: "spend", description: "Vendor", sourceName: "QuickBooks", sourceKind: "quickbooks_transactions" },
    ];
    expect(canonicalFinancialEvents(events).map((event) => event.id)).toEqual(["bank"]);
    expect(canonicalFinancialEvents(events, "books").map((event) => event.id)).toEqual(["books"]);
  });
});
