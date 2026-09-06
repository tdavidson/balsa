import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeTransactions, parseCsvRows, transactionExternalKey } from "../packages/ingestion/src/index.ts";
import { buildMonthlyCash } from "../packages/finance-engine/src/index.ts";

const fixture = (name: string) => readFileSync(resolve(new URL("../fixtures/company-zero/", import.meta.url).pathname, name), "utf8");
const transactions = normalizeTransactions(parseCsvRows(fixture("bank-transactions.csv")), "2026-09");
if (transactions.length !== 4) throw new Error(`Expected 4 transactions, got ${transactions.length}`);
if (new Set(transactions.map(transactionExternalKey)).size !== transactions.length) throw new Error("Transaction identity is not stable");
const notes = fixture("finance-notes.md");
const openingCash = Number(notes.match(/opening cash[^$]*\$([\d,]+)/i)?.[1]?.replace(/,/g, ""));
if (openingCash !== 25000) throw new Error(`Expected opening cash 25000, got ${openingCash}`);
const events = transactions.map((transaction) => ({ month: transaction.date, amount: transaction.amount, kind: transaction.direction }));
const result = buildMonthlyCash(openingCash, events);
const september = result.find((month) => month.month === "2026-09");
const october = result.find((month) => month.month === "2026-10");
if (september?.actualNet !== 0 || october?.endingCash !== 43600) throw new Error(`Unexpected Company Zero result: ${JSON.stringify({ september, october })}`);
console.log("Company Zero smoke passed: 4 multi-month transactions, stable identities, opening cash, and roll-forward verified.");
