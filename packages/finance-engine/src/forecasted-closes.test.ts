import { describe, expect, it } from "vitest";
import type { PostedJournalLine } from "./ledger";
import { buildForecastedCloses } from "./forecasted-closes";

const line = (entry: string, month: string, date: string, accountId: string, debitMinor: string, creditMinor: string, memo = "Cloud hosting 123"): PostedJournalLine => ({ id: `${entry}:${accountId}`, entryId: entry, basis: "actual", accountId, accountCode: accountId, accountName: accountId === "cash" ? "Cash" : "Hosting", accountType: accountId === "cash" ? "asset" : "expense", normalBalance: "debit", currency: "USD", debitMinor, creditMinor, period: month, postingDate: date, memo });
const event = (entry: string, month: string, day: string, amount: string, memo?: string) => [line(entry, month, `${month}-${day}`, "hosting", amount, "0", memo), line(entry, month, `${month}-${day}`, "cash", "0", amount, memo)];

describe("buildForecastedCloses", () => {
  it("forecasts a stable recurring close into the open month", () => {
    const result = buildForecastedCloses([...event("j1", "2026-06", "14", "10000"), ...event("j2", "2026-07", "15", "10200"), ...event("j3", "2026-08", "16", "9800")], "2026-09");
    expect(result.matches).toEqual([]);
    expect(result.projectedLines).toHaveLength(2);
    expect(result.projectedLines.find((line) => line.debitMinor === "10000")).toMatchObject({ basis: "forecast", entrySource: "forecasted_close", period: "2026-09", postingDate: "2026-09-15" });
  });

  it("removes the forecast when the current actual arrives, even at a different final amount", () => {
    const history = [...event("j1", "2026-06", "14", "10000"), ...event("j2", "2026-07", "15", "10000"), ...event("j3", "2026-08", "16", "10000")];
    const result = buildForecastedCloses([...history, ...event("actual", "2026-09", "13", "10500")], "2026-09");
    expect(result.projectedLines).toEqual([]);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.actualEntryId).toBe("actual");
  });

  it("does not infer sparse, volatile, or description-free activity", () => {
    const sparse = [...event("j1", "2026-06", "14", "10000"), ...event("j3", "2026-08", "16", "10000")];
    const volatile = [...event("v1", "2026-06", "14", "10000", "Software"), ...event("v2", "2026-07", "15", "10000", "Software"), ...event("v3", "2026-08", "16", "20000", "Software")];
    const blank = [...event("b1", "2026-06", "14", "10000", ""), ...event("b2", "2026-07", "15", "10000", ""), ...event("b3", "2026-08", "16", "10000", "")];
    expect(buildForecastedCloses([...sparse, ...volatile, ...blank], "2026-09").projectedLines).toEqual([]);
  });
});
