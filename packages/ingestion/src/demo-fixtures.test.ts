import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adaptGeneralLedgerRows, classifySource, normalizeTransactions, parseCsvRows } from "./index";

const fixture = (path: string) => readFileSync(new URL(`../../../fixtures/demo-saas/${path}`, import.meta.url), "utf8");
const cents = (value: number) => Math.round(value * 100);

describe("synthetic SaaS demo import compatibility", () => {
  it("includes the Q1 customer ramp without accruing April insurance early", () => {
    const expected = JSON.parse(fixture("expected/expected-results.json"));
    expect(expected.openingDate).toBe("2025-12-31");
    expect(expected.monthly.slice(0, 3).map((month: { revenue: number; mrr: number; customers: number; balances: Record<string, number> }) => ({
      revenue: month.revenue, mrr: month.mrr, customers: month.customers,
      prepaidInsurance: month.balances["1200"], deferredRevenue: month.balances["2100"],
    }))).toEqual([
      { revenue: 600000, mrr: 600000, customers: 4, prepaidInsurance: 0, deferredRevenue: 0 },
      { revenue: 900000, mrr: 900000, customers: 6, prepaidInsurance: 0, deferredRevenue: 0 },
      { revenue: 1200000, mrr: 1200000, customers: 8, prepaidInsurance: 0, deferredRevenue: 0 },
    ]);
    const ledger = parseCsvRows(fixture("02-history/accounting-reference/general-ledger.csv"));
    expect(ledger[1]?.[0]).toBe(expected.openingDate);
  });

  it("retains bank dates, signs and cash balances across all nine months", () => {
    const expected = JSON.parse(fixture("expected/expected-results.json"));
    expect(expected.monthly.map((month: { month: string }) => month.month)).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09",
    ]);
    for (const [name, code, opening] of [
      ["operating-checking", "1000", 25000000],
      ["reserve-savings", "1010", 0],
    ] as const) {
      const text = fixture(`02-history/bank/${name}-transactions.csv`);
      const rows = parseCsvRows(text);
      expect(classifySource({ filename: `${name}-transactions.csv`, text }).kind).toBe("bank_statement");
      const transactions = normalizeTransactions(rows, "1999-01");
      expect(transactions).toHaveLength(rows.length - 1);
      for (const result of expected.monthly) {
        const movements = transactions.filter((t) => t.date <= result.month);
        const balance = opening + movements.reduce((sum, t) => sum + cents(t.amount) * (t.direction === "receipt" ? 1 : -1), 0);
        expect(balance).toBe(result.balances[code]);
      }
      expect(transactions.every((t) => t.postedDate?.startsWith("2026-"))).toBe(true);
    }
  });

  it("retains gross processor charges and the refund, without silently netting fees", () => {
    const rows = parseCsvRows(fixture("02-history/processor/balance-transactions.csv"));
    const transactions = normalizeTransactions(rows, "1999-01");
    expect(transactions).toHaveLength(rows.length - 1);
    const refund = transactions.filter((t) => t.direction === "spend");
    expect(refund).toHaveLength(1);
    expect(refund[0]).toMatchObject({ amount: 500, postedDate: "2026-09-04" });
    expect(transactions[0]?.amount).toBe(1500);
    // Fee/clearing accounting requires a reviewed mapping in the application;
    // the generic transaction parser intentionally returns the gross amount.
  });

  it("adapts every reference ledger line and preserves balanced entries", () => {
    const text = fixture("02-history/accounting-reference/general-ledger.csv");
    const raw = parseCsvRows(text);
    expect(classifySource({ filename: "general-ledger.csv", text }).kind).toBe("general_ledger");
    const lines = adaptGeneralLedgerRows(raw, "1999-01", "USD");
    expect(lines).toHaveLength(raw.length - 1);
    const groups = new Map<string, bigint>();
    lines.forEach((line, index) => {
      expect(line.transactionDate).toBe(raw[index + 1]![0]);
      expect(line.accountName).toBe(raw[index + 1]![3]);
      const id = raw[index + 1]![1]!;
      groups.set(id, (groups.get(id) ?? 0n) + BigInt(line.debitMinor!) - BigInt(line.creditMinor!));
    });
    expect(groups.size).toBeGreaterThan(100);
    expect([...groups.values()].every((balance) => balance === 0n)).toBe(true);
  });

  it("keeps the October selected settlements in October", () => {
    const expected = JSON.parse(fixture("expected/expected-results.json"));
    const transactions = normalizeTransactions(parseCsvRows(fixture("03-october-update/bank-transactions.csv")), "1999-01");
    expect(transactions).toHaveLength(3);
    expect(transactions.every((t) => t.date === "2026-10")).toBe(true);
    expect(transactions.reduce((sum, t) => sum + cents(t.amount) * (t.direction === "receipt" ? 1 : -1), 0)).toBe(expected.octoberSelectedEventsOnly.netBankMovement);
  });
});
