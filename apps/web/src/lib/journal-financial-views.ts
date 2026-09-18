import "server-only";
import { endingCashMinor as computeEndingCashMinor, type CurrencyJournalStatements, JournalStatementSelection } from "@nevermodel/finance-engine";
import { loadJournalReport } from "@/lib/journal-ledger";
import { loadLatestForecast, type LatestForecast } from "@/lib/forecast-read";

const nextMonth = (month: string) => { const [year, number] = month.split("-").map(Number); const date = new Date(Date.UTC(year!, number!, 1)); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; };
const monthsInRange = (start: string, end: string) => { const months: string[] = []; for (let month = start; month <= end; month = nextMonth(month)) months.push(month); return months; };
const major = (value: bigint) => Number(value) / 100;
const totalMinor = (lines: { amountMinor: string }[]) => lines.reduce((sum, line) => sum + BigInt(line.amountMinor), 0n);
const lineMap = (lines: { key: string; label: string; amountMinor: string }[]) => Object.fromEntries(lines.map((line) => [line.key || line.label, major(BigInt(line.amountMinor))]));

export type JournalFinancialMonth = {
  month: string; status: "history" | "open"; verification: string; basis: "actual" | "forecast" | "scenario";
  forecast: { openingCash: number; endingCash: number; receipts: number; spending: number; net: number; actualReceipts: number; actualSpending: number; actualNet: number; hasCashBalance: boolean; cashFlow: { operating: number; investing: number; financing: number; netChange: number; openingCash: number; endingCash: number; ties: boolean } };
  pnl: { revenue: number; expenses: number; operatingIncome: number; revenueByCategory: Record<string, number>; byCategory: Record<string, number> };
  balanceSheet: { assets: number; liabilities: number; equity: number; retainedEarnings: number; check: number; balanced: boolean; balances: Record<string, number> };
  statements: CurrencyJournalStatements | null;
};

/** Convert entry-graph statements into the dashboard's display units, without redoing any accounting math. */
export async function loadJournalFinancialMonths(input: { companyId: string; start: string; end: string; currency: string; entityId?: string; selection: JournalStatementSelection; asOfPeriod?: string; view: "actual" | "projected" | "scenario"; forecast?: LatestForecast | null }): Promise<JournalFinancialMonth[]> {
  // Projected/scenario views read the same forecast for every month; load it once here
  // rather than let each loadJournalReport call load it again.
  const forecast = input.forecast !== undefined ? input.forecast : (input.view === "projected" || input.view === "scenario") ? await loadLatestForecast(input.companyId) : undefined;
  let priorCashMinor = 0n;
  const rows: JournalFinancialMonth[] = [];
  for (const month of monthsInRange(input.start, input.end)) {
    const { statements } = await loadJournalReport(input.companyId, month, input.entityId, input.selection, { ...(forecast !== undefined ? { forecast } : {}) });
    const statement = statements.byCurrency.find((candidate) => candidate.currency === input.currency) ?? null;
    if (!statement) {
      const priorCash = major(priorCashMinor);
      rows.push({ month, status: month <= (input.asOfPeriod ?? month) ? "history" : "open", verification: input.view === "actual" ? "unverified" : "unverified_projection", basis: month <= (input.asOfPeriod ?? month) ? "actual" : input.view === "scenario" ? "scenario" : "forecast", forecast: { openingCash: priorCash, endingCash: priorCash, receipts: 0, spending: 0, net: 0, actualReceipts: 0, actualSpending: 0, actualNet: 0, hasCashBalance: false, cashFlow: { operating: 0, investing: 0, financing: 0, netChange: 0, openingCash: priorCash, endingCash: priorCash, ties: true } }, pnl: { revenue: 0, expenses: 0, operatingIncome: 0, revenueByCategory: {}, byCategory: {} }, balanceSheet: { assets: 0, liabilities: 0, equity: 0, retainedEarnings: 0, check: 0, balanced: true, balances: {} }, statements: null });
      continue;
    }
    const endingCashMinor = computeEndingCashMinor(statement); const flow = statement.cashFlow; const revenueMinor = totalMinor(statement.incomeStatement.revenue); const expensesMinor = totalMinor(statement.incomeStatement.expenses); const actual = month <= (input.asOfPeriod ?? month); const openingCash = major(priorCashMinor); const endingCash = major(endingCashMinor);
    rows.push({ month, status: actual ? "history" : "open", verification: input.view === "actual" ? "unverified_until_reconciled" : "unverified_projection", basis: actual ? "actual" : input.view === "scenario" ? "scenario" : "forecast", forecast: { openingCash, endingCash, receipts: flow ? major(BigInt(flow.cashReceiptsMinor)) : 0, spending: flow ? major(BigInt(flow.cashSpendingMinor)) : 0, net: flow ? major(BigInt(flow.netChangeMinor)) : 0, actualReceipts: actual && flow ? major(BigInt(flow.cashReceiptsMinor)) : 0, actualSpending: actual && flow ? major(BigInt(flow.cashSpendingMinor)) : 0, actualNet: actual && flow ? major(BigInt(flow.netChangeMinor)) : 0, hasCashBalance: true, cashFlow: { operating: flow ? major(BigInt(flow.operatingMinor)) : 0, investing: flow ? major(BigInt(flow.investingMinor)) : 0, financing: flow ? major(BigInt(flow.financingMinor)) : 0, netChange: flow ? major(BigInt(flow.netChangeMinor)) : 0, openingCash, endingCash, ties: flow?.ties ?? true } }, pnl: { revenue: major(revenueMinor), expenses: major(expensesMinor), operatingIncome: major(revenueMinor - expensesMinor), revenueByCategory: lineMap(statement.incomeStatement.revenue), byCategory: lineMap(statement.incomeStatement.expenses) }, balanceSheet: { assets: major(BigInt(statement.balanceSheet.totalAssetsMinor)), liabilities: major(totalMinor(statement.balanceSheet.liabilities)), equity: major(totalMinor(statement.balanceSheet.equity)), retainedEarnings: major(BigInt(statement.balanceSheet.retainedEarningsMinor)), check: major(BigInt(statement.balanceSheet.differenceMinor)), balanced: statement.balanceSheet.balanced, balances: { ...lineMap(statement.balanceSheet.assets), ...lineMap(statement.balanceSheet.liabilities), ...lineMap(statement.balanceSheet.equity), retained_earnings: major(BigInt(statement.balanceSheet.retainedEarningsMinor)) } }, statements: statement });
    priorCashMinor = endingCashMinor;
  }
  return rows;
}
