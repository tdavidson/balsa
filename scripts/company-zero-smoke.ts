import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeTransactions, parseCsvRows, transactionExternalKey } from "../packages/ingestion/src/index.ts";
import { runEngine, type ActualEvent, type ScheduleItem } from "../packages/finance-engine/src/index.ts";

const fixture = (name: string) => readFileSync(resolve(new URL("../fixtures/company-zero/", import.meta.url).pathname, name), "utf8");
const transactions = normalizeTransactions(parseCsvRows(fixture("bank-transactions.csv")), "2026-09");
if (transactions.length !== 4) throw new Error(`Expected 4 transactions, got ${transactions.length}`);
if (new Set(transactions.map(transactionExternalKey)).size !== transactions.length) throw new Error("Transaction identity is not stable");
const notes = fixture("finance-notes.md");
const openingCash = Number(notes.match(/opening cash[^$]*\$([\d,]+)/i)?.[1]?.replace(/,/g, ""));
if (openingCash !== 25000) throw new Error(`Expected opening cash 25000, got ${openingCash}`);

// The finance notes describe two recurring items; the bank file settles September and October.
const items: ScheduleItem[] = [
  { id: "subscriptions", label: "Customer subscription receipts", direction: "receipt", amount: 12500, category: "other_revenue", cadence: "monthly", effectiveFrom: "2026-09", accountingTreatment: "cash", basis: "contractual", provenance: { sourceName: "finance-notes.md" } },
  { id: "contractor", label: "Contractor obligation", direction: "spend", amount: 3200, category: "contractor", cadence: "monthly", effectiveFrom: "2026-09", accountingTreatment: "cash", basis: "contractual", provenance: { sourceName: "finance-notes.md" } },
];
const actuals: ActualEvent[] = transactions.map((transaction, index) => ({ id: `t${index}`, month: transaction.date, ...(transaction.postedDate ? { date: transaction.postedDate } : {}), description: transaction.description, amount: transaction.amount, direction: transaction.direction, activity: "operating", category: transaction.direction === "receipt" ? "other_revenue" : "contractor", provenance: { sourceName: "bank-transactions.csv" } }));
const result = runEngine({ openingCash: { month: "2026-09", amount: openingCash }, asOfMonth: "2026-11", closedMonths: ["2026-09"], horizon: { start: "2026-09", end: "2026-12" }, items, actuals });
const [september, october, november, december] = result.months;
const check = (condition: boolean, message: string) => { if (!condition) throw new Error(`${message}: ${JSON.stringify(result.months.map((month) => ({ month: month.month, status: month.status, receipts: month.receipts, spending: month.spending, endingCash: month.endingCash, variance: month.variance })))}`); };
check(result.matches.length === 4, "Every bank transaction should settle an expected event");
check(september?.status === "closed" && september.endingCash === 34300 && september.variance === 0, "September closes on actuals with no variance");
check(october?.status === "history" && october.endingCash === 43600 && october.outstanding.payables.length === 0, "October rolls from September on actuals only");
check(november?.status === "open" && november.receipts === 12500 && november.spending === 3200 && november.endingCash === 52900, "November projects the unsettled expectations");
check(december?.endingCash === 62200 && december.pnl.revenue === 12500 && december.pnl.byCategory.contractor === 3200, "December carries the forecast P&L");
console.log("Company Zero smoke passed: 4 transactions matched to expectations, closed month on actuals, open months projected, no double counting.");
