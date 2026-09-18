import { describe, expect, it } from "vitest";
import { summarizeActualCash } from "./forecast-actuals";
import { buildJournalStatements } from "./statements";
import { endingCashMinor } from "./cash";
import type { PostedJournalLine } from "./ledger";

const base = { currency: "USD", normalBalance: "debit" as const };
const line = (id: string, entryId: string, accountId: string, accountCode: string, accountName: string, accountType: string, debitMinor: string, creditMinor: string, period: string, extra: Partial<PostedJournalLine> = {}): PostedJournalLine => ({ ...base, id, entryId, accountId, accountCode, accountName, accountType, debitMinor, creditMinor, period, ...extra });

const ledger: PostedJournalLine[] = [
  line("a1", "e1", "cash", "1000", "Cash", "asset", "100000", "0", "2026-05", { statementLine: "Cash" }),
  line("a2", "e1", "eq", "3000", "Capital", "equity", "0", "100000", "2026-05"),
  line("b1", "e2", "exp", "6000", "Payroll", "expense", "20000", "0", "2026-06"),
  line("b2", "e2", "cash", "1000", "Cash", "asset", "0", "20000", "2026-06", { statementLine: "Cash" }),
  // transfer between two cash groups nets to zero cash flow
  line("c1", "e3", "petty", "1020", "Petty cash", "asset", "5000", "0", "2026-07"),
  line("c2", "e3", "cash", "1000", "Cash", "asset", "0", "5000", "2026-07", { statementLine: "Cash" }),
  // contra asset named cash but without statementSection is excluded from balance cash
  line("d1", "e4", "contra", "1500", "Cash reserve contra", "contra", "0", "700", "2026-07"),
  line("d2", "e4", "exp", "6000", "Payroll", "expense", "700", "0", "2026-07"),
  // period close entries count in cash flow
  line("f1", "e5", "cash", "1000", "Cash", "asset", "0", "300", "2026-08", { statementLine: "Cash", entrySource: "period_close" }),
  line("f2", "e5", "eq", "3000", "Capital", "equity", "300", "0", "2026-08", { entrySource: "period_close" }),
  // excluded: plan basis, other currency, after as-of
  line("g1", "e6", "cash", "1000", "Cash", "asset", "999", "0", "2026-08", { statementLine: "Cash", basis: "plan" }),
  line("h1", "e7", "cash", "1000", "Cash", "asset", "999", "0", "2026-08", { statementLine: "Cash", currency: "EUR" }),
  line("i1", "e8", "cash", "1000", "Cash", "asset", "999", "0", "2026-09", { statementLine: "Cash" }),
];

describe("summarizeActualCash", () => {
  it("matches statement-based cash, receipts, and spending for each trailing month", () => {
    const summary = summarizeActualCash(ledger, "USD", "2026-08");
    expect(summary.months.map((month) => month.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
    const reported = ledger.filter((entry) => (entry.basis ?? "actual") === "actual" && entry.period <= "2026-08");
    for (const month of summary.months) {
      const statement = buildJournalStatements(reported, month.month, undefined, { basis: "all" }).byCurrency.find((candidate) => candidate.currency === "USD");
      expect(month.endingCashMinor).toBe(endingCashMinor(statement).toString());
      expect(month.receiptsMinor).toBe(statement?.cashFlow?.cashReceiptsMinor ?? "0");
      expect(month.spendingMinor).toBe(statement?.cashFlow?.cashSpendingMinor ?? "0");
    }
    expect(summary.months[0]!.openingCashMinor).toBe("100000");
    expect(summary.months[2]!.endingCashMinor).toBe("79700");
  });

  it("is independent of line order", () => {
    expect(summarizeActualCash([...ledger].reverse(), "USD", "2026-08")).toEqual(summarizeActualCash(ledger, "USD", "2026-08"));
  });

  it("records which balance groups are cash", () => {
    expect(summarizeActualCash(ledger, "USD", "2026-08").cashGroups).toEqual([["1020", true], ["Cash", true]]);
  });
});
