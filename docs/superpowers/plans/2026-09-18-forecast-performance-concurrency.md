# Forecast Performance and Concurrency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the derived forecast cost O(L log L) once per revision and O(P) per preview, with output identical to slice 1. Store compact, canonically hashed inputs, load the forecast once per request, and serialize forecast jobs per company so a run is never persisted for a superseded revision.

**Architecture:**
- `summarizeActualCash` reduces posted actuals to a few numbers per month in a single sorted pass.
- `buildForecastRun` takes that summary instead of the lines, and computes projected cash from the projected lines alone.
- A test-only copy of the slice-1 engine anchors a randomized equivalence test.
- The web layer passes a transaction executor through the loaders. `runForecastJob` runs in one READ COMMITTED transaction behind a per-company advisory lock, and checks the revision before and after the work.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), vitest 5, Drizzle ORM 0.45 on postgres-js, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-18-forecast-performance-concurrency-design.md` (it builds on `2026-09-18-forecast-consequences-design.md`).

## Global Constraints

- Output of `buildForecastRun` (`months`, `nodes`, `runway`, `projectedLines`, `drivers`, `exceptions`, `verificationStatus`) must be byte-identical under `stableJson` to the slice-1 engine for the equivalence generator's ledgers.
- `forecastFormulaVersion` stays `"forecast-run-2026-09-18.2"`.
- Money is minor units held as strings, or as `bigint` during math. Balance amounts go through `whole()`, which maps any non-canonical string to 0n. Cash-flow amounts go through raw `BigInt`.
- Nothing inside `runForecastJob`'s transaction may call `getDatabase()`. The dev pool has one connection, so doing so deadlocks.
- Pure modules have no `server-only` import and no DB access. Server modules start with `import "server-only"`.
- Use conditional spreads for optional properties. Never assign `undefined`.
- End every commit message with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. Work on branch `feature/forecast-consequences`. Do not push.
- DB-backed tests follow `apps/web/src/lib/forecast-job.test.ts`: dotenv from the repo root, `describe.skipIf(!process.env.DATABASE_URL)`, and `if (!process.env.DATABASE_URL) return;` at the top of the factory. They create and delete their own company. They run against the local dev DB, which is approved.
- Lint baseline is 10 errors / 13 warnings, all pre-existing. Add none.

Commands:
- Engine: `pnpm --filter @nevermodel/finance-engine test`
- Web: `pnpm --filter @finance/web test`
- Evals: `pnpm --filter @nevermodel/accounting-evals test`
- `pnpm -r typecheck`
- `pnpm --filter @finance/web lint`

---

## File Structure

- `packages/finance-engine/src/forecast-actuals.ts` (new, pure): `summarizeActualCash`, `resolveCashGroups`, `cashFlowMovements`, and the shared cash predicates.
- `packages/finance-engine/src/forecast-run.reference.ts` (new, test-only, not exported from the index): the slice-1 `buildForecastRun`, copied verbatim and renamed.
- `packages/finance-engine/src/forecast-run.ts`: new input shape (`actuals: ActualCashSummary` replaces `actualLines`), and projected cash computed from the projected lines.
- `packages/finance-engine/src/forecast-equivalence.test.ts` (new): the seeded generator and the equivalence property test.
- `packages/finance-engine/src/forecast-run.bench.ts` (new, `vitest bench` only).
- `apps/web/src/lib/db-executor.ts` (new): the `DbExecutor` type.
- Web loaders and jobs gain `db?` executors: `journal-ledger.ts`, `forecast-inputs.ts`, `forecast-persistence.ts`, `forecast-job.ts`, `calculation-outbox.ts`.
- `apps/web/src/lib/forecast-preview.ts`: reuses the stored input.
- Readers pass the forecast once: `journal-ledger.ts`, `journal-financial-views.ts`, and the routes.

---

### Task 1: Actuals summary and the reference engine

**Files:**
- Create: `packages/finance-engine/src/forecast-actuals.ts`, `packages/finance-engine/src/forecast-actuals.test.ts`
- Create: `packages/finance-engine/src/forecast-run.reference.ts`
- Modify: `packages/finance-engine/src/index.ts` (export forecast-actuals only)

**Interfaces:**
- Produces:
  - `ActualCashMonth`, `ActualCashSummary`
  - `summarizeActualCash(lines, currency, asOfMonth): ActualCashSummary`
  - `isBalanceCashGroup(key: string, label: string): boolean`
  - `isCashFlowLine(line: { statementLine?: string; accountName: string }): boolean`
  - `balanceSection(line: { accountType: string; statementSection?: string }): string | undefined`
  - `wholeMinor(value: string): bigint`
  - `resolveCashGroups(rows): Map<string, boolean>`
  - `cashFlowTotals(lines): { receipts: bigint; spending: bigint }`
  - `buildForecastRunReference(input: ReferenceForecastRunInput): ForecastRun`, test-only

- [ ] **Step 1: Create the reference engine.** Copy the current `packages/finance-engine/src/forecast-run.ts` verbatim into `forecast-run.reference.ts`, with these renames only:
  - `buildForecastRun` → `buildForecastRunReference`
  - `ForecastRunInput` → `ReferenceForecastRunInput`

  Import the types it returns (`ForecastRun`, `ForecastNode`, `ForecastMonth`, `ForecastAccount`, `ForecastNodeKind`) from `./forecast-run` rather than redeclaring them. Keep `forecastFormulaVersion` imported from `./forecast-run`. Put this header comment first: `/** Slice-1 statement-based forecast, kept verbatim as the equivalence oracle for tests. Never import from production code. */`. Do not export it from `index.ts`.

- [ ] **Step 2: Write the failing summary tests.** `packages/finance-engine/src/forecast-actuals.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { summarizeActualCash } from "./forecast-actuals";
import { buildJournalStatements } from "./statements";
import { endingCashMinor } from "./cash";
import type { PostedJournalLine } from "./ledger";

const base = { currency: "USD", normalBalance: "debit" as const };
const line = (id: string, entryId: string, accountId: string, accountCode: string, accountName: string, accountType: string, debitMinor: string, creditMinor: string, period: string, extra: Partial<PostedJournalLine> = {}): PostedJournalLine => ({ ...base, id, entryId, accountId, accountCode, accountName, accountType, debitMinor, creditMinor, period, ...extra });

const ledger: PostedJournalLine[] = [
  line("a1", "e1", "cash", "1000", "Cash", "asset", "100000", "0", "2026-05", { statementLine: "Cash" }),
  line("a2", "e1", "eq", "3000", "Capital", "equity", "0", "100000", "2026-05"),
  line("b1", "e2", "exp", "6000", "Payroll", "expense", "20000", "0", "2026-06"),
  line("b2", "e2", "cash", "1000", "Cash", "asset", "0", "20000", "2026-06", { statementLine: "Cash" }),
  // transfer between two cash groups nets to zero cash flow
  line("c1", "e3", "petty", "1020", "Petty cash", "asset", "5000", "0", "2026-07"),
  line("c2", "e3", "cash", "1000", "Cash", "asset", "0", "5000", "2026-07", { statementLine: "Cash" }),
  // contra asset named cash but without statementSection is excluded from balance cash
  line("d1", "e4", "contra", "1500", "Cash reserve contra", "contra", "0", "700", "2026-07"),
  line("d2", "e4", "exp", "6000", "Payroll", "expense", "700", "0", "2026-07"),
  // period close entries count in cash flow
  line("f1", "e5", "cash", "1000", "Cash", "asset", "0", "300", "2026-08", { statementLine: "Cash", entrySource: "period_close" }),
  line("f2", "e5", "eq", "3000", "Capital", "equity", "300", "0", "2026-08", { entrySource: "period_close" }),
  // excluded: plan basis, other currency, after as-of
  line("g1", "e6", "cash", "1000", "Cash", "asset", "999", "0", "2026-08", { statementLine: "Cash", basis: "plan" }),
  line("h1", "e7", "cash", "1000", "Cash", "asset", "999", "0", "2026-08", { statementLine: "Cash", currency: "EUR" }),
  line("i1", "e8", "cash", "1000", "Cash", "asset", "999", "0", "2026-09", { statementLine: "Cash" }),
];

describe("summarizeActualCash", () => {
  it("matches statement-based cash, receipts, and spending for each trailing month", () => {
    const summary = summarizeActualCash(ledger, "USD", "2026-08");
    expect(summary.months.map((month) => month.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
    const reported = ledger.filter((entry) => (entry.basis ?? "actual") === "actual" && entry.period <= "2026-08");
    for (const month of summary.months) {
      const statement = buildJournalStatements(reported, month.month, undefined, { basis: "all" }).byCurrency.find((candidate) => candidate.currency === "USD");
      expect(month.endingCashMinor).toBe(endingCashMinor(statement).toString());
      expect(month.receiptsMinor).toBe(statement?.cashFlow?.cashReceiptsMinor ?? "0");
      expect(month.spendingMinor).toBe(statement?.cashFlow?.cashSpendingMinor ?? "0");
    }
    expect(summary.months[0]!.openingCashMinor).toBe("100000");
    expect(summary.months[2]!.endingCashMinor).toBe("79700");
  });

  it("is independent of line order", () => {
    expect(summarizeActualCash([...ledger].reverse(), "USD", "2026-08")).toEqual(summarizeActualCash(ledger, "USD", "2026-08"));
  });

  it("records which balance groups are cash", () => {
    expect(summarizeActualCash(ledger, "USD", "2026-08").cashGroups).toEqual([["1020", true], ["Cash", true]]);
  });
});
```
Note on the expected `"79700"`: 100000 − 20000 at June = 80000. July's transfer moves cash between two cash groups, and petty cash counts too, so 80000. The contra line is excluded. August's close entry credits cash 300, giving 79700.

- [ ] **Step 3: Run it and verify it fails.** Run `pnpm --filter @nevermodel/finance-engine test -- forecast-actuals`. Expected: FAIL (module not found).

- [ ] **Step 4: Implement `forecast-actuals.ts`.**
```ts
import type { PostedJournalLine } from "./ledger";
import { addMonths } from "./periods";

export type ActualCashMonth = { month: string; openingCashMinor: string; endingCashMinor: string; receiptsMinor: string; spendingMinor: string };
/** Everything the forecast needs from posted actuals: trailing monthly cash, and which balance groups count as cash. */
export type ActualCashSummary = { currency: string; asOfMonth: string; months: ActualCashMonth[]; cashGroups: [string, boolean][] };

type CashMetadata = Pick<PostedJournalLine, "accountCode" | "accountName" | "accountType" | "statementSection" | "statementLine">;

const reportedBases = new Set(["actual", "adjustment", "elimination"]);
/** ledger.ts `whole`: non-canonical amounts contribute nothing to balances. */
export const wholeMinor = (value: string) => BigInt(/^(?:0|[1-9]\d*)$/.test(value) ? value : "0");
export const balanceSection = (line: { accountType: string; statementSection?: string }) => (line.accountType === "contra" ? line.statementSection : line.accountType);
/** cash.ts `isCashStatementLine`, applied to a statements.ts `aggregate` group. */
export const isBalanceCashGroup = (key: string, label: string) => /\bcash\b/i.test(`${key} ${label}`);
/** statements.ts cash-flow predicate: per line, any section, no word boundary. */
export const isCashFlowLine = (line: { statementLine?: string; accountName: string }) => /cash/.test(`${line.statementLine ?? ""} ${line.accountName}`.toLowerCase());
const groupKey = (row: CashMetadata) => row.statementLine ?? row.accountCode;
const rowKey = (line: Pick<PostedJournalLine, "accountId" | "entityId" | "currency">) => `${line.accountId}:${line.entityId ?? "consolidated"}:${line.currency}`;

/**
 * Cash flag per balance group, as statements.ts `aggregate` decides it. The
 * group label comes from the first trial-balance row by account code, and
 * each row takes its metadata from its lowest-id line.
 */
export function resolveCashGroups(rows: CashMetadata[], known: Map<string, boolean> = new Map()): Map<string, boolean> {
  const groups = new Map(known);
  for (const row of [...rows].sort((left, right) => left.accountCode.localeCompare(right.accountCode))) {
    if (balanceSection(row) !== "asset") continue;
    const key = groupKey(row);
    if (!groups.has(key)) groups.set(key, isBalanceCashGroup(key, row.statementLine ?? row.accountName));
  }
  return groups;
}

/** Receipts and spending for one month's lines: cash movement netted per entry. */
export function cashFlowTotals(lines: Pick<PostedJournalLine, "id" | "entryId" | "statementLine" | "accountName" | "debitMinor" | "creditMinor">[]) {
  const movements = new Map<string, bigint>();
  for (const line of lines) {
    if (!isCashFlowLine(line)) continue;
    const entry = line.entryId ?? line.id;
    movements.set(entry, (movements.get(entry) ?? 0n) + BigInt(line.debitMinor) - BigInt(line.creditMinor));
  }
  let receipts = 0n; let spending = 0n;
  for (const movement of movements.values()) { if (movement >= 0n) receipts += movement; else spending += -movement; }
  return { receipts, spending };
}

/** Is this row's balance counted as cash, given the resolved groups? */
export const isCashBalanceRow = (row: CashMetadata, groups: Map<string, boolean>) => balanceSection(row) === "asset" && groups.get(groupKey(row)) === true;

/**
 * One sorted pass over posted actuals, equivalent to reading ending cash and
 * cash-flow receipts and spending off buildJournalStatements for as-of−2..as-of
 * (opening from as-of−3), without building any statement.
 */
export function summarizeActualCash(lines: PostedJournalLine[], currency: string, asOfMonth: string): ActualCashSummary {
  const included = lines.filter((line) => reportedBases.has(line.basis ?? "actual") && line.period <= asOfMonth && line.currency === currency).sort((left, right) => left.id.localeCompare(right.id));
  const rows = new Map<string, PostedJournalLine>();
  for (const line of included) if (!rows.has(rowKey(line))) rows.set(rowKey(line), line);
  const groups = resolveCashGroups([...rows.values()]);
  const firstMonth = addMonths(asOfMonth, -3);
  const balanceThrough = new Map<string, bigint>();
  let before = 0n;
  const byMonth = new Map<string, PostedJournalLine[]>();
  for (const line of included) {
    const row = rows.get(rowKey(line))!;
    const delta = isCashBalanceRow(row, groups) ? wholeMinor(line.debitMinor) - wholeMinor(line.creditMinor) : 0n;
    if (line.period <= firstMonth) before += delta; else balanceThrough.set(line.period, (balanceThrough.get(line.period) ?? 0n) + delta);
    if (line.period > firstMonth) byMonth.set(line.period, [...(byMonth.get(line.period) ?? []), line]);
  }
  const months: ActualCashMonth[] = [];
  let opening = before;
  for (let month = addMonths(asOfMonth, -2); month <= asOfMonth; month = addMonths(month, 1)) {
    const ending = opening + (balanceThrough.get(month) ?? 0n);
    const flow = cashFlowTotals(byMonth.get(month) ?? []);
    months.push({ month, openingCashMinor: opening.toString(), endingCashMinor: ending.toString(), receiptsMinor: flow.receipts.toString(), spendingMinor: flow.spending.toString() });
    opening = ending;
  }
  return { currency, asOfMonth, months, cashGroups: [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)) };
}
```
Performance note: `byMonth` holds only 3 months of lines, so the spread push is bounded. If a month is very large, switch it to an in-place `push`. Behaviour is the same either way.

Append to `packages/finance-engine/src/index.ts`: `export * from "./forecast-actuals";`

- [ ] **Step 5: Run it and verify it passes.** Run `pnpm --filter @nevermodel/finance-engine test -- forecast-actuals` and `pnpm --filter @nevermodel/finance-engine typecheck`. Expected: PASS. If the first test fails on a single month, compare that month against `buildJournalStatements` by hand, fix the summary (not the test), and record the case in the report.

- [ ] **Step 6: Commit.** Message: `Summarize actual cash in one sorted pass; keep the slice-1 engine as a test oracle`.

---

### Task 2: `buildForecastRun` on the summary, with the equivalence proof

**Files:**
- Modify: `packages/finance-engine/src/forecast-run.ts`
- Create: `packages/finance-engine/src/forecast-equivalence.test.ts`, `packages/finance-engine/src/forecast-run.bench.ts`
- Modify, for the new input shape only:
  - `packages/finance-engine/src/forecast-run.test.ts`
  - `packages/finance-engine/src/forecast-consequence.test.ts`
  - `packages/accounting-evals/src/index.ts`
  - `apps/web/src/lib/forecast-inputs.ts`, where `loadForecastInputs` now builds the summary
  - any other `buildForecastRun` caller (`grep -rn "buildForecastRun(" packages apps --include=*.ts`)

**Interfaces:**
- Consumes: everything from Task 1.
- Produces: `ForecastRunInput = { actuals: ActualCashSummary; drivers; templates; accounts; currency; asOfMonth; horizonMonths; minimumCashMinor }`. `buildForecastRun(input)` returns the same `ForecastRun` shape.

- [ ] **Step 1: Write the equivalence test (it fails until Step 3).** `packages/finance-engine/src/forecast-equivalence.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildForecastRun, type ForecastAccount } from "./forecast-run";
import { buildForecastRunReference } from "./forecast-run.reference";
import { summarizeActualCash } from "./forecast-actuals";
import { stableJson } from "./stable-json";
import { addMonths } from "./periods";
import type { ForecastDriver, ForecastEntryTemplate } from "./forecast-projections";
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
      const account = pick(next, accounts);
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
});
```

- [ ] **Step 2: Run it and verify it fails.** Run `pnpm --filter @nevermodel/finance-engine test -- forecast-equivalence`. Expected: FAIL on type or shape, because `buildForecastRun` still takes `actualLines`.

- [ ] **Step 3: Rewrite `buildForecastRun`.** In `packages/finance-engine/src/forecast-run.ts`:
  - Change `ForecastRunInput` to `{ actuals: ActualCashSummary; drivers: ForecastDriver[]; templates: ForecastEntryTemplate[]; accounts: ForecastAccount[]; currency: string; asOfMonth: string; horizonMonths: number; minimumCashMinor: string }`, importing `ActualCashSummary` and helpers from `./forecast-actuals`.
  - Validate `input.actuals.asOfMonth === input.asOfMonth` and `input.actuals.currency === input.currency`. Throw on a mismatch.
  - Keep everything up to and including `projectedLines` and `driversByMonth` unchanged.
  - Replace the `lines` / `statementFor` / month loop with:
```ts
  const groups = resolveCashGroups(projectedLines, new Map(input.actuals.cashGroups));
  const projectedByMonth = new Map<string, PostedJournalLine[]>();
  for (const line of projectedLines) projectedByMonth.set(line.period, [...(projectedByMonth.get(line.period) ?? []), line]);
  const nodes: ForecastNode[] = [];
  const months: ForecastMonth[] = [];
  const firstMonth = addMonths(input.asOfMonth, -3);
  const actualMonths = input.actuals.months;
  nodes.push(node("ending_cash", firstMonth, "Ending cash", "sum(cash asset balances)", actualMonths[0]!.openingCashMinor, [], []));
  let opening = BigInt(actualMonths[0]!.openingCashMinor);
  for (let month = addMonths(input.asOfMonth, -2); month <= horizon.end; month = addMonths(month, 1)) {
    const actual = actualMonths.find((candidate) => candidate.month === month);
    const monthLines = projectedByMonth.get(month) ?? [];
    const ending = actual ? BigInt(actual.endingCashMinor) : opening + monthLines.reduce((sum, line) => sum + (isCashBalanceRow(line, groups) ? wholeMinor(line.debitMinor) - wholeMinor(line.creditMinor) : 0n), 0n);
    const flow = actual ? { receipts: BigInt(actual.receiptsMinor), spending: BigInt(actual.spendingMinor) } : cashFlowTotals(monthLines);
    const driverIds = driversByMonth.get(month) ?? [];
    months.push({ month, basis: month <= input.asOfMonth ? "actual" : "forecast", openingCashMinor: opening.toString(), endingCashMinor: ending.toString(), receiptsMinor: flow.receipts.toString(), spendingMinor: flow.spending.toString(), driverIds });
    nodes.push(node("ending_cash", month, "Ending cash", "sum(cash asset balances)", ending.toString(), [], driverIds));
    nodes.push(node("net_burn", month, "Net burn", "opening cash − ending cash", (opening - ending).toString(), [`ending_cash:${addMonths(month, -1)}`, `ending_cash:${month}`], driverIds));
    opening = ending;
  }
```
  Leave everything after the loop (trailing burn, ratio, cash-out, runway, nodes, return) unchanged. Remove the now-unused imports (`buildJournalStatements`, `endingCashMinor`, `reportedBases`, `PostedJournalLine` if unused).

  **Note on `resolveCashGroups(projectedLines, known)`:** the actual groups come first and win. New groups that appear only on projected accounts are resolved in account-code order. This matches the reference unless a projected-only account shares a group key with a lower code than an actual member. That case is covered by the per-group ruling.

  **Note on the months where `receiptsMinor` is `"0"`:** the reference reads `statement?.cashFlow?.cashReceiptsMinor ?? "0"`, and `cashFlowTotals([])` gives `0n`, so the two agree.

- [ ] **Step 4: Update the callers to the new input.**
  - In `forecast-run.test.ts` and `forecast-consequence.test.ts`, replace `actualLines: X` in inputs with `actuals: summarizeActualCash(X, "USD", asOfMonth)`, using the test's own asOf. Do this through a local helper so the expectations stay unchanged.
  - Update the accounting eval the same way.
  - In `apps/web/src/lib/forecast-inputs.ts` `loadForecastInputs`, load the lines as today and return `actuals: summarizeActualCash(actualLines, company.baseCurrency, asOfMonth)` instead of `actualLines`.
  - Every expectation stays the same. If one changes, that is an equivalence bug: fix the engine, not the test.

- [ ] **Step 5: Add a structural no-statements test.** Append to `forecast-equivalence.test.ts`:
```ts
import { vi } from "vitest";
import * as statements from "./statements";
it("never builds journal statements", () => {
  const spy = vi.spyOn(statements, "buildJournalStatements");
  const asOfMonth = "2026-08";
  const actualLines = ledgerFor(99, asOfMonth);
  buildForecastRun({ drivers: driversFor(99, asOfMonth), templates, accounts, currency: "USD", asOfMonth, horizonMonths: 24, minimumCashMinor: "0", actuals: summarizeActualCash(actualLines, "USD", asOfMonth) });
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});
```
If ESM namespace spying is not supported in this vitest setup, assert structurally instead. Read `forecast-run.ts` and `forecast-actuals.ts` with `node:fs` in the test and expect neither source to contain `buildJournalStatements` or `buildTrialBalance`. Document which approach you used.

- [ ] **Step 6: Add the benchmark (not part of `pnpm test`).** In `packages/finance-engine/src/forecast-run.bench.ts`, use `bench` from vitest to compare `buildForecastRunReference` with `summarizeActualCash` + `buildForecastRun` on 10k and 50k synthetic lines. Build the ledgers with a scaled-up copy of `ledgerFor`, placed in the bench file. Run `pnpm --filter @nevermodel/finance-engine exec vitest bench --run` and paste the numbers into the report.

- [ ] **Step 7: Verify.** Run the engine, web, and eval tests, then `pnpm -r typecheck`. Expected: all PASS, with 250/250 equivalence seeds and every existing expectation unchanged. Commit with the message: `Compute the forecast from an actuals summary, proven equivalent to the statement engine`.

---

### Task 3: Compact canonical inputs, executors, and serialized forecast jobs

**Files:**
- Create: `apps/web/src/lib/db-executor.ts`
- Modify:
  - `apps/web/src/lib/journal-ledger.ts` (`loadPostedJournalLines`)
  - `apps/web/src/lib/forecast-inputs.ts`
  - `apps/web/src/lib/forecast-persistence.ts`
  - `apps/web/src/lib/forecast-job.ts`
  - `apps/web/src/lib/calculation-outbox.ts`
  - `apps/web/src/lib/forecast-rollover.ts`, if it calls into these
- Tests: extend `apps/web/src/lib/forecast-job.test.ts`

**Interfaces:**
- Produces:
  - `DbExecutor`
  - `runForecastJob(companyId, revision, options?: { now?: Date }): Promise<{ id: string; reused: boolean } | { superseded: true }>`
  - The loaders take a `db?` argument, as the spec's B5 section lists.

- [ ] **Step 1: Add the executor type.** Create `apps/web/src/lib/db-executor.ts`:
```ts
import type { getDatabase } from "@finance/database";
type Database = ReturnType<typeof getDatabase>;
/** The database or an open transaction: loaders that may run inside a forecast job's transaction accept either. */
export type DbExecutor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];
```

- [ ] **Step 2: Thread `db?` through the loaders.** Each of these takes an optional last argument `db: DbExecutor = getDatabase()` and uses it for every query:
  - `loadPostedJournalLines`
  - `loadForecastDrivers`
  - `forecastAsOfMonth`
  - `loadForecastInputs`, whose signature becomes `(companyId, options: { now?: Date; db?: DbExecutor } = {})`. Update callers that passed `now` positionally.
  - `persistForecastRun`
  - `loadPreviousForecastRun`
  - `recordForecastConsequence`

  In `persistForecastRun`, when a `db` is passed, run the insert-run plus insert-nodes on it directly. Otherwise keep its own transaction.

  Before hashing, sort `input.drivers` and `input.templates` by id in `loadForecastInputs`, so the input is canonical. The input now holds `actuals` and not lines, so it is compact.

- [ ] **Step 3: Write the failing DB tests.** Append these to the `forecast job` suite in `forecast-job.test.ts`. Reuse its company, `cause` helper, and imports, and add `runForecastJob` from `./forecast-job`. Expect `companies` and `sql` in scope as that file already imports them.
```ts
  it("persists nothing for a revision that has already moved", async () => {
    const [company] = await db.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, companyId));
    const stale = String(BigInt(company!.revision) - 1n);
    expect(await runForecastJob(companyId, stale)).toEqual({ superseded: true });
  });

  it("serializes concurrent jobs so an effect is counted once", async () => {
    await db.update(economicItems).set({ amount: "3000" }).where(eq(economicItems.id, itemId));
    const [bumped] = await db.update(companies).set({ financialStateRevision: sql`(financial_state_revision::bigint + 1)::text` }).where(eq(companies.id, companyId)).returning({ revision: companies.financialStateRevision });
    await db.insert(financialStateRevisions).values({ companyId, revision: bumped!.revision, kind: "item_edited", subjectType: "economic_item", subjectId: itemId, via: "worker" });
    const previousRevision = String(BigInt(bumped!.revision) - 1n);
    const results = await Promise.all([runForecastJob(companyId, previousRevision), runForecastJob(companyId, bumped!.revision)]);
    expect(results.filter((result) => "superseded" in result)).toHaveLength(1);
    const rows = await db.select().from(forecastConsequences).where(and(eq(forecastConsequences.companyId, companyId), eq(forecastConsequences.revision, bumped!.revision)));
    expect(rows).toHaveLength(1);
  });
```
  With the dev pool at 1, the two jobs serialize on the connection, which is fine: the test proves ordering and single counting. Also add a unit-style test that a mid-job revision bump leads to `superseded`. Do this by passing a test-only hook: `runForecastJob(companyId, revision, { now, afterCompute?: (tx) => Promise<void> })`, where the test's hook bumps the revision through `tx`. Keep the hook documented as test-only.

- [ ] **Step 4: Implement `runForecastJob`.**
```ts
import "server-only";
import { eq, sql } from "drizzle-orm";
import { companies, getDatabase } from "@finance/database";
import { buildForecastRun } from "@nevermodel/finance-engine";
import type { DbExecutor } from "@/lib/db-executor";
import { loadForecastInputs } from "@/lib/forecast-inputs";
import { persistForecastRun, recordForecastConsequence } from "@/lib/forecast-persistence";

class ForecastSuperseded extends Error {}

/**
 * Derive, persist, and diff the forecast for one committed revision. Jobs for a
 * company serialize on an advisory lock, and a run is persisted only if the
 * company is still at this revision both before and after the work.
 */
export async function runForecastJob(companyId: string, financialStateRevision: string, options: { now?: Date; afterCompute?: (tx: DbExecutor) => Promise<void> } = {}) {
  const currentRevision = async (tx: DbExecutor) => (await tx.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, companyId)).limit(1))[0]?.revision;
  try {
    return await getDatabase().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`forecast:${companyId}`}))`);
      if ((await currentRevision(tx)) !== financialStateRevision) throw new ForecastSuperseded();
      const input = await loadForecastInputs(companyId, { ...(options.now ? { now: options.now } : {}), db: tx });
      const run = buildForecastRun(input);
      const persisted = await persistForecastRun({ companyId, financialStateRevision, run, input }, tx);
      await recordForecastConsequence({ companyId, financialStateRevision, nextRunId: persisted.id, run }, tx);
      if (options.afterCompute) await options.afterCompute(tx);
      if ((await currentRevision(tx)) !== financialStateRevision) throw new ForecastSuperseded();
      return persisted;
    });
  } catch (error) {
    if (error instanceof ForecastSuperseded) return { superseded: true as const };
    throw error;
  }
}
```
  Adapt the argument shapes to whatever `persistForecastRun` and `recordForecastConsequence` take after Step 2. Keep the `now` threading that the rollover work added.

  In `calculation-outbox.ts`, when `runForecastJob` returns `{ superseded: true }`, mark the job `superseded` (same update as the existing supersede branch) and return `{ id, status: "superseded" }`. Do not set `calculationRunId`.

- [ ] **Step 5: Verify.** Run web tests (the DB suites must run), `pnpm -r typecheck`, and lint. Commit with the message: `Serialize forecast jobs per company and store compact canonical inputs`.

---

### Task 4: Preview without loading the ledger

**Files:**
- Modify: `apps/web/src/lib/forecast-preview.ts`
- Test: extend `apps/web/src/lib/forecast-preview.test.ts`

- [ ] **Step 1: Write the failing test.** In the preview parity suite, add a test that spies on the ledger loader and checks the preview does not load it when the latest run is current:
```ts
  it("does not load the ledger when the latest forecast run is current", async () => {
    const ledger = await import("./journal-ledger");
    const spy = vi.spyOn(ledger, "loadPostedJournalLines");
    const [item] = await db.insert(economicItems).values({ companyId, type: "obligation", direction: "spend", label: "Insurance", amount: "100", cadence: "monthly", effectiveFrom: firstMonth, status: "draft" }).returning({ id: economicItems.id });
    await previewForecastChange(companyId, { kind: "confirm_item", itemId: item!.id });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
```
  If ESM spying does not intercept the call, export a small counter from forecast-preview, `lastPreviewSource: "stored" | "loaded"`, and assert that it reads `"stored"`. Document which approach you used.

- [ ] **Step 2: Implement.** In `previewForecastChange`:
  1. Load the latest forecast run row: id, revision, `inputJson`, engineVersion. Also load the company revision.
  2. Parse the stored input. The stored input is current when all of these hold:
     - the parsed input has an `actuals` key
     - the run revision equals the company revision
     - `input.asOfMonth` equals `await forecastAsOfMonth(companyId, now)`
  3. When the stored input is current, the base input is `{ ...stored, drivers, templates }`, with drivers and templates reloaded from `loadForecastDrivers` and sorted by id.
  4. When it is not current, the base input is `await loadForecastInputs(companyId)`.
  5. Apply the change to the drivers as today, then build both sides with `buildForecastRun`.
  6. Keep the `PreviewConflict` behaviour and the scenario and no-effect notes.

- [ ] **Step 3: Verify and commit.** The preview parity tests must still pass. Commit with the message: `Preview from the stored forecast input instead of reloading the ledger`.

---

### Task 5: One forecast per request for readers

**Files:**
- Modify: `apps/web/src/lib/journal-ledger.ts`, `apps/web/src/lib/journal-financial-views.ts`
- Modify these routes: `journal-financials`, `ledger/reporting`, `ledger/inspect`, `ledger/calculations`, and `agent`

- [ ] **Step 1: Add the parameter.** `withDerivedForecast(companyId, lines, selection, forecast?: LatestForecast | null)` uses the passed value when it is not `undefined`. `null` means "no forecast" and loads nothing. `loadTrialBalance`, `loadJournalStatements`, and `loadJournalReport` gain a trailing `options: { forecast?: LatestForecast | null } = {}` and pass it through. Export `type LatestForecast = NonNullable<Awaited<ReturnType<typeof loadLatestForecast>>>` from forecast-read.ts.

- [ ] **Step 2: Load once per request.** `loadJournalFinancialMonths` takes `forecast?: LatestForecast | null`. When the view is projected or scenario and `forecast` is undefined, it loads the forecast once before the month loop and passes it to each `loadJournalReport`. Each route that already calls `loadLatestForecast` passes its value down. The agent route loads it once and reuses it for `financials`, `get_statements`, and `trace_value`.

- [ ] **Step 3: Test.** Add a test, `apps/web/src/lib/journal-financial-views.test.ts`, DB-backed on the forecast-job pattern. Create a company with one forecast run via `refreshCurrentCalculationRun`, then spy on or count `loadLatestForecast`. If spying is not possible, export a call counter from forecast-read that is only compiled for tests. Call `loadJournalFinancialMonths` over 12 months in the projected view and assert that the forecast was loaded exactly once.

- [ ] **Step 4: Verify and commit.** Commit with the message: `Load the derived forecast once per request`.

---

### Task 6: Verification

- [ ] Run `pnpm test && pnpm -r typecheck` and lint. Record the counts, confirm the DB suites ran, and paste the Task 2 bench numbers into the report.
