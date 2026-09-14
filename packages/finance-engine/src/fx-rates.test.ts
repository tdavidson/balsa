import { describe, expect, it } from "vitest";
import { convertMinorAtFxRate, measureForeignCurrencyJournalEntry, selectApprovedFxRate, type FxRateObservation } from "./fx-rates";

const rate = (overrides: Partial<FxRateObservation> = {}): FxRateObservation => ({ id: "rate-1", rateSetId: "set-1", rateSetStatus: "approved", fromCurrency: "USD", toCurrency: "CAD", rateType: "closing", effectiveDate: "2026-09-30", numerator: "137", denominator: "100", ...overrides });

describe("selectApprovedFxRate", () => {
  it("uses the latest approved direct rate and calculates with rational half-up rounding", () => {
    const selection = selectApprovedFxRate([rate({ id: "older", effectiveDate: "2026-09-01", numerator: "135" }), rate()], { fromCurrency: "USD", toCurrency: "CAD", rateType: "closing", asOfDate: "2026-09-30", maxAgeDays: 3 });
    expect(selection).toMatchObject({ status: "ready", rate: { id: "rate-1" } });
    expect(convertMinorAtFxRate("101", selection)).toMatchObject({ status: "ready", convertedMinor: "138" });
  });

  it("names missing, stale, and conflicting rates instead of choosing one", () => {
    expect(selectApprovedFxRate([], { fromCurrency: "USD", toCurrency: "CAD", rateType: "closing", asOfDate: "2026-09-30" }).status).toBe("missing");
    expect(selectApprovedFxRate([rate({ effectiveDate: "2026-09-01" })], { fromCurrency: "USD", toCurrency: "CAD", rateType: "closing", asOfDate: "2026-09-30", maxAgeDays: 5 }).status).toBe("stale");
    expect(selectApprovedFxRate([rate(), rate({ id: "rate-2", numerator: "138" })], { fromCurrency: "USD", toCurrency: "CAD", rateType: "closing", asOfDate: "2026-09-30" }).status).toBe("conflicting");
  });

  it("retains native values and names a cent-level FX rounding adjustment", () => {
    const selection = selectApprovedFxRate([rate({ numerator: "50", denominator: "100" })], { fromCurrency: "USD", toCurrency: "CAD", rateType: "closing", asOfDate: "2026-09-30" });
    const measured = measureForeignCurrencyJournalEntry({ transactionCurrency: "USD", functionalCurrency: "CAD", rate: selection, lines: [{ id: "debit-one", debitMinor: "1", creditMinor: "0" }, { id: "debit-two", debitMinor: "1", creditMinor: "0" }, { id: "credit", debitMinor: "0", creditMinor: "2" }] });
    expect(measured).toMatchObject({ status: "ready", roundingAdjustment: { debitMinor: "0", creditMinor: "1" } });
    expect(measured.status === "ready" && measured.lines).toEqual(expect.arrayContaining([expect.objectContaining({ transactionCurrency: "USD", transactionDebitMinor: "1", currency: "CAD", debitMinor: "1", fxRateId: "rate-1" })]));
  });
});
