import { describe, expect, it } from "vitest";
import { provisionalCashSeries, type ProvisionalSource } from "./provisional-cash-series";

const statement = (overrides: Partial<ProvisionalSource> & { balance?: string; factStatus?: string; role?: string; label?: string }): ProvisionalSource => ({
  id: overrides.id ?? "a",
  sourceName: overrides.sourceName ?? "Synthetic checking.pdf",
  status: overrides.status ?? "pending",
  identityStatus: overrides.identityStatus ?? "pending",
  reportingMonth: overrides.reportingMonth ?? "2026-08",
  accountIdentifier: overrides.accountIdentifier ?? "****1111",
  currency: overrides.currency ?? "USD",
  createdAt: overrides.createdAt ?? "2026-09-01T00:00:00Z",
  extraction: { facts: [{ label: "Opening balance", value: "1,000.00", accountingRole: "opening_balance" }, { label: overrides.label ?? "Ending balance", value: overrides.balance ?? "1,500.00", accountingRole: overrides.role ?? "ending_balance", ...(overrides.factStatus ? { factStatus: overrides.factStatus } : {}) }] },
});

describe("provisional cash series", () => {
  it("sums one ending balance per account per month and marks unapproved months unverified", () => {
    const series = provisionalCashSeries([
      statement({ id: "a" }),
      statement({ id: "b", accountIdentifier: "****2222", balance: "$250.25", status: "approved", factStatus: "treatment_approved" }),
      statement({ id: "c", reportingMonth: "2026-09", balance: "1,800.00", status: "approved", factStatus: "treatment_approved" }),
    ], "USD");
    expect(series.points).toEqual([
      { month: "2026-08", amount: 1750.25, accounts: 2, verified: false, sources: ["Synthetic checking.pdf", "Synthetic checking.pdf"] },
      { month: "2026-09", amount: 1800, accounts: 1, verified: true, sources: ["Synthetic checking.pdf"] },
    ]);
  });

  it("keeps the most recently loaded statement for an account and month", () => {
    const series = provisionalCashSeries([statement({ id: "old", balance: "100.00", createdAt: "2026-09-01T00:00:00Z" }), statement({ id: "new", balance: "200.00", createdAt: "2026-09-02T00:00:00Z" })], "USD");
    expect(series.points.map((point) => point.amount)).toEqual([200]);
  });

  it("ignores rejected sources and facts, unreadable amounts, and other currencies", () => {
    const series = provisionalCashSeries([
      statement({ id: "rejected", identityStatus: "rejected" }),
      statement({ id: "fact", factStatus: "rejected" }),
      statement({ id: "text", balance: "see attached" }),
      statement({ id: "eur", currency: "EUR", accountIdentifier: "****3333" }),
    ], "USD");
    expect(series.points).toEqual([]);
    expect(series.excludedCurrencies).toEqual(["EUR"]);
  });

  it("reads an unclassified closing balance by its label but never an opening balance", () => {
    expect(provisionalCashSeries([statement({ role: "unknown", label: "Closing balance" })], "USD").points).toHaveLength(1);
    expect(provisionalCashSeries([statement({ role: "unknown", label: "Balance forward" })], "USD").points).toHaveLength(0);
  });
});
