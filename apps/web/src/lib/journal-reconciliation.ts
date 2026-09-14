import "server-only";
import { and, eq, inArray, or } from "drizzle-orm";
import { cashEvents, chartAccounts, evidence, factRecords, getDatabase, journalEntries, journalLines, sourceRowMappings, sourceRows, sources } from "@finance/database";
import { evaluateJournalAuthority, reconcileAccountBalances, reconcileLedgerMonth } from "@nevermodel/finance-engine";
import { loadJournalStatements, loadTrialBalance } from "@/lib/journal-ledger";

/**
 * One deterministic source for journal authority, account reconciliation, and
 * calculation-graph controls. Read APIs must not reimplement these joins.
 */
export async function loadJournalReconciliation(companyId: string, period: string) {
  const db = getDatabase();
  const [events, lines, trialBalance, statements, statementRows, mappings, cashStatements, bankAccounts] = await Promise.all([
    db.select({ id: cashEvents.id, sourceRowId: cashEvents.sourceRowId, isActual: cashEvents.isActual }).from(cashEvents).where(and(eq(cashEvents.companyId, companyId), eq(cashEvents.month, period))),
    db.select({ id: journalLines.id, sourceRowId: journalLines.sourceRowId, currency: journalLines.currency, debitMinor: journalLines.debitMinor, creditMinor: journalLines.creditMinor, statementLine: chartAccounts.statementLine }).from(journalLines).innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id)).innerJoin(chartAccounts, eq(journalLines.accountId, chartAccounts.id)).where(and(eq(journalLines.companyId, companyId), eq(journalEntries.companyId, companyId), eq(journalEntries.period, period), eq(journalEntries.status, "posted"))),
    loadTrialBalance(companyId, period),
    loadJournalStatements(companyId, period),
    db.select({ sourceRowId: sourceRows.id, factId: sourceRows.factId, label: sourceRows.description, amount: sourceRows.amount, currency: sourceRows.currency, status: sourceRows.status, factStatus: factRecords.status }).from(sourceRows).leftJoin(factRecords, eq(sourceRows.factId, factRecords.id)).where(and(eq(sourceRows.companyId, companyId), eq(sourceRows.period, period), eq(sourceRows.rowType, "balance"))),
    db.select({ sourceRowId: sourceRowMappings.sourceRowId, chartAccountId: sourceRowMappings.chartAccountId, status: sourceRowMappings.status, mappingType: sourceRowMappings.mappingType }).from(sourceRowMappings).where(and(eq(sourceRowMappings.companyId, companyId), eq(sourceRowMappings.status, "approved"))),
    db.select({ sourceId: evidence.sourceId, sourceName: evidence.sourceName, accountIdentifier: evidence.accountIdentifier, currency: evidence.currency, endingBalance: evidence.endingBalance, sourceType: sources.type, sourceMetadata: sources.metadata }).from(evidence).leftJoin(sources, eq(evidence.sourceId, sources.id)).where(and(eq(evidence.companyId, companyId), eq(evidence.status, "approved"), eq(evidence.reportingMonth, period))),
    db.select({ id: chartAccounts.id, bankAccountIdentifier: chartAccounts.bankAccountIdentifier }).from(chartAccounts).where(and(eq(chartAccounts.companyId, companyId), eq(chartAccounts.active, "Y"))),
  ]);
  const referencedRowIds = lines.map((line) => line.sourceRowId).filter((id): id is string => Boolean(id));
  const rows = await db.select({ id: sourceRows.id, period: sourceRows.period, amount: sourceRows.amount, currency: sourceRows.currency, status: sourceRows.status }).from(sourceRows).where(and(eq(sourceRows.companyId, companyId), ...(referencedRowIds.length ? [or(eq(sourceRows.period, period), inArray(sourceRows.id, referencedRowIds))] : [eq(sourceRows.period, period)])));
  const approvedMappings = mappings.filter((mapping): mapping is { sourceRowId: string; chartAccountId: string; status: string; mappingType: string } => Boolean(mapping.sourceRowId && mapping.chartAccountId));
  const bankAccountByIdentifier = new Map(bankAccounts.filter((account) => account.bankAccountIdentifier).map((account) => [account.bankAccountIdentifier!, account.id]));
  const approvedCashStatements = cashStatements.filter((statement) => statement.sourceId && statement.endingBalance && (statement.sourceType === "bank_statement" || (statement.sourceMetadata ?? "").includes("bank_statement"))).map((statement) => ({ sourceId: statement.sourceId!, sourceName: statement.sourceName, ...(statement.accountIdentifier ? { accountIdentifier: statement.accountIdentifier, chartAccountId: bankAccountByIdentifier.get(statement.accountIdentifier) ?? null } : {}), currency: statement.currency, endingBalance: statement.endingBalance }));
  const report = reconcileLedgerMonth({ period, sourceRows: rows, cashEvents: events, journalLines: lines, trialBalance, statements, cashStatements: approvedCashStatements });
  const accountBalances = reconcileAccountBalances(trialBalance.lines, statementRows, approvedMappings);
  return { trialBalance, statements, report, accountBalances, authority: evaluateJournalAuthority(report, accountBalances) };
}
