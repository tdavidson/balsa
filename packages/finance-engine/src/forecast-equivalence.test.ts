import { describe, expect, it, vi } from "vitest";
import { buildForecastRun, type ForecastAccount } from "./forecast-run";
import { buildForecastRunReference, buildProjectedEntriesReference } from "./forecast-run.reference";
import { summarizeActualCash } from "./forecast-actuals";
import * as statements from "./statements";
import { stableJson } from "./stable-json";
import { addMonths } from "./periods";
import { buildProjectedEntries, type ForecastDriver, type ForecastEntryTemplate } from "./forecast-projections";
import type { ForecastModel } from "./forecast-model";
import type { EntryBasis, PostedJournalLine } from "./ledger";

function random(seed: number) { let state = seed || 1; return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return ((state >>> 0) % 1_000_000) / 1_000_000; }; }
const pick = <T,>(next: () => number, values: readonly T[]) => values[Math.floor(next() * values.length)]!;

// Accounts that share a group key share cash-ness, which is the documented limit of resolving cash per group once.
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
  { id: "t-petty", itemType: "obligation", direction: "spend", category: "petty", debitAccountId: "fees", creditAccountId: "petty" },
];
const bases: EntryBasis[] = ["actual", "actual", "actual", "actual", "adjustment", "elimination", "plan", "scenario", "translation"];

function ledgerFor(seed: number, asOfMonth: string) {
  const next = random(seed);
  // Every fourth ledger never touches some cash accounts, so projected lines must resolve those cash groups themselves.
  const pool = seed % 4 === 0 ? accounts.filter((account) => !["cash", "bank", "petty"].slice(seed % 3).includes(account.accountId)) : accounts;
  const lines: PostedJournalLine[] = [];
  const entryCount = 5 + Math.floor(next() * 60);
  for (let entry = 0; entry < entryCount; entry += 1) {
    const period = addMonths(asOfMonth, -Math.floor(next() * 8) + 1);
    const basis = pick(next, bases);
    const currency = next() < 0.85 ? "USD" : "EUR";
    const entrySource = next() < 0.08 ? "period_close" : "journal";
    const legs = 2 + Math.floor(next() * 3);
    const entryId = `${pick(next, ["a", "m", "z"])}${seed}-${entry}`;
    for (let leg = 0; leg < legs; leg += 1) {
      const account = pick(next, pool);
      const amount = String(Math.floor(next() * 500_000));
      const debit = next() < 0.5;
      lines.push({ ...account, id: `${entryId}-${leg}`, entryId, entrySource, basis, currency, period, debitMinor: debit ? amount : "0", creditMinor: debit ? "0" : amount });
    }
  }
  return lines;
}

function driversFor(seed: number, asOfMonth: string): ForecastDriver[] {
  const next = random(seed * 7 + 3);
  const count = Math.floor(next() * 5);
  const drivers: ForecastDriver[] = [];
  for (let index = 0; index < count; index += 1) {
    const kind = pick(next, ["spend", "receipt", "petty", "orphan"] as const);
    drivers.push({
      id: `d${seed}-${index}`, label: `Driver ${index}`,
      itemType: kind === "receipt" ? "agreement" : kind === "orphan" ? "agreement" : "obligation",
      direction: kind === "receipt" ? "receipt" : "spend",
      ...(kind === "petty" ? { category: "petty" } : {}),
      amountMinor: String(1 + Math.floor(next() * 200_000)),
      cadence: pick(next, ["once", "monthly", "quarterly", "annual"] as const),
      effectiveFrom: addMonths(asOfMonth, Math.floor(next() * 6) - 2),
      ...(next() < 0.3 ? { effectiveTo: addMonths(asOfMonth, 6 + Math.floor(next() * 12)) } : {}),
    });
  }
  return drivers;
}

describe("forecast engine equivalence with the slice-1 reference", () => {
  it("produces byte-identical runs across 250 random ledgers", () => {
    for (let seed = 1; seed <= 250; seed += 1) {
      const asOfMonth = addMonths("2026-08", (seed % 5) - 2);
      const actualLines = ledgerFor(seed, asOfMonth);
      const drivers = driversFor(seed, asOfMonth);
      const horizonMonths = 1 + (seed % 24);
      const minimumCashMinor = seed % 3 === 0 ? "250000" : "0";
      const shared = { drivers, templates, accounts, currency: "USD", asOfMonth, horizonMonths, minimumCashMinor };
      const reference = buildForecastRunReference({ ...shared, actualLines });
      const derived = buildForecastRun({ ...shared, actuals: summarizeActualCash(actualLines, "USD", asOfMonth) });
      expect(stableJson(derived), `seed ${seed}`).toBe(stableJson(reference));
    }
  });

  it("stays byte-identical with an empty or unused model and no formula drivers", () => {
    const unused: ForecastModel = { dimensions: [{ name: "team", items: ["Eng"] }], variables: [{ name: "headcount", kind: "number", dims: ["team"], inputs: [{ coords: { team: "Eng" }, from: "2026-08", value: "3" }] }] };
    for (let seed = 1; seed <= 100; seed += 1) {
      const asOfMonth = addMonths("2026-08", (seed % 5) - 2);
      const actualLines = ledgerFor(seed, asOfMonth);
      const shared = { drivers: driversFor(seed, asOfMonth), templates, accounts, currency: "USD", asOfMonth, horizonMonths: 1 + (seed % 24), minimumCashMinor: seed % 3 === 0 ? "250000" : "0" };
      const reference = stableJson(buildForecastRunReference({ ...shared, actualLines }));
      for (const model of [{ dimensions: [], variables: [] }, unused]) {
        const derived = buildForecastRun({ ...shared, actuals: summarizeActualCash(actualLines, "USD", asOfMonth), model });
        expect(stableJson(derived), `seed ${seed}`).toBe(reference);
        expect("modelSummary" in derived).toBe(false);
      }
    }
  });

  it("projects fixed-amount drivers exactly as the slice-1 projection", () => {
    for (let seed = 1; seed <= 250; seed += 1) {
      const asOfMonth = addMonths("2026-08", (seed % 5) - 2);
      const drivers = driversFor(seed, asOfMonth);
      const horizon = { start: addMonths(asOfMonth, 1), end: addMonths(asOfMonth, 1 + (seed % 24)) };
      expect(stableJson(buildProjectedEntries(drivers, templates, horizon)), `seed ${seed}`).toBe(stableJson(buildProjectedEntriesReference(drivers, templates, horizon)));
    }
  });
  it("never builds journal statements", () => {
    const spy = vi.spyOn(statements, "buildJournalStatements");
    const asOfMonth = "2026-08";
    const actualLines = ledgerFor(99, asOfMonth);
    const shared = { drivers: driversFor(99, asOfMonth), templates, accounts, currency: "USD", asOfMonth, horizonMonths: 24, minimumCashMinor: "0" };
    buildForecastRun({ ...shared, actuals: summarizeActualCash(actualLines, "USD", asOfMonth) });
    expect(spy).not.toHaveBeenCalled();
    // Control: the spy does intercept module calls, because the statement-based reference trips it.
    buildForecastRunReference({ ...shared, actualLines });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
