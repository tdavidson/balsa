import { describe, expect, it } from "vitest";
import { isDetailedFinancialEvent, parseFinancialAmount } from "./financial-events";

describe("financial event detail", () => {
  it("accepts ordinary deterministic transaction descriptions while excluding summaries", () => {
    expect(isDetailedFinancialEvent("Den Technologies management fee")).toBe(true);
    expect(isDetailedFinancialEvent("Beginning Total Value")).toBe(false);
    expect(isDetailedFinancialEvent("Consolidated ending balance")).toBe(false);
  });

  it("parses statement balances without a currency symbol without treating dates as amounts", () => {
    expect(parseFinancialAmount("Ending balance 10,000.00")).toBe(10_000);
    expect(parseFinancialAmount("Statement date 2026-08-31")).toBeUndefined();
  });
});
