import type { TrialBalanceLine } from "./ledger";

export type ApprovedStatementBalance = { sourceRowId: string; factId?: string | null; label: string | null; amount: string | null; currency: string | null; status: string; factStatus?: string | null };
export type ApprovedAccountMapping = { sourceRowId: string; chartAccountId: string; status: string; mappingType: string };
export type AccountBalanceReconciliation = { currency: string; key: string; accountIds: string[]; sourceRowIds: string[]; ledgerMinor: string; statementMinor: string; differenceMinor: string; status: "reconciled" | "mismatch" | "unmapped_statement" | "unmapped_ledger" | "invalid_statement_amount" };

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const minor = (value: string | null) => {
  const match = value?.trim().replace(/[$,\s]/g, "").replace(/^\((.+)\)$/, "-$1").match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  return match ? (match[1] === "-" ? -1n : 1n) * (BigInt(match[2]!) * 100n + BigInt((match[3] ?? "").padEnd(2, "0"))) : undefined;
};
const presented = (line: TrialBalanceLine) => {
  const section = line.accountType === "contra" ? line.statementSection : line.accountType;
  const net = BigInt(line.netMinor);
  return section === "asset" || section === "expense" ? net : section === "liability" || section === "equity" || section === "revenue" ? -net : line.normalBalance === "debit" ? net : -net;
};

/**
 * Exact-only account balance reconciliation. A label mismatch stays unmapped
 * until a company mapping is approved; this never uses fuzzy matching to make
 * a statement look reconciled.
 */
export function reconcileAccountBalances(lines: TrialBalanceLine[], statementBalances: ApprovedStatementBalance[], mappings: ApprovedAccountMapping[] = []): AccountBalanceReconciliation[] {
  const mappingByRow = new Map(mappings.filter((mapping) => mapping.status === "approved" && mapping.mappingType === "account_balance").map((mapping) => [mapping.sourceRowId, mapping.chartAccountId]));
  const ledger = new Map<string, { currency: string; key: string; amount: bigint; accountIds: string[] }>();
  for (const line of lines) {
    const key = normalize(line.statementLine ?? line.accountName);
    const groupKey = `${line.currency}:${key}`;
    const group = ledger.get(groupKey) ?? { currency: line.currency, key, amount: 0n, accountIds: [] };
    group.amount += presented(line); group.accountIds.push(line.accountId); ledger.set(groupKey, group);
  }
  const statements = new Map<string, { currency: string; key: string; amount?: bigint; sourceRowIds: string[]; invalid: boolean }>();
  for (const row of statementBalances.filter((row) => row.status === "approved" && (!row.factStatus || row.factStatus === "treatment_approved"))) {
    if (!row.label) continue;
    const mappedAccountId = mappingByRow.get(row.sourceRowId);
    const mappedLine = mappedAccountId ? lines.find((line) => line.accountId === mappedAccountId && line.currency === (row.currency ?? "USD")) : undefined;
    const key = mappedLine ? normalize(mappedLine.statementLine ?? mappedLine.accountName) : normalize(row.label); const currency = row.currency ?? "USD"; const groupKey = `${currency}:${key}`; const parsed = minor(row.amount);
    const group = statements.get(groupKey) ?? { currency, key, amount: 0n, sourceRowIds: [], invalid: false };
    group.sourceRowIds.push(row.sourceRowId); group.invalid ||= parsed === undefined; if (parsed !== undefined) group.amount = (group.amount ?? 0n) + parsed; statements.set(groupKey, group);
  }
  const keys = new Set([...ledger.keys(), ...statements.keys()]);
  return [...keys].sort().map((groupKey) => {
    const book = ledger.get(groupKey); const statement = statements.get(groupKey);
    if (!book) return { currency: statement!.currency, key: statement!.key, accountIds: [], sourceRowIds: statement!.sourceRowIds, ledgerMinor: "0", statementMinor: statement!.amount?.toString() ?? "0", differenceMinor: (-(statement!.amount ?? 0n)).toString(), status: statement!.invalid ? "invalid_statement_amount" as const : "unmapped_statement" as const };
    if (!statement) return { currency: book.currency, key: book.key, accountIds: book.accountIds, sourceRowIds: [], ledgerMinor: book.amount.toString(), statementMinor: "0", differenceMinor: book.amount.toString(), status: "unmapped_ledger" as const };
    const statementAmount = statement.amount ?? 0n; const difference = book.amount - statementAmount;
    return { currency: book.currency, key: book.key, accountIds: book.accountIds, sourceRowIds: statement.sourceRowIds, ledgerMinor: book.amount.toString(), statementMinor: statementAmount.toString(), differenceMinor: difference.toString(), status: statement.invalid ? "invalid_statement_amount" as const : difference === 0n ? "reconciled" as const : "mismatch" as const };
  });
}
