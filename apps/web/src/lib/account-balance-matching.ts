import { parseFinancialAmount } from "./financial-events";

export type BalanceSource = {
  month?: string;
  kind?: string;
  sourceName: string;
  accountIdentifier?: string | null;
  accountEntityId?: string | null;
  endingBalance?: string | null;
  currency?: string | null;
  facts?: { label: string; value: string; accountingRole?: string }[];
};

export type AccountBalanceComparison = { month: string; statementBalance: number; bookBalance: number; difference: number; statementSources: string[]; bookSources: string[] };

function bookCashFacts(source: BalanceSource) {
  if (!['balance_sheet', 'general_ledger'].includes(source.kind ?? '')) return [];
  const seen = new Set<string>();
  return (source.facts ?? []).filter((fact) => {
    const isCash = /\bcash\b|checking|savings|bank\s+account/i.test(fact.label);
    const isBalance = fact.accountingRole === "ending_balance" || /ending|closing|balance/i.test(fact.label);
    const key = `${fact.label.toLowerCase()}|${fact.value}`;
    if (!isCash || !isBalance || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Compares account statements with the books without posting either source. */
export function compareStatementAndBookBalances(sources: BalanceSource[]): AccountBalanceComparison[] {
  const months = [...new Set(sources.flatMap((source) => source.month ? [source.month] : []))].sort();
  return months.flatMap((month) => {
    const monthly = sources.filter((source) => source.month === month);
    const statementRows = monthly.filter((source) => source.kind === "bank_statement" && parseFinancialAmount(source.endingBalance ?? "") !== undefined);
    const uniqueStatements = new Map<string, BalanceSource>();
    for (const source of statementRows) uniqueStatements.set(source.accountEntityId ?? source.accountIdentifier ?? source.sourceName, source);
    const currencies = new Set(monthly.map((source) => source.currency).filter(Boolean));
    if (currencies.size > 1) return [];
    const bookRows = monthly.flatMap((source) => {
      const facts = bookCashFacts(source);
      const aggregate = facts.find((fact) => /total\s+cash|cash\s+and\s+cash\s+equivalents/i.test(fact.label));
      return (aggregate ? [aggregate] : facts).map((fact) => ({ source, amount: parseFinancialAmount(fact.value) }));
    });
    if (!uniqueStatements.size || !bookRows.length) return [];
    const statementBalance = [...uniqueStatements.values()].reduce((sum, source) => sum + (parseFinancialAmount(source.endingBalance ?? "") ?? 0), 0);
    const bookBalance = bookRows.reduce((sum, row) => sum + (row.amount ?? 0), 0);
    return [{ month, statementBalance, bookBalance, difference: bookBalance - statementBalance, statementSources: [...new Set([...uniqueStatements.values()].map((source) => source.sourceName))], bookSources: [...new Set(bookRows.map((row) => row.source.sourceName))] }];
  });
}
