import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { chartAccounts, getDatabase, journalLines, reportCategories } from "@finance/database";
import { buildStandardStatements, isStandardLineId, monthRange, resolveStandardMapping, rollupStandardByFiscalYear, standardMappingComplete, type JournalStatementSelection, type ReportCategory, type ResolvedStandardMapping, type StandardMappingAccount, type StandardPeriodColumn } from "@balsa/finance-engine";
import type { DbExecutor } from "@/lib/db-executor";
import { loadReportLines } from "@/lib/journal-ledger";
import type { LatestForecast } from "@/lib/forecast-read";

type ChartAccountRow = typeof chartAccounts.$inferSelect;

export function toStandardMappingAccount(row: ChartAccountRow): StandardMappingAccount {
  return {
    accountId: row.id, accountCode: row.code, accountName: row.name, accountType: row.accountType, normalBalance: row.normalBalance,
    ...(row.statementSection ? { statementSection: row.statementSection } : {}), ...(row.statementLine ? { statementLine: row.statementLine } : {}),
    ...(row.balanceTiming === "current" || row.balanceTiming === "noncurrent" ? { balanceTiming: row.balanceTiming } : {}),
    ...(row.cashFlowCategory === "operating" || row.cashFlowCategory === "investing" || row.cashFlowCategory === "financing" || row.cashFlowCategory === "none" ? { cashFlowCategory: row.cashFlowCategory } : {}),
    ...(row.workingCapitalCategory ? { workingCapitalCategory: row.workingCapitalCategory as NonNullable<StandardMappingAccount["workingCapitalCategory"]> } : {}),
    hasBankIdentifier: Boolean(row.bankAccountIdentifier),
    reportLine: row.reportLine && isStandardLineId(row.reportLine) ? row.reportLine : null,
    reportCategoryId: row.reportCategoryId,
  };
}

export const toReportCategory = (row: typeof reportCategories.$inferSelect): ReportCategory | null => isStandardLineId(row.line) ? { id: row.id, line: row.line, name: row.name, sortOrder: row.sortOrder } : null;

export type MappingSummary = { confirmed: number; suggested: number; fallback: number; unclassified: number; total: number; complete: boolean };
export const summarizeMapping = (resolved: ResolvedStandardMapping[]): MappingSummary => ({
  confirmed: resolved.filter((item) => item.status === "confirmed").length,
  suggested: resolved.filter((item) => item.status === "suggested").length,
  fallback: resolved.filter((item) => item.status === "fallback").length,
  unclassified: resolved.filter((item) => item.status === "unclassified").length,
  total: resolved.length,
  complete: resolved.length > 0 && standardMappingComplete(resolved),
});

/**
 * The company's chart with each account's resolved Standard line. "In use"
 * accounts decide whether the mapping is complete: every active account, plus
 * any inactive account that still carries posted lines.
 */
export async function loadStandardMapping(companyId: string, db: DbExecutor = getDatabase()) {
  const [rows, categoryRows] = await Promise.all([
    db.select().from(chartAccounts).where(eq(chartAccounts.companyId, companyId)),
    db.select().from(reportCategories).where(eq(reportCategories.companyId, companyId)),
  ]);
  const inactiveIds = rows.filter((row) => row.active !== "Y").map((row) => row.id);
  const usedInactive = inactiveIds.length ? new Set((await db.selectDistinct({ accountId: journalLines.accountId }).from(journalLines).where(and(eq(journalLines.companyId, companyId), inArray(journalLines.accountId, inactiveIds)))).map((row) => row.accountId)) : new Set<string>();
  const accounts = rows.sort((left, right) => left.code.localeCompare(right.code));
  const categories = categoryRows.map(toReportCategory).filter((category): category is ReportCategory => Boolean(category)).sort((left, right) => left.line.localeCompare(right.line) || left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
  const mappingAccounts = accounts.map(toStandardMappingAccount);
  const resolved = resolveStandardMapping(mappingAccounts, categories);
  const inUse = accounts.filter((row) => row.active === "Y" || usedInactive.has(row.id));
  return { rows: accounts, accounts: mappingAccounts, categories, resolved, inUseIds: new Set(inUse.map((row) => row.id)), summary: summarizeMapping(inUse.map((row) => resolved.get(row.id)!)) };
}

const fiscalYearEndMonth = (stored: string | null) => { const month = Number(stored); return Number.isInteger(month) && month >= 1 && month <= 12 ? month : 12; };

/**
 * Standard-layout statements for a range of months. Lines are loaded once for
 * the last month; each month is a selection of the same lines, exactly as the
 * ledger statements select them, so totals tie month by month.
 */
export async function loadStandardStatementMonths(input: { companyId: string; start: string; end: string; currency: string; entityId?: string; view: "actual" | "projected" | "scenario"; scenarioId?: string; asOfPeriod: string; forecast: LatestForecast | null; fiscalYearEnd: string | null }) {
  const mapping = await loadStandardMapping(input.companyId);
  const selection: JournalStatementSelection = { view: input.view, asOfPeriod: input.asOfPeriod, ...(input.scenarioId ? { scenarioId: input.scenarioId } : {}) };
  const report = await loadReportLines(input.companyId, input.end, selection, { forecast: input.forecast });
  const asOf = report.selection?.asOfPeriod ?? input.asOfPeriod;
  const columns: StandardPeriodColumn[] = monthRange(input.start, input.end).map((period) => {
    const built = buildStandardStatements(report.lines, period, { accounts: mapping.accounts, categories: mapping.categories, currency: input.currency, ...(input.entityId ? { entityId: input.entityId } : {}), ...(report.selection ? { selection: report.selection } : {}) });
    const basis = input.view === "actual" || period <= asOf ? "actual" : input.view === "scenario" ? "scenario" : "forecast";
    return { period, basis, statement: built.byCurrency.find((candidate) => candidate.currency === input.currency)! };
  });
  const fiscalEnd = fiscalYearEndMonth(input.fiscalYearEnd);
  return {
    asOfPeriod: asOf,
    fiscalYearEndMonth: fiscalEnd,
    months: columns,
    years: rollupStandardByFiscalYear(columns, fiscalEnd),
    mapping: mapping.summary,
    accounts: mapping.rows.map((row) => ({ id: row.id, code: row.code, name: row.name })),
  };
}
