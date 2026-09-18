import { test } from "vitest";
import { summarizeActualCash } from "./forecast-actuals";
import type { ForecastDriver, ForecastEntryTemplate } from "./forecast-projections";
import { buildForecastRun, type ForecastAccount } from "./forecast-run";
import { buildForecastRunReference } from "./forecast-run.reference";
import type { EntryBasis, PostedJournalLine } from "./ledger";
import { addMonths } from "./periods";

function random(seed: number) { let state = seed || 1; return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return ((state >>> 0) % 1_000_000) / 1_000_000; }; }
const pick = <T,>(next: () => number, values: readonly T[]) => values[Math.floor(next() * values.length)]!;

const accounts: ForecastAccount[] = [
  { accountId: "cash", accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" },
  { accountId: "bank", accountCode: "1010", accountName: "Operating bank", accountType: "asset", normalBalance: "debit", statementLine: "Cash" },
  { accountId: "petty", accountCode: "1020", accountName: "Petty cash", accountType: "asset", normalBalance: "debit" },
  { accountId: "ar", accountCode: "1100", accountName: "Accounts receivable", accountType: "asset", normalBalance: "debit" },
  { accountId: "contra", accountCode: "1500", accountName: "Accumulated depreciation", accountType: "contra", normalBalance: "credit", statementSection: "asset" },
  { accountId: "ap", accountCode: "2000", accountName: "Accounts payable", accountType: "liability", normalBalance: "credit" },
  { accountId: "advance", accountCode: "2100", accountName: "Cash advances payable", accountType: "liability", normalBalance: "credit" },
  { accountId: "equity", accountCode: "3000", accountName: "Owner capital", accountType: "equity", normalBalance: "credit" },
  { accountId: "revenue", accountCode: "4000", accountName: "Revenue", accountType: "revenue", normalBalance: "credit" },
  { accountId: "payroll", accountCode: "6000", accountName: "Payroll", accountType: "expense", normalBalance: "debit" },
  { accountId: "fees", accountCode: "6100", accountName: "Cashback fees", accountType: "expense", normalBalance: "debit" },
];
const templates: ForecastEntryTemplate[] = [
  { id: "t-spend", itemType: "obligation", direction: "spend", debitAccountId: "payroll", creditAccountId: "cash" },
  { id: "t-receipt", itemType: "agreement", direction: "receipt", debitAccountId: "bank", creditAccountId: "revenue" },
];
const bases: EntryBasis[] = ["actual", "actual", "actual", "actual", "adjustment", "elimination", "plan", "scenario", "translation"];

/** The equivalence generator, scaled: about `lineCount` lines spread over three years of history. */
function ledgerOf(lineCount: number, asOfMonth: string) {
  const next = random(lineCount);
  const lines: PostedJournalLine[] = [];
  for (let entry = 0; lines.length < lineCount; entry += 1) {
    const period = addMonths(asOfMonth, -Math.floor(next() * 36));
    const basis = pick(next, bases);
    const currency = next() < 0.85 ? "USD" : "EUR";
    const entrySource = next() < 0.02 ? "period_close" : "journal";
    const legs = 2 + Math.floor(next() * 3);
    const entryId = `${pick(next, ["a", "m", "z"])}-${entry}`;
    for (let leg = 0; leg < legs; leg += 1) {
      const account = pick(next, accounts);
      const amount = String(Math.floor(next() * 500_000));
      const debit = next() < 0.5;
      lines.push({ ...account, id: `${entryId}-${leg}`, entryId, entrySource, basis, currency, period, debitMinor: debit ? amount : "0", creditMinor: debit ? "0" : amount });
    }
  }
  return lines;
}

const asOfMonth = "2026-08";
const drivers: ForecastDriver[] = [
  { id: "payroll", label: "Payroll", itemType: "obligation", direction: "spend", amountMinor: "100000", cadence: "monthly", effectiveFrom: "2026-09" },
  { id: "retainer", label: "Retainer", itemType: "agreement", direction: "receipt", amountMinor: "60000", cadence: "monthly", effectiveFrom: "2026-10" },
];
const shared = { drivers, templates, accounts, currency: "USD", asOfMonth, horizonMonths: 24, minimumCashMinor: "0" };

// Vitest 5 benchmarks live on the test context: `vitest bench --run` prints the comparison table.
for (const size of [10_000, 50_000]) {
  const actualLines = ledgerOf(size, asOfMonth);
  const actuals = summarizeActualCash(actualLines, "USD", asOfMonth);
  test(`forecast run, ${size.toLocaleString("en-US")} actual lines`, async ({ bench }) => {
    await bench.compare(
      bench("slice-1 reference (statements per month)", () => { buildForecastRunReference({ ...shared, actualLines }); }),
      bench("summarizeActualCash + buildForecastRun", () => { buildForecastRun({ ...shared, actuals: summarizeActualCash(actualLines, "USD", asOfMonth) }); }),
      bench("buildForecastRun on a precomputed summary", () => { buildForecastRun({ ...shared, actuals }); }),
      { iterations: 5, time: 0, warmupIterations: 1, warmupTime: 0 },
    );
  }, 600_000);
}
