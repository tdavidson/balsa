import { describe, expect, it } from "vitest";
import { buildEvidencePublication, monthFromEvidenceFact } from "./evidence-publication";

describe("evidence publication", () => {
  it("does not invent a current month", () => {
    expect(monthFromEvidenceFact("Revenue $1,000.00")).toBeUndefined();
    expect(monthFromEvidenceFact("Revenue $1,000.00", "2026-08")).toBe("2026-08");
  });

  it("does not turn P&L revenue into cash", () => {
    const plan = buildEvidencePublication({ sourceKind: "profit_and_loss", reportingMonth: "2026-08", facts: [{ label: "Management fee revenue", value: "$10,000.00", accountingRole: "revenue" }] });
    expect(plan.cashEvents).toEqual([]);
  });

  it("publishes transaction-source facts as dated cash", () => {
    const plan = buildEvidencePublication({ sourceKind: "bank_statement", facts: [{ label: "Client deposit", value: "2026-08-12 $3,100.00", accountingRole: "revenue" }] });
    expect(plan.cashEvents).toEqual([expect.objectContaining({ month: "2026-08", amount: "3100", direction: "receipt" })]);
  });

  it("requires explicit opening-balance semantics", () => {
    const plan = buildEvidencePublication({ sourceKind: "balance_sheet", reportingMonth: "2026-01", facts: [{ label: "Cash balance", value: "$50,000.00", accountingRole: "ending_balance" }] });
    expect(plan.openingBalances).toEqual([]);
  });
});
