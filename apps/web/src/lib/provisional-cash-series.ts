import { parseFinancialAmount } from "./financial-events";

/**
 * A first look at cash before anything is approved: the ending balances that
 * extraction read from statements, summed by month. This is presentation of
 * extracted evidence, never a reported result. Each point says whether every
 * balance in it is approved, so the chart can draw unapproved months as
 * unverified. Once the journal engine reports cash, its series replaces this.
 */

export type ProvisionalSource = {
  id: string;
  sourceName: string;
  status: string;
  identityStatus: string;
  reportingMonth?: string | null;
  statementPeriodEnd?: string | null;
  accountIdentifier?: string | null;
  currency?: string | null;
  createdAt?: string;
  extraction: { facts: { label: string; value: string; accountingRole?: string; factStatus?: string; currency?: string | null }[] } | null;
};

export type ProvisionalCashPoint = { month: string; amount: number; accounts: number; verified: boolean; sources: string[] };
export type ProvisionalCashSeries = { points: ProvisionalCashPoint[]; excludedCurrencies: string[] };

const endingBalanceLabel = /\b(?:ending|closing)\b.*\bbalance\b|\bbalance\b.*\b(?:end|close)\b/i;

function isEndingBalance(fact: { label: string; accountingRole?: string }) {
  return fact.accountingRole === "ending_balance" || ((fact.accountingRole ?? "unknown") === "unknown" && endingBalanceLabel.test(fact.label));
}

export function provisionalCashSeries(sources: ProvisionalSource[], baseCurrency: string): ProvisionalCashSeries {
  // One balance per account per month: the most recently loaded statement wins.
  const latest = new Map<string, { month: string; amount: number; verified: boolean; sourceName: string; createdAt: string }>();
  const excluded = new Set<string>();
  for (const source of sources) {
    if (source.identityStatus === "rejected" || source.status === "rejected" || !source.extraction) continue;
    const month = source.reportingMonth ?? source.statementPeriodEnd?.slice(0, 7);
    if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) continue;
    const fact = source.extraction.facts.find((candidate) => isEndingBalance(candidate) && candidate.factStatus !== "rejected" && parseFinancialAmount(candidate.value) !== undefined);
    if (!fact) continue;
    const currency = (fact.currency ?? source.currency ?? baseCurrency).toUpperCase();
    if (currency !== baseCurrency.toUpperCase()) { excluded.add(currency); continue; }
    const account = source.accountIdentifier?.replace(/[^0-9A-Za-z]/g, "") || source.sourceName;
    const key = `${account}\u0000${month}`;
    const createdAt = source.createdAt ?? "";
    const current = latest.get(key);
    if (current && current.createdAt >= createdAt) continue;
    latest.set(key, { month, amount: parseFinancialAmount(fact.value)!, verified: source.status === "approved" && fact.factStatus === "treatment_approved", sourceName: source.sourceName, createdAt });
  }
  const byMonth = new Map<string, ProvisionalCashPoint>();
  for (const balance of latest.values()) {
    const point = byMonth.get(balance.month) ?? { month: balance.month, amount: 0, accounts: 0, verified: true, sources: [] };
    point.amount = Math.round((point.amount + balance.amount) * 100) / 100;
    point.accounts += 1;
    point.verified &&= balance.verified;
    point.sources.push(balance.sourceName);
    byMonth.set(balance.month, point);
  }
  return { points: [...byMonth.values()].sort((left, right) => left.month.localeCompare(right.month)), excludedCurrencies: [...excluded].sort() };
}
