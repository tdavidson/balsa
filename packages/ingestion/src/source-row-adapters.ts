import type { TransactionRow } from "./index";
import type { SourceKind } from "./source-classification";

export type SourceRowType = "bank_transaction" | "brokerage_transaction" | "quickbooks_transaction" | "general_ledger_line" | "balance" | "income_statement_line" | "agreement_term" | "invoice" | "unclassified";
export type NormalizedSourceRow = { sourceKey: string; rowType: SourceRowType; period?: string; transactionDate?: string; description: string; amount?: string; currency?: string; direction?: "receipt" | "spend"; accountName?: string; debitMinor?: string; creditMinor?: string; sourceLocation?: string; raw: Record<string, unknown> };

function money(value: string) {
  const normalized = value.trim().replace(/[$,\s]/g, "").replace(/^\((.+)\)$/, "-$1").replace(/(CR|CREDIT)$/i, "").replace(/(DR|DEBIT)$/i, "-");
  const match = normalized.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return undefined;
  const minor = BigInt(match[2]!) * 100n + BigInt((match[3] ?? "").padEnd(2, "0"));
  return { signedMinor: match[1] === "-" ? -minor : minor, amount: `${match[1] === "-" ? "-" : ""}${match[2]}.${(match[3] ?? "").padEnd(2, "0")}` };
}

const transactionType = (kind: SourceKind): SourceRowType => kind === "brokerage_statement" ? "brokerage_transaction" : kind === "general_ledger" ? "general_ledger_line" : kind === "quickbooks_transactions" ? "quickbooks_transaction" : "bank_transaction";

/** Adapt parsed cash activity into a typed, source-preserving staging row. */
export function adaptTransactionRows(kind: SourceKind, transactions: TransactionRow[], currency?: string): NormalizedSourceRow[] {
  return transactions.map((transaction, index) => ({ sourceKey: `${transaction.postedDate ?? transaction.date}:${transaction.description}:${transaction.amount.toFixed(2)}:${transaction.direction}:${index + 1}`, rowType: transactionType(kind), period: transaction.date, ...(transaction.postedDate ? { transactionDate: transaction.postedDate } : {}), description: transaction.description, amount: transaction.amount.toFixed(2), ...(currency ? { currency } : {}), direction: transaction.direction, ...(transaction.sourceLocation ? { sourceLocation: transaction.sourceLocation } : {}), raw: transaction }));
}

/** Adapt QuickBooks-style ledger detail without promoting account totals to cash events. */
export function adaptGeneralLedgerRows(rows: string[][], fallbackMonth: string, currency?: string): NormalizedSourceRow[] {
  if (rows.length < 2) return [];
  const headers = rows[0]!.map((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  const column = (pattern: RegExp) => headers.findIndex((header) => pattern.test(header));
  const dateIndex = column(/^(transaction |posted |posting |effective )?date$/); const accountIndex = column(/^(account|account name|gl account)$/); const debitIndex = column(/^(debit|debits|withdrawal|withdrawals|money out)$/); const creditIndex = column(/^(credit|credits|deposit|deposits|money in)$/); const descriptionIndex = column(/^(memo|description|transaction description|name|payee|details)$/);
  return rows.slice(1).flatMap((cells, index) => {
    const debit = debitIndex >= 0 ? money(cells[debitIndex] ?? "")?.signedMinor ?? 0n : 0n;
    const credit = creditIndex >= 0 ? money(cells[creditIndex] ?? "")?.signedMinor ?? 0n : 0n;
    if (!debit && !credit) return [];
    const rawDate = dateIndex >= 0 ? cells[dateIndex]?.trim() : undefined;
    const parsedDate = rawDate && !Number.isNaN(new Date(rawDate).getTime()) ? new Date(rawDate).toISOString().slice(0, 10) : undefined;
    const accountName = accountIndex >= 0 ? cells[accountIndex]?.trim() : undefined;
    const description = (descriptionIndex >= 0 ? cells[descriptionIndex]?.trim() : undefined) || accountName || "General ledger line";
    return [{ sourceKey: `row:${index + 2}`, rowType: "general_ledger_line" as const, period: parsedDate?.slice(0, 7) ?? fallbackMonth, ...(parsedDate ? { transactionDate: parsedDate } : {}), description, ...(currency ? { currency } : {}), ...(accountName ? { accountName } : {}), debitMinor: (debit < 0n ? -debit : debit).toString(), creditMinor: (credit < 0n ? -credit : credit).toString(), sourceLocation: `row:${index + 2}`, raw: Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] ?? ""])) }];
  });
}

/** Store statement, agreement, and invoice evidence as typed rows without treating it as cash. */
export function adaptStatementFacts(kind: SourceKind, facts: { label: string; value: string; accountingRole?: string; sourceLocation?: string }[], period?: string, currency?: string): NormalizedSourceRow[] {
  const rowType: SourceRowType = kind === "balance_sheet" ? "balance" : kind === "profit_and_loss" ? "income_statement_line" : kind === "agreement" ? "agreement_term" : "unclassified";
  return facts.map((fact, index) => {
    const parsed = money(fact.value.match(/\(?-?\$?[\d,]+(?:\.\d{1,2})?\)?/)?.[0] ?? "");
    return { sourceKey: `fact:${index + 1}:${fact.label}`, rowType, ...(period ? { period } : {}), description: fact.label, ...(parsed ? { amount: parsed.amount } : {}), ...(currency ? { currency } : {}), ...(fact.sourceLocation ? { sourceLocation: fact.sourceLocation } : {}), raw: fact };
  });
}
