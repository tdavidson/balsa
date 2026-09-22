import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeTransactions, parseCsvRows, transactionExternalKey } from "../packages/ingestion/src/index.ts";
import { buildForecastRun, summarizeActualCash, type ForecastAccount, type ForecastDriver, type ForecastEntryTemplate, type PostedJournalLine } from "../packages/finance-engine/src/index.ts";

const fixture = (name: string) => readFileSync(resolve(new URL("../fixtures/company-zero/", import.meta.url).pathname, name), "utf8");
const transactions = normalizeTransactions(parseCsvRows(fixture("bank-transactions.csv")), "2026-09");
if (transactions.length !== 4) throw new Error(`Expected 4 transactions, got ${transactions.length}`);
if (new Set(transactions.map(transactionExternalKey)).size !== transactions.length) throw new Error("Transaction identity is not stable");
const notes = fixture("finance-notes.md");
const openingCash = Number(notes.match(/opening cash[^$]*\$([\d,]+)/i)?.[1]?.replace(/,/g, ""));
if (openingCash !== 25000) throw new Error(`Expected opening cash 25000, got ${openingCash}`);

const accounts: ForecastAccount[] = [
  { accountId: "cash", accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" },
  { accountId: "opening-equity", accountCode: "3000", accountName: "Opening equity", accountType: "equity", normalBalance: "credit" },
  { accountId: "revenue", accountCode: "4000", accountName: "Subscription revenue", accountType: "revenue", normalBalance: "credit" },
  { accountId: "contractor", accountCode: "6000", accountName: "Contractor expense", accountType: "expense", normalBalance: "debit" },
];
const account = (id: string) => accounts.find((candidate) => candidate.accountId === id)!;
const line = (entryId: string, accountId: string, debitMinor: string, creditMinor: string, period: string, postingDate: string, memo: string, sourceLocation: string): PostedJournalLine => ({ ...account(accountId), id: `${entryId}:${accountId}`, entryId, entrySource: "company_zero_fixture", basis: "actual", currency: "USD", debitMinor, creditMinor, period, postingDate, memo, provenance: { sourceLocation } });

// Opening cash is the balance immediately before September activity. Every
// imported transaction becomes one balanced actual journal entry.
const openingMinor = String(openingCash * 100);
const actualLines: PostedJournalLine[] = [
  line("opening", "cash", openingMinor, "0", "2026-08", "2026-08-31", "Opening cash", "finance-notes.md"),
  line("opening", "opening-equity", "0", openingMinor, "2026-08", "2026-08-31", "Opening cash", "finance-notes.md"),
  ...transactions.flatMap((transaction) => {
    const key = transactionExternalKey(transaction);
    const amountMinor = String(Math.round(transaction.amount * 100));
    const date = transaction.postedDate ?? `${transaction.date}-01`;
    return transaction.direction === "receipt"
      ? [line(key, "cash", amountMinor, "0", transaction.date, date, transaction.description, transaction.sourceLocation ?? "bank-transactions.csv"), line(key, "revenue", "0", amountMinor, transaction.date, date, transaction.description, transaction.sourceLocation ?? "bank-transactions.csv")]
      : [line(key, "contractor", amountMinor, "0", transaction.date, date, transaction.description, transaction.sourceLocation ?? "bank-transactions.csv"), line(key, "cash", "0", amountMinor, transaction.date, date, transaction.description, transaction.sourceLocation ?? "bank-transactions.csv")];
  }),
];
const drivers: ForecastDriver[] = [
  { id: "subscriptions", label: "Customer subscription receipts", itemType: "agreement", direction: "receipt", category: "other_revenue", amountMinor: "1250000", cadence: "monthly", effectiveFrom: "2026-09", evidenceId: "finance-notes" },
  { id: "contractor", label: "Contractor obligation", itemType: "obligation", direction: "spend", category: "contractor", amountMinor: "320000", cadence: "monthly", effectiveFrom: "2026-09", evidenceId: "finance-notes" },
];
const templates: ForecastEntryTemplate[] = [
  { id: "subscription-template", itemType: "agreement", direction: "receipt", category: "other_revenue", debitAccountId: "cash", creditAccountId: "revenue" },
  { id: "contractor-template", itemType: "obligation", direction: "spend", category: "contractor", debitAccountId: "contractor", creditAccountId: "cash" },
];
const result = buildForecastRun({ actuals: summarizeActualCash(actualLines, "USD", "2026-10"), drivers, templates, accounts, currency: "USD", asOfMonth: "2026-10", horizonMonths: 2, minimumCashMinor: "0" });
const byMonth = new Map(result.months.map((month) => [month.month, month]));
const check = (condition: boolean, message: string) => { if (!condition) throw new Error(`${message}: ${JSON.stringify(result.months)}`); };
check(actualLines.length === 10, "Opening balance and four transactions should produce five balanced entries");
check(byMonth.get("2026-09")?.basis === "actual" && byMonth.get("2026-09")?.endingCashMinor === "3430000", "September should close on actuals at $34,300");
check(byMonth.get("2026-10")?.basis === "actual" && byMonth.get("2026-10")?.endingCashMinor === "4360000", "October should roll forward on actuals at $43,600");
check(byMonth.get("2026-11")?.receiptsMinor === "1250000" && byMonth.get("2026-11")?.spendingMinor === "320000" && byMonth.get("2026-11")?.endingCashMinor === "5290000", "November should project the recurring items once");
check(byMonth.get("2026-12")?.endingCashMinor === "6220000", "December should carry the forecast to $62,200");
check(result.projectedLines.every((projected) => projected.period > result.asOfMonth), "Forecast lines must not overlap posted actual months");
check(result.projectedLines.some((projected) => projected.period === "2026-12" && projected.accountId === "revenue" && projected.creditMinor === "1250000"), "December should carry forecast revenue");
check(result.projectedLines.some((projected) => projected.period === "2026-12" && projected.accountId === "contractor" && projected.debitMinor === "320000"), "December should carry forecast contractor expense");
console.log("Company Zero smoke passed: four imported transactions became balanced actual journals, actual months closed at $43,600, and recurring forecast entries began once in November.");
