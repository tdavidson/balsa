import { describe, expect, it } from "vitest";
import { endingCashMinor } from "./cash";
import { buildJournalStatements } from "./statements";
import type { PostedJournalLine } from "./ledger";

const line = (id: string, accountId: string, accountName: string, accountType: string, normalBalance: "debit" | "credit", debitMinor: string, creditMinor: string): PostedJournalLine => ({ id, entryId: "e1", accountId, accountCode: accountId, accountName, accountType, normalBalance, currency: "USD", debitMinor, creditMinor, period: "2026-09" });

describe("endingCashMinor", () => {
  it("counts only cash asset lines", () => {
    const statement = buildJournalStatements([
      line("a", "1000", "Cash", "asset", "debit", "5000", "0"),
      line("b", "1200", "Accounts receivable", "asset", "debit", "700", "0"),
      line("c", "3000", "Capital", "equity", "credit", "0", "5700"),
    ], "2026-09").byCurrency[0];
    expect(endingCashMinor(statement)).toBe(5000n);
    expect(endingCashMinor(undefined)).toBe(0n);
  });
});
