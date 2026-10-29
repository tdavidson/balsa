import { describe, expect, it } from "vitest";
import { buildReconciliationReview } from "./reconciliation-review";

describe("reconciliation review grouping", () => {
  it("groups balance and duplicate findings into CFO questions", () => {
    const reviews = buildReconciliationReview({ month: "2026-09", opening: 100, ending: 130, expectedEnding: 125, difference: 5, transactionCount: 10, duplicateGroups: [{ amount: 25, direction: "receipt", date: "2026-09-03", sources: ["Bank", "Books"], descriptions: ["Sample Technologies", "Sample Technologies payment"] }], unclassifiedCount: 0 });
    expect(reviews.map((review) => review.kind)).toEqual(["balance", "duplicate"]);
    expect(reviews[1]?.evidence).toContain("Sources: Bank · Books");
  });

  it("groups conflicting balances and a period gap", () => {
    const reviews = buildReconciliationReview({ month: "2026-09", opening: 100, ending: 125, transactionCount: 0, duplicateGroups: [], unclassifiedCount: 0, balanceConflict: "ending", coverageGapFrom: "2026-07" });
    expect(reviews.map((review) => review.kind)).toEqual(["balance", "coverage"]);
  });

  it("asks one recognition question only for a material P&L versus cash difference", () => {
    const reviews = buildReconciliationReview({ month: "2026-09", opening: 100, ending: 125, transactionCount: 0, duplicateGroups: [], unclassifiedCount: 0, revenueComparison: { reported: 20_000, cashReceived: 15_000, sources: ["September P&L"] } });
    expect(reviews.map((review) => review.kind)).toContain("recognition");
    expect(reviews.find((review) => review.kind === "recognition")?.evidence).toContain("Income-statement sources: September P&L");
  });

  it("groups conflicting account mappings into one question", () => {
    const reviews = buildReconciliationReview({ month: "2026-09", opening: 100, ending: 125, transactionCount: 0, duplicateGroups: [], unclassifiedCount: 0, accountConflict: { identifier: "••••1234", sources: ["Bank statement", "QuickBooks export"] } });
    expect(reviews.find((review) => review.kind === "account")?.question).toContain("••••1234");
  });

  it("keeps a foreign-currency exception grouped by month", () => {
    const reviews = buildReconciliationReview({ month: "2026-09", opening: 100, ending: 125, transactionCount: 0, duplicateGroups: [], unclassifiedCount: 0, currencyMismatch: { baseCurrency: "USD", currencies: ["CAD"], sources: ["Canadian bank"], count: 2 } });
    expect(reviews.find((review) => review.kind === "currency")?.question).toContain("conversion treatment");
  });

  it("groups unmatched bank-to-books activity into one decision", () => {
    const reviews = buildReconciliationReview({ month: "2026-09", opening: 100, ending: 125, transactionCount: 0, duplicateGroups: [], unclassifiedCount: 0, unmatchedBookCount: 4, unmatchedBookSources: ["Bank", "QuickBooks"] });
    expect(reviews.find((review) => review.kind === "unmatched")?.evidence).toContain("Sources: Bank · QuickBooks");
  });
});
