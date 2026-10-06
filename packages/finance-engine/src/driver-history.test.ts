import { describe, expect, it } from "vitest";
import { analyzeHistory, suggestPattern } from "./driver-history";

const months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const series = (values: number[]) => values.map((value, index) => ({ month: months[index]!, value }));
const revenue = series([10000, 11000, 12100, 13310, 14641, 16105.1]);
const revenueRef = { kind: "report_line" as const, line: "revenue" };

describe("suggestions from actuals", () => {
  it("links a cost that tracks revenue as a share of it", () => {
    const hosting = series([410, 440, 500, 540, 590, 640]);
    const stats = analyzeHistory(hosting, revenue);
    const suggestion = suggestPattern(stats, { label: "Hosting", money: true, revenueRef })!;
    expect(suggestion.basis).toBe("share_of_revenue");
    expect(suggestion.pattern.change).toEqual({ basis: "pct_of", ref: revenueRef });
    expect(Number(suggestion.pattern.initialValue)).toBeCloseTo(stats.revenueShare!.mean, 4);
    expect(suggestion.rationale).toMatch(/^Hosting has run at 4% of revenue over the last 6 months, between 4% and 4\.1%\.$/);
  });

  it("grows revenue at its steady compound rate, starting the month after the last actual", () => {
    const suggestion = suggestPattern(analyzeHistory(revenue, revenue), { label: "Revenue", money: true, isRevenue: true, revenueRef })!;
    expect(suggestion).toMatchObject({ basis: "growth", confidence: "high", pattern: { initialValue: "17715.61", change: { basis: "pct_change", everyMonths: 1, by: "0.1" } } });
    // A metric continues from its last actual; a driver that started two months ago is rebased back.
    expect(suggestPattern(analyzeHistory(revenue, revenue), { label: "Revenue", money: true, isRevenue: true, startOffset: 0 })!.pattern.initialValue).toBe("16105.1");
    expect(suggestPattern(analyzeHistory(revenue, revenue), { label: "Revenue", money: true, isRevenue: true, startOffset: -1 })!.pattern.initialValue).toBe("14641");
  });

  it("falls back to the recent average for an unsteady line, and says so", () => {
    const rent = series([2000, 2600, 1900, 2400, 2100, 2500]);
    const suggestion = suggestPattern(analyzeHistory(rent, revenue), { label: "Rent", money: true, revenueRef })!;
    expect(suggestion.basis).toBe("average");
    expect(suggestion.pattern).toEqual({ initialValue: "2250", repeatsEveryMonths: 1 });
    expect(suggestion.rationale).toMatch(/no steady trend or link to revenue/);
  });

  it("does not link a flat cost to flat revenue just because the ratio is steady", () => {
    const flatRevenue = series([12000, 12000, 12000, 12000, 12000, 12000]);
    const suggestion = suggestPattern(analyzeHistory(series([800, 800, 800, 800, 800, 800]), flatRevenue), { label: "Office rent", money: true, revenueRef })!;
    expect(suggestion).toMatchObject({ basis: "average", pattern: { initialValue: "800", repeatsEveryMonths: 1 } });
  });

  it("repeats the latest value, with low confidence, when there is too little history", () => {
    expect(suggestPattern(analyzeHistory(series([300, 320])), { label: "Customers", money: false })).toMatchObject({ basis: "last", confidence: "low", pattern: { initialValue: "320" } });
    expect(suggestPattern(analyzeHistory([]), { label: "Nothing", money: true })).toBeNull();
  });
});
