import "server-only";
import { and, eq, lte } from "drizzle-orm";
import { chartAccounts, getDatabase, journalBatches, journalEntries, journalLines } from "@finance/database";
import { buildJournalStatements, buildTrialBalance, selectJournalLinesForReporting, type PostedJournalLine } from "@nevermodel/finance-engine";
import type { DbExecutor } from "@/lib/db-executor";
import { entryBasisFromStored } from "@/lib/journal-basis";
import { loadLatestForecast } from "@/lib/forecast-read";

type Selection = Parameters<typeof buildJournalStatements>[3];

/**
 * Projected and scenario views read the derived forecast: its projected lines
 * are overlaid in memory and the view is anchored at the forecast's as-of month,
 * so every reader shows the same forecast the consequences were computed from.
 */
async function withDerivedForecast(companyId: string, lines: PostedJournalLine[], selection?: Selection): Promise<{ lines: PostedJournalLine[]; selection?: Selection }> {
  if (selection?.view !== "projected" && selection?.view !== "scenario") return selection ? { lines, selection } : { lines };
  const forecast = await loadLatestForecast(companyId);
  if (!forecast) return { lines, selection };
  return { lines: [...lines, ...forecast.run.projectedLines], selection: { ...selection, asOfPeriod: forecast.run.asOfMonth } };
}

/** Load immutable posted lines once for any read-only journal calculation. */
export async function loadPostedJournalLines(companyId: string, period: string, db: DbExecutor = getDatabase()): Promise<PostedJournalLine[]> {
  const rows = await db.select({ line: journalLines, entryPeriod: journalEntries.period, postingDate: journalEntries.postingDate, entryBasis: journalEntries.basis, scenarioId: journalEntries.scenarioId, entrySource: journalBatches.source, entryStatus: journalEntries.status, accountCode: chartAccounts.code, accountName: chartAccounts.name, accountType: chartAccounts.accountType, normalBalance: chartAccounts.normalBalance, statementSection: chartAccounts.statementSection, statementLine: chartAccounts.statementLine, balanceTiming: chartAccounts.balanceTiming, cashFlowCategory: chartAccounts.cashFlowCategory, workingCapitalCategory: chartAccounts.workingCapitalCategory }).from(journalLines).innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id)).innerJoin(journalBatches, eq(journalEntries.batchId, journalBatches.id)).innerJoin(chartAccounts, eq(journalLines.accountId, chartAccounts.id)).where(and(eq(journalLines.companyId, companyId), eq(journalEntries.companyId, companyId), eq(journalEntries.status, "posted"), lte(journalEntries.period, period)));
  return rows.map((row) => ({ id: row.line.id, entryId: row.line.entryId, ...(row.entrySource ? { entrySource: row.entrySource } : {}), ...(entryBasisFromStored(row.entryBasis) ? { basis: entryBasisFromStored(row.entryBasis)! } : {}), ...(row.scenarioId ? { scenarioId: row.scenarioId } : {}), accountId: row.line.accountId, accountCode: row.accountCode, accountName: row.accountName, accountType: row.accountType, normalBalance: row.normalBalance, ...(row.statementSection ? { statementSection: row.statementSection } : {}), ...(row.statementLine ? { statementLine: row.statementLine } : {}), ...(row.balanceTiming && ["current", "noncurrent"].includes(row.balanceTiming) ? { balanceTiming: row.balanceTiming as "current" | "noncurrent" } : {}), ...(row.cashFlowCategory && ["operating", "investing", "financing", "none"].includes(row.cashFlowCategory) ? { cashFlowCategory: row.cashFlowCategory as "operating" | "investing" | "financing" | "none" } : {}), ...(row.workingCapitalCategory && ["receivables", "payables", "deferred_revenue", "prepaids", "inventory", "other"].includes(row.workingCapitalCategory) ? { workingCapitalCategory: row.workingCapitalCategory as import("@nevermodel/finance-engine").WorkingCapitalCategory } : {}), ...(row.line.entityId ? { entityId: row.line.entityId } : {}), currency: row.line.currency, debitMinor: row.line.debitMinor, creditMinor: row.line.creditMinor, ...(row.line.transactionCurrency ? { transactionCurrency: row.line.transactionCurrency } : {}), ...(row.line.transactionDebitMinor !== null ? { transactionDebitMinor: row.line.transactionDebitMinor } : {}), ...(row.line.transactionCreditMinor !== null ? { transactionCreditMinor: row.line.transactionCreditMinor } : {}), ...(row.line.fxRateId ? { fxRateId: row.line.fxRateId } : {}), postingDate: row.postingDate, period: row.entryPeriod, provenance: { ...(row.line.sourceId ? { sourceId: row.line.sourceId } : {}), ...(row.line.factId ? { factId: row.line.factId } : {}), ...(row.line.decisionId ? { decisionId: row.line.decisionId } : {}), ...(row.line.approvalEventId ? { approvalEventId: row.line.approvalEventId } : {}), ...(row.line.sourceLocation ? { sourceLocation: row.line.sourceLocation } : {}) } }));
}

/** Read-only journal roll-up. Default selection is actual entries plus adjustments/eliminations. */
export async function loadTrialBalance(companyId: string, period: string, entityId?: string, selection?: Selection) {
  const view = await withDerivedForecast(companyId, await loadPostedJournalLines(companyId, period), selection);
  return buildTrialBalance(selectJournalLinesForReporting(view.lines, period, view.selection), period, entityId);
}

/** Journal-native statements are calculated only from selected posted entries. */
export async function loadJournalStatements(companyId: string, period: string, entityId?: string, selection?: Selection) {
  const view = await withDerivedForecast(companyId, await loadPostedJournalLines(companyId, period), selection);
  return buildJournalStatements(view.lines, period, entityId, view.selection);
}

/** One consistent trial balance + statement input for an entry-graph report. */
export async function loadJournalReport(companyId: string, period: string, entityId?: string, selection?: Selection) {
  const view = await withDerivedForecast(companyId, await loadPostedJournalLines(companyId, period), selection);
  const selected = selectJournalLinesForReporting(view.lines, period, view.selection);
  return { trialBalance: buildTrialBalance(selected, period, entityId), statements: buildJournalStatements(view.lines, period, entityId, view.selection) };
}
