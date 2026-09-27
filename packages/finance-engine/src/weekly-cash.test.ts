import { describe, expect, it } from "vitest";
import { buildWeeklyCash, type WeeklyCashInput } from "./weekly-cash";
import type { PostedJournalLine } from "./ledger";
const cash = (id: string, date: string, debitMinor: string, creditMinor: string, basis: "actual" | "forecast" = "forecast"): PostedJournalLine => ({ id, entryId: id, accountId: "cash", accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit", currency: "USD", debitMinor, creditMinor, postingDate: date, period: date.slice(0, 7), basis });
const base: WeeklyCashInput = { throughDate: "2026-09-25", currency: "USD", actualLines: [cash("opening", "2026-09-01", "10000", "0", "actual")], projectedLines: [cash("payroll", "2026-09-27", "0", "12000"), cash("receipt", "2026-10-01", "15000", "0")], reviewedEntryIds: ["payroll", "receipt"], limitations: [], minimumCashMinor: "0" };
describe("dated weekly cash", () => {
  it("exposes a within-week shortfall even when ending cash is positive", () => {
    const output = buildWeeklyCash(base); expect(output.weeks[0]).toMatchObject({ openingCashMinor: "10000", endingCashMinor: "13000", minimumDatedCashMinor: "-2000", firstBreachDate: "2026-09-27" }); expect(output.status).toBe("reviewed_dates");
    expect(output.weeks).toHaveLength(13); expect(output.inputs).toEqual(base);
  });
  it("keeps overdue cash separate and marks unreviewed schedule dates", () => {
    const output = buildWeeklyCash({ ...base, projectedLines: [...base.projectedLines, cash("late", "2026-09-20", "30000", "0")], reviewedEntryIds: [] });
    expect(output.unplacedNetMinor).toBe("30000"); expect(output.weeks[0]?.endingCashMinor).toBe("13000"); expect(output.status).toBe("provisional"); expect(output.reasons).toHaveLength(2);
  });
  it("nets transfers per journal and respects the actual cutoff", () => {
    const a = cash("transfer-a", "2026-10-02", "10000", "0"); const b = { ...cash("transfer-b", "2026-10-02", "0", "10000"), accountId: "cash-b", accountCode: "1010" };
    const output = buildWeeklyCash({ ...base, actualLines: [...base.actualLines, cash("future", "2026-10-02", "999999", "0", "actual")], projectedLines: [{ ...a, entryId: "transfer" }, { ...b, entryId: "transfer" }] });
    expect(output.openingCashMinor).toBe("10000"); expect(output.weeks.every((week) => week.receiptsMinor === "0" && week.spendingMinor === "0")).toBe(true);
  });
});
