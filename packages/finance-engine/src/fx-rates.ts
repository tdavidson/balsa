export type FxRateType = "spot" | "average" | "closing" | "historical";
export type FxRateStatus = "draft" | "approved" | "superseded" | "rejected";

/** A rational quote: `amount in fromCurrency × numerator / denominator = toCurrency`. */
export type FxRateObservation = {
  id: string;
  rateSetId: string;
  rateSetStatus: FxRateStatus;
  fromCurrency: string;
  toCurrency: string;
  rateType: FxRateType;
  effectiveDate: string;
  numerator: string;
  denominator: string;
  sourceId?: string;
  evidenceId?: string;
  factId?: string;
  sourceLocation?: string;
};

export type FxRateSelection = {
  status: "ready" | "missing" | "stale" | "conflicting";
  fromCurrency: string;
  toCurrency: string;
  rateType: FxRateType;
  asOfDate: string;
  rate?: FxRateObservation;
  reasons: string[];
};

const positiveInteger = (value: string) => /^(?:[1-9]\d*)$/.test(value);
const day = (value: string) => Date.parse(`${value}T00:00:00.000Z`);
const equivalent = (left: FxRateObservation, right: FxRateObservation) => BigInt(left.numerator) * BigInt(right.denominator) === BigInt(right.numerator) * BigInt(left.denominator);

/**
 * Selects one approved direct quote reproducibly. An inverse quote is never
 * silently inferred: quotation convention is an accounting policy decision.
 */
export function selectApprovedFxRate(rates: FxRateObservation[], query: { fromCurrency: string; toCurrency: string; rateType: FxRateType; asOfDate: string; maxAgeDays?: number }): FxRateSelection {
  const base = { fromCurrency: query.fromCurrency, toCurrency: query.toCurrency, rateType: query.rateType, asOfDate: query.asOfDate };
  if (query.fromCurrency === query.toCurrency) return { ...base, status: "ready", rate: { id: "identity", rateSetId: "identity", rateSetStatus: "approved", fromCurrency: query.fromCurrency, toCurrency: query.toCurrency, rateType: query.rateType, effectiveDate: query.asOfDate, numerator: "1", denominator: "1" }, reasons: [] };
  const candidates = rates.filter((rate) => rate.rateSetStatus === "approved" && rate.fromCurrency === query.fromCurrency && rate.toCurrency === query.toCurrency && rate.rateType === query.rateType && rate.effectiveDate <= query.asOfDate && positiveInteger(rate.numerator) && positiveInteger(rate.denominator));
  if (!candidates.length) return { ...base, status: "missing", reasons: [`No approved ${query.rateType} ${query.fromCurrency}/${query.toCurrency} rate is available on or before ${query.asOfDate}.`] };
  const latestDate = candidates.reduce((latest, rate) => rate.effectiveDate > latest ? rate.effectiveDate : latest, candidates[0]!.effectiveDate);
  const latest = candidates.filter((rate) => rate.effectiveDate === latestDate).sort((left, right) => left.id.localeCompare(right.id));
  if (latest.length > 1 && latest.some((rate) => !equivalent(rate, latest[0]!))) return { ...base, status: "conflicting", reasons: [`Multiple approved ${query.rateType} rates conflict for ${query.fromCurrency}/${query.toCurrency} on ${latestDate}.`] };
  const rate = latest[0]!;
  const age = Math.floor((day(query.asOfDate) - day(rate.effectiveDate)) / 86_400_000);
  if (query.maxAgeDays !== undefined && age > query.maxAgeDays) return { ...base, status: "stale", rate, reasons: [`The selected rate is ${age} days old; the policy maximum is ${query.maxAgeDays}.`] };
  return { ...base, status: "ready", rate, reasons: [] };
}

/** Converts integer minor units with explicit half-up rounding and no floating point arithmetic. */
export function convertMinorAtFxRate(amountMinor: string, selection: FxRateSelection) {
  if (selection.status !== "ready" || !selection.rate) return { status: "blocked" as const, reasons: selection.reasons };
  const amount = BigInt(amountMinor); const numerator = BigInt(selection.rate.numerator); const denominator = BigInt(selection.rate.denominator);
  const sign = amount < 0n ? -1n : 1n; const absolute = amount < 0n ? -amount : amount;
  const quotient = (absolute * numerator) / denominator; const remainder = (absolute * numerator) % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return { status: "ready" as const, convertedMinor: (sign * rounded).toString(), rateId: selection.rate.id, rateSetId: selection.rate.rateSetId, numerator: selection.rate.numerator, denominator: selection.rate.denominator };
}

export type NativeCurrencyJournalLine = { id: string; debitMinor: string; creditMinor: string };
export type FunctionalCurrencyJournalLine = NativeCurrencyJournalLine & { transactionCurrency: string; transactionDebitMinor: string; transactionCreditMinor: string; currency: string; fxRateId: string };

/**
 * Measures one balanced foreign-currency entry in its entity's functional
 * currency. Any cent-level difference is returned explicitly for a configured
 * FX-rounding account; this function never buries it in an operating line.
 */
export function measureForeignCurrencyJournalEntry(input: { transactionCurrency: string; functionalCurrency: string; lines: NativeCurrencyJournalLine[]; rate: FxRateSelection }) {
  const sourceDebit = input.lines.reduce((total, line) => total + BigInt(line.debitMinor), 0n);
  const sourceCredit = input.lines.reduce((total, line) => total + BigInt(line.creditMinor), 0n);
  if (sourceDebit !== sourceCredit) return { status: "blocked" as const, reasons: ["Transaction-currency journal entry is not balanced."] };
  if (input.rate.status !== "ready" || !input.rate.rate || input.rate.fromCurrency !== input.transactionCurrency || input.rate.toCurrency !== input.functionalCurrency) return { status: "blocked" as const, reasons: input.rate.reasons.length ? input.rate.reasons : ["Selected FX rate does not match the transaction and functional currencies."] };
  const lines: FunctionalCurrencyJournalLine[] = [];
  for (const line of input.lines) {
    const debit = convertMinorAtFxRate(line.debitMinor, input.rate); const credit = convertMinorAtFxRate(line.creditMinor, input.rate);
    if (debit.status !== "ready" || credit.status !== "ready") return { status: "blocked" as const, reasons: [...(debit.reasons ?? []), ...(credit.reasons ?? [])] };
    lines.push({ id: line.id, transactionCurrency: input.transactionCurrency, transactionDebitMinor: line.debitMinor, transactionCreditMinor: line.creditMinor, currency: input.functionalCurrency, debitMinor: debit.convertedMinor, creditMinor: credit.convertedMinor, fxRateId: debit.rateId });
  }
  const functionalDifference = lines.reduce((total, line) => total + BigInt(line.debitMinor) - BigInt(line.creditMinor), 0n);
  return {
    status: "ready" as const,
    lines,
    ...(functionalDifference === 0n ? {} : { roundingAdjustment: functionalDifference > 0n ? { debitMinor: "0", creditMinor: functionalDifference.toString() } : { debitMinor: (-functionalDifference).toString(), creditMinor: "0" } }),
  };
}
