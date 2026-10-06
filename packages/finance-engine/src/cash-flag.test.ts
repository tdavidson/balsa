import { describe, expect, it } from "vitest";
import { endingCashMinor } from "./cash";
import { resolveAccountIsCash } from "./cash-flag";
import { summarizeActualCash } from "./forecast-actuals";
import type { PostedJournalLine } from "./ledger";
import { suggestStandardLine } from "./standard-layout";
import { buildJournalStatements } from "./statements";

const line = (id: string, entryId: string, accountId: string, accountName: string, accountType: string, debitMinor: string, creditMinor: string, isCash?: boolean): PostedJournalLine => ({ id, entryId, accountId, accountCode: accountId, accountName, accountType, normalBalance: accountType === "asset" || accountType === "expense" ? "debit" : "credit", currency: "USD", debitMinor, creditMinor, period: "2026-09", basis: "actual", ...(isCash !== undefined ? { isCash } : {}) });
const journal = (checkingIsCash: boolean | undefined, pettyIsCash: boolean | undefined) => [
  line("1", "a", "1000", "Operating checking", "asset", "50000", "0", checkingIsCash), line("2", "a", "3000", "Common stock", "equity", "0", "50000"),
  line("3", "b", "1050", "Petty cash", "asset", "2000", "0", pettyIsCash), line("4", "b", "3000", "Common stock", "equity", "0", "2000"),
  line("5", "c", "6000", "Rent", "expense", "1000", "0"), line("6", "c", "1000", "Operating checking", "asset", "0", "1000", checkingIsCash),
];

describe("resolveAccountIsCash", () => {
  it("treats a bank-linked asset as cash by default, and lets the user's choice win", () => {
    expect(resolveAccountIsCash({ accountType: "asset", name: "Operating checking", bankLinked: true })).toBe(true);
    expect(resolveAccountIsCash({ accountType: "asset", name: "Operating checking", bankLinked: false })).toBe(false);
    expect(resolveAccountIsCash({ accountType: "asset", name: "Petty cash", bankLinked: false })).toBe(true);
    expect(resolveAccountIsCash({ accountType: "asset", name: "Petty cash", bankLinked: false, cashTreatment: "not_cash" })).toBe(false);
    expect(resolveAccountIsCash({ accountType: "asset", name: "Brokerage sweep", bankLinked: false, cashTreatment: "cash" })).toBe(true);
    expect(resolveAccountIsCash({ accountType: "liability", name: "Credit card", bankLinked: true, cashTreatment: "cash" })).toBe(false);
  });
});

describe("resolved cash flag", () => {
  it("decides cash in the statements, the cash flow and the forecast's actual cash alike", () => {
    const flagged = journal(true, false);
    const usd = buildJournalStatements(flagged, "2026-09").byCurrency[0]!;
    expect(endingCashMinor(usd)).toBe(49000n);
    expect(usd.cashFlow?.netChangeMinor).toBe("49000");
    expect(summarizeActualCash(flagged, "USD", "2026-09").months.at(-1)?.endingCashMinor).toBe("49000");
  });

  it("falls back to the name rule for lines without a flag", () => {
    const legacy = journal(undefined, undefined);
    expect(endingCashMinor(buildJournalStatements(legacy, "2026-09").byCurrency[0]!)).toBe(2000n);
    expect(summarizeActualCash(legacy, "USD", "2026-09").months.at(-1)?.endingCashMinor).toBe("2000");
  });

  it("puts the Standard Cash line where the ledger finds cash", () => {
    const base = { accountId: "x", accountCode: "x", accountType: "asset", normalBalance: "debit" as const };
    expect(suggestStandardLine({ ...base, accountName: "Operating checking", isCash: true }).line).toBe("cash");
    expect(suggestStandardLine({ ...base, accountName: "Petty cash", isCash: false }).line).not.toBe("cash");
  });
});
