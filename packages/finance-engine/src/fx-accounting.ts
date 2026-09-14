import { buildJournalStatements } from "./statements";
import type { PostedJournalLine } from "./ledger";
import { convertMinorAtFxRate, selectApprovedFxRate, type FxRateObservation, type FxRateType } from "./fx-rates";

export type FxTranslationPolicy = {
  presentationCurrency: string;
  incomeRateType: Extract<FxRateType, "average" | "spot">;
  monetaryRateType: Extract<FxRateType, "closing" | "spot">;
  equityRateType: Extract<FxRateType, "historical" | "spot">;
  ctaAccount: { id: string; code: string; name: string };
};

const periodEnd = (period: string) => {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year!, month!, 0)).toISOString().slice(0, 10);
};
const rateTypeFor = (line: PostedJournalLine, policy: FxTranslationPolicy): FxRateType => {
  const section = line.statementSection ?? line.accountType;
  if (section === "revenue" || section === "expense") return policy.incomeRateType;
  if (section === "equity") return policy.equityRateType;
  return policy.monetaryRateType;
};
const rateDateFor = (line: PostedJournalLine, period: string, rateType: FxRateType) => rateType === "spot" ? line.postingDate ?? periodEnd(period) : periodEnd(period);

/**
 * Presentation translation is a deterministic reporting overlay. It never
 * mutates an entity's functional-currency books. Each converted line names its
 * rate, and a derived CTA equity line makes the translated balance sheet tie.
 */
export function translateJournalLines(input: { lines: PostedJournalLine[]; period: string; rates: FxRateObservation[]; policy: FxTranslationPolicy }) {
  const translated: PostedJournalLine[] = [];
  const selections: Array<{ lineId: string; rateId: string; rateType: FxRateType }> = [];
  const reasons: string[] = [];
  for (const line of input.lines.filter((candidate) => candidate.period <= input.period)) {
    const rateType = rateTypeFor(line, input.policy);
    const selection = selectApprovedFxRate(input.rates, { fromCurrency: line.currency, toCurrency: input.policy.presentationCurrency, rateType, asOfDate: rateDateFor(line, input.period, rateType) });
    const debit = convertMinorAtFxRate(line.debitMinor, selection); const credit = convertMinorAtFxRate(line.creditMinor, selection);
    if (debit.status !== "ready" || credit.status !== "ready") {
      reasons.push(...("reasons" in debit ? debit.reasons : "reasons" in credit ? credit.reasons : ["FX conversion failed."]));
      continue;
    }
    translated.push({ ...line, id: `translation:${line.id}`, currency: input.policy.presentationCurrency, debitMinor: debit.convertedMinor, creditMinor: credit.convertedMinor, fxRateId: debit.rateId, basis: "translation", provenance: { ...line.provenance, sourceLocation: `${line.provenance?.sourceLocation ?? ""}${line.provenance?.sourceLocation ? "; " : ""}FX rate ${debit.rateId} (${rateType})` } });
    selections.push({ lineId: line.id, rateId: debit.rateId, rateType });
  }
  if (reasons.length) return { status: "blocked" as const, reasons: [...new Set(reasons)], lines: [], selections };
  const beforeCta = buildJournalStatements(translated, input.period, undefined, { basis: "all" }).byCurrency.find((statement) => statement.currency === input.policy.presentationCurrency);
  const difference = BigInt(beforeCta?.balanceSheet.differenceMinor ?? "0");
  if (difference !== 0n) translated.push({ id: `translation:cta:${input.period}`, entryId: `translation:cta:${input.period}`, basis: "translation", accountId: input.policy.ctaAccount.id, accountCode: input.policy.ctaAccount.code, accountName: input.policy.ctaAccount.name, accountType: "equity", normalBalance: "credit", statementSection: "equity", statementLine: "Cumulative translation adjustment", currency: input.policy.presentationCurrency, debitMinor: difference < 0n ? (-difference).toString() : "0", creditMinor: difference > 0n ? difference.toString() : "0", period: input.period, provenance: { sourceLocation: "Derived presentation-translation reserve." } });
  const statements = buildJournalStatements(translated, input.period, undefined, { basis: "all" });
  const statement = statements.byCurrency.find((candidate) => candidate.currency === input.policy.presentationCurrency);
  return { status: statement?.balanceSheet.balanced ? "ready" as const : "blocked" as const, reasons: statement?.balanceSheet.balanced ? [] : ["Translated balance sheet does not balance after CTA."], lines: translated, selections, ctaMinor: difference.toString(), statements };
}

/** Re-measure a single foreign monetary balance in an entity's functional currency. */
export function remeasureForeignMonetaryBalance(input: { account: Pick<PostedJournalLine, "accountId" | "accountCode" | "accountName" | "entityId" | "currency">; transactionCurrency: string; nativeNetMinor: string; currentFunctionalNetMinor: string; period: string; rates: FxRateObservation[]; fxGainLossAccount: { id: string; code: string; name: string } }) {
  const selection = selectApprovedFxRate(input.rates, { fromCurrency: input.transactionCurrency, toCurrency: input.account.currency, rateType: "closing", asOfDate: periodEnd(input.period) });
  const converted = convertMinorAtFxRate(input.nativeNetMinor, selection);
  if (converted.status !== "ready") return { status: "blocked" as const, reasons: converted.reasons };
  const delta = BigInt(converted.convertedMinor) - BigInt(input.currentFunctionalNetMinor);
  if (delta === 0n) return { status: "ready" as const, adjustment: null, rateId: converted.rateId };
  const amount = (delta < 0n ? -delta : delta).toString();
  const debit = delta > 0n ? amount : "0"; const credit = delta < 0n ? amount : "0";
  return { status: "ready" as const, rateId: converted.rateId, adjustment: [
    { accountId: input.account.accountId, accountCode: input.account.accountCode, accountName: input.account.accountName, entityId: input.account.entityId, currency: input.account.currency, debitMinor: debit, creditMinor: credit },
    { accountId: input.fxGainLossAccount.id, accountCode: input.fxGainLossAccount.code, accountName: input.fxGainLossAccount.name, entityId: input.account.entityId, currency: input.account.currency, debitMinor: credit, creditMinor: debit },
  ] };
}
