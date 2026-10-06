import { cashFlag } from "./cash-flag";
import type { JournalStatements } from "./statements";
import type { TrialBalance } from "./ledger";
import type { AccountBalanceReconciliation } from "./account-reconciliation";

export type ReconciliationSourceRow = { id: string; period: string | null; amount: string | null; currency: string | null; status: string };
export type ReconciliationCashEvent = { id: string; sourceRowId: string | null; isActual: string };
export type ReconciliationJournalLine = { id: string; sourceRowId: string | null; currency: string; debitMinor: string; creditMinor: string; statementLine: string | null };
export type ReconciliationCashStatement = { sourceId: string; sourceName: string; accountIdentifier?: string | null; chartAccountId?: string | null; currency: string | null; endingBalance: string | null };
export type CashStatementTie = { currency: string; journalCashMinor: string; statementCashMinor: string; differenceMinor: string; sourceIds: string[]; accountIdentifier?: string | null; status: "tied" | "mismatch" | "invalid_statement_amount" | "missing_statement" | "unmapped_statement" };

export type LedgerReconciliation = {
  period: string;
  verificationStatus: "verified" | "unverified";
  summary: { approvedSourceRows: number; actualCashEvents: number; postedJournalLines: number; sourceRowsMissingActual: number; sourceRowsMissingJournal: number; amountMismatches: number; sourceUnlinkedActuals: number; unapprovedSourcePostings: number };
  sourceRows: { sourceRowId: string; status: "reconciled" | "missing_actual" | "missing_journal" | "amount_mismatch" | "currency_mismatch" | "invalid_amount"; sourceMinor?: string; journalCashMinor?: string; journalLineIds: string[] }[];
  controls: { trialBalanceBalanced: boolean; statementBalances: Record<string, boolean>; cashToStatement: CashStatementTie[]; reasons: string[] };
};

export type JournalAuthorityDecision = { eligible: boolean; blockers: string[]; requiredNextStep: "review_and_promote" | "resolve_controls" };

function minor(amount: string | null) {
  const match = amount?.trim().replace(/[$,\s]/g, "").replace(/^\((.+)\)$/, "-$1").match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  return match ? (match[1] === "-" ? -1n : 1n) * (BigInt(match[2]!) * 100n + BigInt((match[3] ?? "").padEnd(2, "0"))) : undefined;
}

/**
 * Reconciles a month without inventing matches: an approved source row must
 * produce an actual cash event and a posted cash line of the same magnitude.
 * It deliberately reports—not masks—incomplete or unlinked source data.
 */
export function reconcileLedgerMonth(input: { period: string; sourceRows: ReconciliationSourceRow[]; cashEvents: ReconciliationCashEvent[]; journalLines: ReconciliationJournalLine[]; trialBalance: TrialBalance; statements: JournalStatements; cashStatements?: ReconciliationCashStatement[] }): LedgerReconciliation {
  const actualByRow = new Map<string, ReconciliationCashEvent[]>();
  for (const event of input.cashEvents) if (event.sourceRowId) actualByRow.set(event.sourceRowId, [...(actualByRow.get(event.sourceRowId) ?? []), event]);
  const linesByRow = new Map<string, ReconciliationJournalLine[]>();
  for (const line of input.journalLines) if (line.sourceRowId) linesByRow.set(line.sourceRowId, [...(linesByRow.get(line.sourceRowId) ?? []), line]);
  const approvedRows = input.sourceRows.filter((row) => row.period === input.period && row.status === "approved");
  const sourceRows = approvedRows.map((row) => {
    const events = actualByRow.get(row.id) ?? [];
    if (!events.some((event) => event.isActual === "Y")) return { sourceRowId: row.id, status: "missing_actual" as const, journalLineIds: [] };
    const lines = linesByRow.get(row.id) ?? [];
    if (!lines.length) return { sourceRowId: row.id, status: "missing_journal" as const, journalLineIds: [] };
    const expected = minor(row.amount);
    if (expected === undefined) return { sourceRowId: row.id, status: "invalid_amount" as const, journalLineIds: lines.map((line) => line.id) };
    const allCashLines = lines.filter((line) => line.statementLine === "cash");
    if (row.currency && allCashLines.some((line) => line.currency !== row.currency)) return { sourceRowId: row.id, status: "currency_mismatch" as const, sourceMinor: expected.toString(), journalLineIds: lines.map((line) => line.id) };
    const cashLines = allCashLines.filter((line) => !row.currency || line.currency === row.currency);
    const cashAmount = cashLines.reduce((sum, line) => sum + (BigInt(line.debitMinor) >= BigInt(line.creditMinor) ? BigInt(line.debitMinor) - BigInt(line.creditMinor) : BigInt(line.creditMinor) - BigInt(line.debitMinor)), 0n);
    if (cashAmount !== expected) return { sourceRowId: row.id, status: "amount_mismatch" as const, sourceMinor: expected.toString(), journalCashMinor: cashAmount.toString(), journalLineIds: lines.map((line) => line.id) };
    return { sourceRowId: row.id, status: "reconciled" as const, sourceMinor: expected.toString(), journalCashMinor: cashAmount.toString(), journalLineIds: lines.map((line) => line.id) };
  });
  const statementBalances = Object.fromEntries(input.statements.byCurrency.map((statement) => [statement.currency, statement.balanceSheet.balanced]));
  const unmappedStatements: CashStatementTie[] = [];
  for (const statement of input.cashStatements ?? []) {
    const currency = statement.currency ?? "USD"; const parsed = minor(statement.endingBalance);
    if (!statement.chartAccountId) { unmappedStatements.push({ currency, journalCashMinor: "0", statementCashMinor: parsed?.toString() ?? "0", differenceMinor: "0", sourceIds: [statement.sourceId], ...(statement.accountIdentifier ? { accountIdentifier: statement.accountIdentifier } : {}), status: "unmapped_statement" }); continue; }
  }
  const journalCashByAccount = new Map<string, { accountId: string; accountName: string; currency: string; amount: bigint }>();
  for (const line of input.trialBalance.lines.filter((line) => cashFlag(line, () => /\bcash\b/i.test(`${line.statementLine ?? ""} ${line.accountName}`)))) { const key = `${line.accountId}:${line.currency}`; const current = journalCashByAccount.get(key) ?? { accountId: line.accountId, accountName: line.accountName, currency: line.currency, amount: 0n }; current.amount += BigInt(line.netMinor); journalCashByAccount.set(key, current); }
  const statementByAccount = new Map<string, { currency: string; accountId: string; amount: bigint; sourceIds: string[]; invalid: boolean }>();
  for (const statement of input.cashStatements ?? []) { if (!statement.chartAccountId) continue; const currency = statement.currency ?? "USD"; const key = `${statement.chartAccountId}:${currency}`; const current = statementByAccount.get(key) ?? { currency, accountId: statement.chartAccountId, amount: 0n, sourceIds: [], invalid: false }; const parsed = minor(statement.endingBalance); current.sourceIds.push(statement.sourceId); current.invalid ||= parsed === undefined; if (parsed !== undefined) current.amount += parsed; statementByAccount.set(key, current); }
  const accountKeys = new Set([...journalCashByAccount.keys(), ...statementByAccount.keys()]);
  const cashToStatement: CashStatementTie[] = [...[...accountKeys].sort().map((key) => { const journal = journalCashByAccount.get(key); const statement = statementByAccount.get(key); const journalCash = journal?.amount ?? 0n; const currency = journal?.currency ?? statement!.currency; if (!statement) return { currency, journalCashMinor: journalCash.toString(), statementCashMinor: "0", differenceMinor: journalCash.toString(), sourceIds: [], ...(journal ? { accountIdentifier: journal.accountId } : {}), status: "missing_statement" as const }; if (statement.invalid) return { currency, journalCashMinor: journalCash.toString(), statementCashMinor: statement.amount.toString(), differenceMinor: (journalCash - statement.amount).toString(), sourceIds: statement.sourceIds, accountIdentifier: statement.accountId, status: "invalid_statement_amount" as const }; const difference = journalCash - statement.amount; return { currency, journalCashMinor: journalCash.toString(), statementCashMinor: statement.amount.toString(), differenceMinor: difference.toString(), sourceIds: statement.sourceIds, accountIdentifier: statement.accountId, status: difference === 0n ? "tied" as const : "mismatch" as const }; }), ...unmappedStatements];
  const sourceUnlinkedActuals = input.cashEvents.filter((event) => event.isActual === "Y" && !event.sourceRowId).length;
  const approvedIds = new Set(approvedRows.map((row) => row.id));
  const unapprovedSourcePostings = input.journalLines.filter((line) => line.sourceRowId && !approvedIds.has(line.sourceRowId)).length;
  const reasons = [
    ...(!input.trialBalance.balanced ? ["Trial balance is not balanced."] : []),
    ...Object.entries(statementBalances).filter(([, balanced]) => !balanced).map(([currency]) => `${currency} balance sheet does not balance.`),
    ...(sourceRows.some((row) => row.status === "missing_actual") ? ["Approved source rows are missing actual cash events."] : []),
    ...(sourceRows.some((row) => row.status === "missing_journal") ? ["Approved source rows are missing posted journal lines."] : []),
    ...(sourceRows.some((row) => row.status === "amount_mismatch" || row.status === "currency_mismatch" || row.status === "invalid_amount") ? ["Source-row cash amounts do not agree with journal cash lines."] : []),
    ...(sourceUnlinkedActuals ? ["Actual cash events without source-row lineage remain."] : []),
    ...(unapprovedSourcePostings ? ["Posted journal lines reference unapproved source rows."] : []),
    ...(input.cashStatements && cashToStatement.some((control) => control.status === "missing_statement") ? ["Posted cash has no approved bank-statement ending balance for comparison."] : []),
    ...(cashToStatement.some((control) => control.status === "unmapped_statement") ? ["An approved bank statement account is not mapped to a chart cash account."] : []),
    ...(cashToStatement.some((control) => control.status === "mismatch" || control.status === "invalid_statement_amount") ? ["Journal ending cash does not tie to approved bank-statement ending cash."] : []),
  ];
  return { period: input.period, verificationStatus: reasons.length ? "unverified" : "verified", summary: { approvedSourceRows: approvedRows.length, actualCashEvents: input.cashEvents.filter((event) => event.isActual === "Y").length, postedJournalLines: input.journalLines.length, sourceRowsMissingActual: sourceRows.filter((row) => row.status === "missing_actual").length, sourceRowsMissingJournal: sourceRows.filter((row) => row.status === "missing_journal").length, amountMismatches: sourceRows.filter((row) => row.status === "amount_mismatch" || row.status === "currency_mismatch" || row.status === "invalid_amount").length, sourceUnlinkedActuals, unapprovedSourcePostings }, sourceRows, controls: { trialBalanceBalanced: input.trialBalance.balanced, statementBalances, cashToStatement, reasons } };
}

/** A fresh report may be eligible for CFO promotion; it never changes report mode itself. */
export function evaluateJournalAuthority(report: LedgerReconciliation, accountBalances: AccountBalanceReconciliation[] = []): JournalAuthorityDecision {
  const blockers = [
    ...report.controls.reasons,
    ...(report.summary.approvedSourceRows === 0 ? ["No approved source rows cover this period."] : []),
    ...(report.summary.postedJournalLines === 0 ? ["No posted journal lines cover this period."] : []),
    ...(accountBalances.some((account) => account.status !== "reconciled") ? ["Account balances have unresolved statement reconciliation exceptions."] : []),
  ];
  return { eligible: blockers.length === 0, blockers, requiredNextStep: blockers.length ? "resolve_controls" : "review_and_promote" };
}
