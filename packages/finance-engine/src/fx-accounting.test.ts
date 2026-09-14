import { describe, expect, it } from "vitest";
import { remeasureForeignMonetaryBalance, translateJournalLines } from "./fx-accounting";
import type { PostedJournalLine } from "./ledger";

const rate = (id: string, rateType: "average" | "closing" | "historical", numerator: string) => ({ id, rateSetId: "approved", rateSetStatus: "approved" as const, fromCurrency: "EUR", toCurrency: "USD", rateType, effectiveDate: "2026-09-30", numerator, denominator: "100", factId: `${id}-fact` });
const line = (id: string, accountType: string, debitMinor: string, creditMinor: string): PostedJournalLine => ({ id, entryId: "entry", accountId: id, accountCode: id, accountName: id, accountType, normalBalance: accountType === "asset" ? "debit" : "credit", currency: "EUR", debitMinor, creditMinor, period: "2026-09", provenance: { factId: `${id}-fact` } });

describe("FX accounting", () => {
  it("translates journal lines and derives a CTA that balances the presentation statement", () => {
    const result = translateJournalLines({ lines: [line("cash", "asset", "10000", "0"), line("capital", "equity", "0", "10000")], period: "2026-09", rates: [rate("closing", "closing", "110"), rate("historical", "historical", "100")], policy: { presentationCurrency: "USD", incomeRateType: "average", monetaryRateType: "closing", equityRateType: "historical", ctaAccount: { id: "cta", code: "3999", name: "CTA" } } });
    expect(result.status).toBe("ready");
    expect(result.ctaMinor).toBe("1000");
    expect(result.lines.some((candidate) => candidate.accountId === "cta" && candidate.creditMinor === "1000")).toBe(true);
  });

  it("blocks a translated output when its approved rate evidence is missing", () => {
    const result = translateJournalLines({ lines: [line("cash", "asset", "10000", "0")], period: "2026-09", rates: [], policy: { presentationCurrency: "USD", incomeRateType: "average", monetaryRateType: "closing", equityRateType: "historical", ctaAccount: { id: "cta", code: "3999", name: "CTA" } } });
    expect(result.status).toBe("blocked");
  });

  it("uses the transaction date for a spot translation rather than month end", () => {
    const result = translateJournalLines({ lines: [{ ...line("revenue", "revenue", "0", "10000"), postingDate: "2026-09-10" }], period: "2026-09", rates: [{ ...rate("spot", "average", "110"), rateType: "spot" as const, effectiveDate: "2026-09-10" }], policy: { presentationCurrency: "USD", incomeRateType: "spot", monetaryRateType: "closing", equityRateType: "historical", ctaAccount: { id: "cta", code: "3999", name: "CTA" } } });
    expect(result.status).toBe("ready");
    expect(result.selections[0]).toMatchObject({ rateId: "spot", rateType: "spot" });
  });

  it("creates a balanced closing-rate remeasurement adjustment", () => {
    const result = remeasureForeignMonetaryBalance({ account: { accountId: "receivable", accountCode: "1200", accountName: "Receivable", entityId: "entity", currency: "USD" }, transactionCurrency: "EUR", nativeNetMinor: "10000", currentFunctionalNetMinor: "10500", period: "2026-09", rates: [rate("closing", "closing", "110")], fxGainLossAccount: { id: "fx", code: "7100", name: "FX gain/loss" } });
    expect(result.status).toBe("ready");
    expect(result.adjustment).toEqual(expect.arrayContaining([expect.objectContaining({ accountId: "receivable", debitMinor: "500", creditMinor: "0" }), expect.objectContaining({ accountId: "fx", debitMinor: "0", creditMinor: "500" })]));
  });
});
