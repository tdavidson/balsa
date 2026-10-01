import { summarizeActualCash, type ForecastAccount, type ForecastDriver, type ForecastRunInput, type PostedJournalLine } from "@balsa/finance-engine";

const accounts: ForecastAccount[] = [
  { accountId: "cash", accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" },
  { accountId: "equity", accountCode: "3000", accountName: "Owner capital", accountType: "equity", normalBalance: "credit" },
  { accountId: "revenue", accountCode: "4000", accountName: "Revenue", accountType: "revenue", normalBalance: "credit" },
  { accountId: "payroll", accountCode: "6000", accountName: "Payroll", accountType: "expense", normalBalance: "debit" },
];
const posted = (id: string, accountId: string, debitMinor: string, creditMinor: string, period: string): PostedJournalLine => ({ ...accounts.find((account) => account.accountId === accountId)!, id, entryId: id.split(":")[0]!, basis: "actual", currency: "USD", debitMinor, creditMinor, period });

// Cash: 1,200,000 in May; 100,000 of payroll each month June–August → 900,000 at the August as-of.
const history: PostedJournalLine[] = [
  posted("capital:0", "cash", "1200000", "0", "2026-05"), posted("capital:1", "equity", "0", "1200000", "2026-05"),
  ...["2026-06", "2026-07", "2026-08"].flatMap((month) => [posted(`pay-${month}:0`, "payroll", "100000", "0", month), posted(`pay-${month}:1`, "cash", "0", "100000", month)]),
];
const templates: ForecastRunInput["templates"] = [
  { id: "spend", itemType: "obligation", direction: "spend", debitAccountId: "payroll", creditAccountId: "cash" },
  { id: "receipt", itemType: "agreement", direction: "receipt", debitAccountId: "cash", creditAccountId: "revenue" },
];

export const fixturePayroll: ForecastDriver = { id: "payroll", label: "Payroll", itemType: "obligation", direction: "spend", amountMinor: "100000", cadence: "monthly", effectiveFrom: "2026-09", evidenceId: "ev-payroll" };

/** 900,000 cash at the 2026-08 as-of and 100,000 a month of payroll: nine funded months, cash-out 2027-06. */
export function fixtureBaseInput(drivers: ForecastDriver[] = [fixturePayroll]): ForecastRunInput {
  return { actuals: summarizeActualCash(history, "USD", "2026-08"), drivers, templates, accounts, currency: "USD", asOfMonth: "2026-08", horizonMonths: 24, minimumCashMinor: "0" };
}
