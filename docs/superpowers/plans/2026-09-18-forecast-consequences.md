# Forecast Consequences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Post-implementation changes

The following enhancements were added after initial implementation:

- **As-of rule:** `max(latest closed period, last full calendar month)` — extended beyond the original "latest closed period" to handle open forecasts.
- **Runway definition:** Full months funded before the cash-out month (revised from "months from as-of to cash-out").
- **Formula version:** `forecast-run-2026-09-18.2` (advanced from `.1` for as-of and runway refinements).
- **Consequence flags:** `methodChanged` and `rolledForward` to track methodology shifts and period rollover effects in delta records.
- **Revision cause:** `period_rolled` cause added to capture month-end forecast refreshes; `subjectIds` field added for bulk operation attribution.
- **Calculation trace:** Forecast-node tracing in the calculation trace dialog shows node IDs, formulas, and value lineage.
- **Entity filtering:** "Consolidated runway" label added when a forecast runway is displayed under entity filters.
- **Ledger reporting:** Effective as-of date reported in ledger reporting, inspect, and calculations routes.
- **Follow-up plan:** Performance and concurrency enhancements documented at `docs/superpowers/plans/2026-09-18-forecast-performance-concurrency.md`.

**Goal:** Derive the forecast (cash, burn, runway) from confirmed drivers on every financial-state revision. Store the difference between consecutive forecast runs as a consequence record that is attributed to its causes. Let the CFO preview that consequence before confirming an item or applying a decision.

**Architecture:**
- A pure `buildForecastRun` in `finance-engine` turns posted actuals, confirmed drivers, templates and accounts into projected lines, monthly cash, and runway nodes.
- Every revision records its cause and queues a `forecast` outbox job. The job persists the run as a `calculation_run` and diffs it against the previous forecast run into `forecast_consequences`.
- Readers overlay the latest run's projected lines through `journal-ledger.ts`.
- The preview calls the same pure function twice in memory.

**Tech Stack:** TypeScript (strict: `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Next.js 16 route handlers, Drizzle ORM on Postgres 17, handwritten SQL migrations, vitest 5, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-18-forecast-consequences-design.md`

## Global Constraints

- Money is minor units held as decimal strings, or as `bigint` during math. The only non-integer value is `cash_over_trailing_burn`, which is truncated to one decimal place.
- Forecast horizon: `24` months. Default minimum cash: `"0"`. Formula version: `"forecast-run-2026-09-18.1"`.
- The as-of month is the latest closed period. If no period is closed, it is the last full calendar month.
- `refreshCurrentCalculationRun` requires a `cause`. Never add a default cause.
- Split every module into pure code and server code:
  - Pure modules have no `import "server-only"` and no database access, and have unit tests.
  - Server modules start with `import "server-only"`.
- With `exactOptionalPropertyTypes`, never assign `undefined` to an optional property. Use conditional spreads (`...(x ? { x } : {})`), which is the codebase's idiom.
- Stored `journal_entries.basis` values `"forecast"` and `"plan"` are both read as in-memory basis `"plan"`. The in-memory `"forecast"` basis comes only from the derived forecast run.
- End every commit message with the trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Work on branch `feature/forecast-consequences`.

Commands:
- Engine tests: `pnpm --filter @nevermodel/finance-engine test`
- Web tests: `pnpm --filter @finance/web test`
- Web typecheck: `pnpm --filter @finance/web typecheck`
- Engine typecheck: `pnpm --filter @nevermodel/finance-engine typecheck`
- Migrate: `pnpm --filter @finance/database db:migrate`
- Evals: `pnpm --filter @nevermodel/accounting-evals test`

---

## File Structure

**finance-engine (pure)**
- `packages/finance-engine/src/stable-json.ts`: canonical JSON, moved from web.
- `packages/finance-engine/src/cash.ts`: the single "which lines are cash" rule and `endingCashMinor`.
- `packages/finance-engine/src/forecast-run.ts`: `buildForecastRun`, types, and `forecastFormulaVersion`.
- `packages/finance-engine/src/forecast-consequence.ts`: `diffForecastRuns` and `ForecastConsequence`.
- Modify `ledger.ts` (`EntryBasis` gains `"plan"`), `forecast-projections.ts` (driver lineage fields), and `index.ts` (exports).

**database**
- `packages/database/drizzle/0072_forecast_consequences.sql` and a `meta/_journal.json` entry.
- Modify `packages/database/src/schema.ts`: `companies.minimumCashMinor`, `financialStateRevisions`, `forecastConsequences`.

**web: pure (tested)**
- `apps/web/src/lib/revision-cause.ts`: the `RevisionCause` type.
- `apps/web/src/lib/journal-basis.ts`: maps a stored basis to an in-memory basis.
- `apps/web/src/lib/forecast-drivers.ts`: row → driver, template and account mappers.
- `apps/web/src/lib/decision-driver-effects.ts`: `projectDecisionEffectOnDrivers`.
- `apps/web/src/lib/consequence-copy.ts`: the one-line copy for consequences and causes.

**web: server**
- `apps/web/src/lib/forecast-inputs.ts`: `loadForecastDrivers`, `forecastAsOfMonth`, `loadForecastInputs`.
- `apps/web/src/lib/forecast-persistence.ts`: `persistForecastRun`, `loadPreviousForecastRun`, `recordForecastConsequence`.
- `apps/web/src/lib/forecast-job.ts`: `runForecastJob`.
- `apps/web/src/lib/forecast-read.ts`: `loadLatestForecast`, `loadRecentConsequences`.
- `apps/web/src/lib/forecast-plan-pin.ts`: `pinForecastAsPlan`.
- Routes: `apps/web/src/app/api/forecast/preview/route.ts`, `apps/web/src/app/api/forecast/consequences/route.ts`, `apps/web/src/app/api/forecast/settings/route.ts`.
- Modify: `refresh-calculation-run.ts` and its 24 callers, `calculation-outbox.ts`, `journal-posting.ts`, `journal-ledger.ts`, `journal-calculation-graph.ts`, `journal-financial-views.ts`, the journal-financials route, the agent route, the forecast-projections routes, the journals route, and the ledger/statements route.

**web: UI**
- `apps/web/src/components/forecast-consequence-line.tsx` and `forecast-what-changed.tsx`.
- Modify `app-shell.tsx`, `company-settings-dialog.tsx`, `accounting-modal.tsx` and `forecast-projections-panel.tsx`.

**Tests / evals**
- vitest alias setup: `apps/web/vitest.config.mts` and `apps/web/src/test/server-only.ts`.
- DB-backed tests run only when `DATABASE_URL` or `TEST_DATABASE_URL` is set: `apps/web/src/lib/forecast-job.test.ts` and `apps/web/src/lib/forecast-plan-pin.test.ts`.
- A new eval in `packages/accounting-evals/src/index.ts`.

---

### Task 1: Shared engine helpers and the `plan` basis

**Files:**
- Create: `packages/finance-engine/src/stable-json.ts`, `packages/finance-engine/src/stable-json.test.ts`
- Create: `packages/finance-engine/src/cash.ts`, `packages/finance-engine/src/cash.test.ts`
- Create: `apps/web/src/lib/journal-basis.ts`, `apps/web/src/lib/journal-basis.test.ts`
- Modify: `packages/finance-engine/src/ledger.ts:4`, `packages/finance-engine/src/index.ts`
- Modify: `apps/web/src/lib/journal-calculation-graph.ts:7-13`, `apps/web/src/lib/journal-financial-views.ts:9`, `apps/web/src/lib/journal-ledger.ts:9`, `apps/web/src/lib/journal-posting.ts:21`, `apps/web/src/app/api/journals/route.ts:10`, `apps/web/src/app/api/ledger/statements/route.ts:22`

**Interfaces:**
- Produces: `stableJson(value: unknown): string`, `isCashStatementLine(line: { key: string; label: string }): boolean`, `endingCashMinor(statement: CurrencyJournalStatements | null | undefined): bigint`, `EntryBasis` including `"plan"`, and `entryBasisFromStored(value: string): EntryBasis | undefined`.

- [ ] **Step 1: Write failing engine tests**

`packages/finance-engine/src/stable-json.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { stableJson } from "./stable-json";

describe("stableJson", () => {
  it("is independent of key order and drops undefined", () => {
    expect(stableJson({ b: 1, a: { d: undefined, c: [2, "x"] } })).toBe(stableJson({ a: { c: [2, "x"] }, b: 1 }));
    expect(stableJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});
```

`packages/finance-engine/src/cash.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { endingCashMinor } from "./cash";
import { buildJournalStatements } from "./statements";
import type { PostedJournalLine } from "./ledger";

const line = (id: string, accountId: string, accountName: string, accountType: string, normalBalance: "debit" | "credit", debitMinor: string, creditMinor: string): PostedJournalLine => ({ id, entryId: "e1", accountId, accountCode: accountId, accountName, accountType, normalBalance, currency: "USD", debitMinor, creditMinor, period: "2026-09" });

describe("endingCashMinor", () => {
  it("counts only cash asset lines", () => {
    const statement = buildJournalStatements([
      line("a", "1000", "Cash", "asset", "debit", "5000", "0"),
      line("b", "1200", "Accounts receivable", "asset", "debit", "700", "0"),
      line("c", "3000", "Capital", "equity", "credit", "0", "5700"),
    ], "2026-09").byCurrency[0];
    expect(endingCashMinor(statement)).toBe(5000n);
    expect(endingCashMinor(undefined)).toBe(0n);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @nevermodel/finance-engine test -- stable-json cash`
Expected: FAIL, "Cannot find module './stable-json'" and "'./cash'".

- [ ] **Step 3: Implement the engine helpers**

`packages/finance-engine/src/stable-json.ts`:
```ts
/** Canonical JSON: sorted keys and dropped `undefined`, so equal values hash equally. */
export function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}
```

`packages/finance-engine/src/cash.ts`:
```ts
import type { CurrencyJournalStatements } from "./statements";

/** The one rule for which balance-sheet lines count as cash; dashboards and forecasts must agree. */
export const isCashStatementLine = (line: { key: string; label: string }) => /\bcash\b/i.test(`${line.key} ${line.label}`);

export function endingCashMinor(statement: CurrencyJournalStatements | null | undefined): bigint {
  return (statement?.balanceSheet.assets ?? []).filter(isCashStatementLine).reduce((sum, line) => sum + BigInt(line.amountMinor), 0n);
}
```

In `packages/finance-engine/src/ledger.ts:4`, change `EntryBasis` to:
```ts
export type EntryBasis = "actual" | "forecast" | "scenario" | "plan" | "adjustment" | "elimination" | "translation";
```

Append to `packages/finance-engine/src/index.ts`:
```ts
export * from "./stable-json";
export * from "./cash";
```

- [ ] **Step 4: Run engine tests**

Run: `pnpm --filter @nevermodel/finance-engine test`
Expected: PASS, including the existing `statements.test.ts`. Plan lines never reach the actual or projected views because `selectJournalLinesForReporting` includes only actual, adjustment, elimination, forecast and scenario.

- [ ] **Step 5: Write the failing web basis test**

`apps/web/src/lib/journal-basis.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { entryBasisFromStored } from "./journal-basis";

describe("entryBasisFromStored", () => {
  it("reads posted forecast journals as pinned plans", () => {
    expect(entryBasisFromStored("forecast")).toBe("plan");
    expect(entryBasisFromStored("plan")).toBe("plan");
    expect(entryBasisFromStored("actual")).toBe("actual");
    expect(entryBasisFromStored("scenario")).toBe("scenario");
    expect(entryBasisFromStored("nonsense")).toBeUndefined();
  });
});
```
Run: `pnpm --filter @finance/web test -- journal-basis`. Expected: FAIL (module not found).

- [ ] **Step 6: Implement and adopt in web**

`apps/web/src/lib/journal-basis.ts`:
```ts
import type { EntryBasis } from "@nevermodel/finance-engine";

const passthrough = ["actual", "scenario", "adjustment", "elimination", "translation"] as const;

/** Posted forecast journals predate the derived forecast: they are pinned plans, never the live forecast. */
export function entryBasisFromStored(value: string): EntryBasis | undefined {
  if (value === "forecast" || value === "plan") return "plan";
  return passthrough.find((basis) => basis === value);
}
```

In `apps/web/src/lib/journal-ledger.ts:9`, replace the `...(["actual", "forecast", "scenario", "adjustment", "elimination", "translation"].includes(row.entryBasis) ? { basis: row.entryBasis as import("@nevermodel/finance-engine").EntryBasis } : {}),` fragment with:
```ts
...(entryBasisFromStored(row.entryBasis) ? { basis: entryBasisFromStored(row.entryBasis)! } : {}),
```
and add `import { entryBasisFromStored } from "@/lib/journal-basis";`.

In `apps/web/src/lib/journal-calculation-graph.ts`, delete the local `stableJson` function (lines 7-13) and import it: `import { journalCalculationFormulaVersion, stableJson, type JournalCalculationGraph } from "@nevermodel/finance-engine";`.

In `apps/web/src/lib/journal-financial-views.ts`, delete the `cashMinor` const (line 9), import `endingCashMinor` from `@nevermodel/finance-engine`, and replace `cashMinor(statement)` with `endingCashMinor(statement)`.

In `apps/web/src/lib/journal-posting.ts:21`, add `"plan"` to the `basis` union:
```ts
basis?: "actual" | "forecast" | "scenario" | "plan" | "adjustment" | "elimination" | "translation";
```

In `apps/web/src/app/api/journals/route.ts:10`, add `"plan"` wherever the body's basis enum lists `"forecast"`. Keep `"forecast"` accepted, because it is stored and read back as plan.

In `apps/web/src/app/api/ledger/statements/route.ts:22`, add `"plan"` to the allowed basis list.

- [ ] **Step 7: Verify**

Run: `pnpm --filter @finance/web test -- journal-basis && pnpm --filter @finance/web typecheck && pnpm --filter @nevermodel/finance-engine typecheck`
Expected: PASS and no type errors.

- [ ] **Step 8: Commit**
```bash
git add packages/finance-engine/src apps/web/src/lib/journal-basis.ts apps/web/src/lib/journal-basis.test.ts apps/web/src/lib/journal-ledger.ts apps/web/src/lib/journal-calculation-graph.ts apps/web/src/lib/journal-financial-views.ts apps/web/src/lib/journal-posting.ts apps/web/src/app/api/journals/route.ts apps/web/src/app/api/ledger/statements/route.ts
git commit -m "Share stableJson and the cash rule; read posted forecasts as plans

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `buildForecastRun`

**Files:**
- Modify: `packages/finance-engine/src/forecast-projections.ts:3` (driver lineage fields)
- Create: `packages/finance-engine/src/forecast-run.ts`, `packages/finance-engine/src/forecast-run.test.ts`
- Modify: `packages/finance-engine/src/index.ts`

**Interfaces:**
- Consumes: `buildProjectedEntries`, `buildJournalStatements`, `endingCashMinor`, `addMonths`, `isValidMonth`.
- Produces:
  - `forecastFormulaVersion`
  - `ForecastAccount`, `ForecastRunInput`, `ForecastNode`, `ForecastMonth`, `ForecastRunway`, `ForecastRun` (exact shapes below)
  - `buildForecastRun(input: ForecastRunInput): ForecastRun`
  - `ForecastDriver` gains optional `evidenceId`, `factId` and `counterpartyEntityId`.

- [ ] **Step 1: Extend `ForecastDriver`**

In `packages/finance-engine/src/forecast-projections.ts:3`, replace the `ForecastDriver` type with:
```ts
export type ForecastDriver = { id: string; label: string; itemType: "agreement" | "obligation"; direction: "receipt" | "spend"; category?: string; amountMinor: string; cadence: "once" | "monthly" | "quarterly" | "annual"; effectiveFrom: string; effectiveTo?: string; scenarioId?: string; decisionId?: string; policyId?: string; /** Lineage back to the evidence and fact behind the economic item. */ evidenceId?: string; factId?: string; counterpartyEntityId?: string };
```

- [ ] **Step 2: Write failing tests**

`packages/finance-engine/src/forecast-run.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildForecastRun, type ForecastAccount, type ForecastRunInput } from "./forecast-run";
import { stableJson } from "./stable-json";
import type { PostedJournalLine } from "./ledger";

const accounts: ForecastAccount[] = [
  { accountId: "cash", accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" },
  { accountId: "equity", accountCode: "3000", accountName: "Owner capital", accountType: "equity", normalBalance: "credit" },
  { accountId: "revenue", accountCode: "4000", accountName: "Revenue", accountType: "revenue", normalBalance: "credit" },
  { accountId: "payroll", accountCode: "6000", accountName: "Payroll", accountType: "expense", normalBalance: "debit" },
];
const account = (id: string) => accounts.find((candidate) => candidate.accountId === id)!;
const posted = (id: string, accountId: string, debitMinor: string, creditMinor: string, period: string, basis: PostedJournalLine["basis"] = "actual"): PostedJournalLine => ({ ...account(accountId), id, entryId: id.split(":")[0]!, basis, currency: "USD", debitMinor, creditMinor, period });

// Cash: 1,200,000 in May; 100,000 of payroll each month June–August → 900,000 at the August as-of.
const history: PostedJournalLine[] = [
  posted("capital:0", "cash", "1200000", "0", "2026-05"), posted("capital:1", "equity", "0", "1200000", "2026-05"),
  ...["2026-06", "2026-07", "2026-08"].flatMap((month) => [posted(`pay-${month}:0`, "payroll", "100000", "0", month), posted(`pay-${month}:1`, "cash", "0", "100000", month)]),
];
const templates: ForecastRunInput["templates"] = [
  { id: "spend", itemType: "obligation", direction: "spend", debitAccountId: "payroll", creditAccountId: "cash" },
  { id: "receipt", itemType: "agreement", direction: "receipt", debitAccountId: "cash", creditAccountId: "revenue" },
];
const payroll: ForecastRunInput["drivers"][number] = { id: "payroll", label: "Payroll", itemType: "obligation", direction: "spend", amountMinor: "100000", cadence: "monthly", effectiveFrom: "2026-09", evidenceId: "ev-payroll" };
const retainer: ForecastRunInput["drivers"][number] = { id: "retainer", label: "Retainer", itemType: "agreement", direction: "receipt", amountMinor: "100000", cadence: "monthly", effectiveFrom: "2026-09" };
const base: ForecastRunInput = { actualLines: history, drivers: [payroll], templates, accounts, currency: "USD", asOfMonth: "2026-08", horizonMonths: 24, minimumCashMinor: "0" };
const value = (run: ReturnType<typeof buildForecastRun>, id: string) => run.nodes.find((node) => node.id === id)?.value;

describe("buildForecastRun", () => {
  it("projects cash forward and finds the cash-out month", () => {
    const run = buildForecastRun(base);
    expect(run.horizon).toEqual({ start: "2026-09", end: "2028-08" });
    expect(value(run, "ending_cash:2026-08")).toBe("900000");
    expect(value(run, "ending_cash:2026-09")).toBe("800000");
    expect(value(run, "net_burn:2026-09")).toBe("100000");
    // 900,000 − 100,000·n < 0 first at n = 10.
    expect(run.runway.cashOutMonth).toBe("2027-06");
    expect(run.runway.runwayMonths).toBe(10);
    expect(run.verificationStatus).toBe("verified");
  });

  it("uses trailing actual burn for context", () => {
    const run = buildForecastRun(base);
    expect(run.runway.trailingBurn3mMinor).toBe("100000");
    expect(run.runway.cashOverTrailingBurn).toBe("9.0");
  });

  it("honours a minimum cash floor above zero", () => {
    const run = buildForecastRun({ ...base, minimumCashMinor: "200000" });
    // 900,000 − 100,000·n < 200,000 first at n = 8.
    expect(run.runway.cashOutMonth).toBe("2027-04");
    expect(run.runway.runwayMonths).toBe(8);
  });

  it("reports no cash-out inside the horizon", () => {
    expect(buildForecastRun({ ...base, drivers: [payroll, retainer] }).runway).toMatchObject({ cashOutMonth: null, runwayMonths: null });
    expect(buildForecastRun({ ...base, horizonMonths: 6 }).runway.cashOutMonth).toBeNull();
  });

  it("has no trailing ratio when cash is not burning", () => {
    const run = buildForecastRun({ ...base, actualLines: history.filter((line) => line.id.startsWith("capital")) });
    expect(run.runway.trailingBurn3mMinor).toBe("0");
    expect(run.runway.cashOverTrailingBurn).toBeNull();
  });

  it("keeps driver lineage on nodes and projected lines", () => {
    const run = buildForecastRun(base);
    expect(run.nodes.find((node) => node.id === "ending_cash:2026-09")?.driverIds).toEqual(["payroll"]);
    expect(run.projectedLines[0]).toMatchObject({ basis: "forecast", period: "2026-09", provenance: { sourceLocation: "forecast-driver:payroll" } });
  });

  it("excludes unmapped drivers as exceptions without moving cash", () => {
    const orphan = { ...retainer, id: "orphan", itemType: "agreement" as const, category: "unmapped" };
    const run = buildForecastRun({ ...base, templates: [templates[0]!], drivers: [payroll, orphan] });
    expect(run.exceptions.map((exception) => exception.driverId)).toEqual(["orphan"]);
    expect(run.verificationStatus).toBe("exception");
    expect(run.runway.cashOutMonth).toBe("2027-06");
  });

  it("excludes drivers whose template account is not an active account", () => {
    const run = buildForecastRun({ ...base, accounts: accounts.filter((candidate) => candidate.accountId !== "payroll") });
    expect(run.exceptions).toEqual([{ driverId: "payroll", reason: "Forecast template account payroll is not an active chart account." }]);
    expect(run.projectedLines).toEqual([]);
  });

  it("ignores posted plan, forecast and scenario journals", () => {
    const withPlan = { ...base, actualLines: [...history, posted("plan:0", "cash", "999999", "0", "2026-08", "plan"), posted("plan:1", "revenue", "0", "999999", "2026-08", "plan")] };
    expect(value(buildForecastRun(withPlan), "ending_cash:2026-08")).toBe("900000");
  });

  it("is deterministic regardless of driver order", () => {
    const one = buildForecastRun({ ...base, drivers: [payroll, retainer] });
    const two = buildForecastRun({ ...base, drivers: [retainer, payroll] });
    expect(stableJson(one)).toBe(stableJson(two));
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @nevermodel/finance-engine test -- forecast-run`
Expected: FAIL, "Cannot find module './forecast-run'".

- [ ] **Step 4: Implement**

`packages/finance-engine/src/forecast-run.ts`:
```ts
import { endingCashMinor } from "./cash";
import { buildProjectedEntries, type ForecastDriver, type ForecastEntryTemplate } from "./forecast-projections";
import type { PostedJournalLine } from "./ledger";
import { addMonths, isValidMonth } from "./periods";
import { buildJournalStatements } from "./statements";

export const forecastFormulaVersion = "forecast-run-2026-09-18.1";

export type ForecastAccount = Pick<PostedJournalLine, "accountId" | "accountCode" | "accountName" | "accountType" | "normalBalance" | "statementSection" | "statementLine" | "balanceTiming" | "cashFlowCategory" | "workingCapitalCategory">;
export type ForecastRunInput = { actualLines: PostedJournalLine[]; drivers: ForecastDriver[]; templates: ForecastEntryTemplate[]; accounts: ForecastAccount[]; currency: string; asOfMonth: string; horizonMonths: number; minimumCashMinor: string };
export type ForecastNodeKind = "ending_cash" | "net_burn" | "trailing_burn_3m" | "cash_over_trailing_burn" | "cash_out_month" | "runway_months";
export type ForecastNode = { id: string; kind: ForecastNodeKind; month: string; label: string; formula: string; formulaVersion: string; value: string | null; inputNodeIds: string[]; driverIds: string[] };
export type ForecastMonth = { month: string; basis: "actual" | "forecast"; openingCashMinor: string; endingCashMinor: string; receiptsMinor: string; spendingMinor: string; driverIds: string[] };
export type ForecastRunway = { cashOutMonth: string | null; runwayMonths: number | null; trailingBurn3mMinor: string; cashOverTrailingBurn: string | null; minimumCashMinor: string; horizonMonths: number };
export type ForecastRun = { formulaVersion: string; asOfMonth: string; horizon: { start: string; end: string }; currency: string; months: ForecastMonth[]; nodes: ForecastNode[]; projectedLines: PostedJournalLine[]; drivers: ForecastDriver[]; exceptions: { driverId: string; reason: string }[]; runway: ForecastRunway; verificationStatus: "verified" | "exception" };

const reportedBases = new Set(["actual", "adjustment", "elimination"]);
const monthsBetween = (from: string, to: string) => { const [fromYear, fromMonth] = from.split("-").map(Number); const [toYear, toMonth] = to.split("-").map(Number); return (toYear! - fromYear!) * 12 + (toMonth! - fromMonth!); };
const tenths = (value: bigint) => { const negative = value < 0n; const magnitude = negative ? -value : value; return `${negative ? "-" : ""}${magnitude / 10n}.${magnitude % 10n}`; };
const node = (kind: ForecastNodeKind, month: string, label: string, formula: string, value: string | null, inputNodeIds: string[], driverIds: string[]): ForecastNode => ({ id: `${kind}:${month}`, kind, month, label, formula, formulaVersion: forecastFormulaVersion, value, inputNodeIds, driverIds });

/**
 * Derive the live forecast from posted actuals and confirmed drivers. Nothing
 * here posts: projected lines exist only in this run, so any change to a
 * driver or an actual produces a new, comparable run.
 */
export function buildForecastRun(input: ForecastRunInput): ForecastRun {
  if (!isValidMonth(input.asOfMonth)) throw new Error(`Invalid forecast as-of month: ${input.asOfMonth}`);
  if (!Number.isInteger(input.horizonMonths) || input.horizonMonths < 1) throw new Error("Forecast horizon must be a positive whole number of months.");
  if (!/^\d+$/.test(input.minimumCashMinor)) throw new Error("Minimum cash must be a non-negative minor-unit amount.");
  const horizon = { start: addMonths(input.asOfMonth, 1), end: addMonths(input.asOfMonth, input.horizonMonths) };
  const drivers = [...input.drivers].sort((left, right) => left.id.localeCompare(right.id));
  const templates = [...input.templates].sort((left, right) => left.id.localeCompare(right.id));
  const accountById = new Map(input.accounts.map((account) => [account.accountId, account]));
  const projection = buildProjectedEntries(drivers, templates, horizon);
  const exceptions = [...projection.exceptions];
  const excluded = new Set(exceptions.map((exception) => exception.driverId));
  for (const entry of projection.entries) {
    const missing = entry.lines.find((line) => !accountById.has(line.accountId));
    if (missing && !excluded.has(entry.sourceDriverId)) {
      excluded.add(entry.sourceDriverId);
      exceptions.push({ driverId: entry.sourceDriverId, reason: `Forecast template account ${missing.accountId} is not an active chart account.` });
    }
  }
  const driverById = new Map(drivers.map((driver) => [driver.id, driver]));
  const entries = projection.entries.filter((entry) => !excluded.has(entry.sourceDriverId));
  const projectedLines: PostedJournalLine[] = entries.flatMap((entry) => {
    const driver = driverById.get(entry.sourceDriverId)!;
    return entry.lines.map((line, index) => ({
      ...accountById.get(line.accountId)!,
      id: `${entry.projectionKey}:${index}`, entryId: entry.projectionKey, entrySource: "forecast_run", basis: "forecast" as const,
      currency: input.currency, debitMinor: line.debitMinor, creditMinor: line.creditMinor, postingDate: entry.postingDate, period: entry.period,
      provenance: { sourceLocation: `forecast-driver:${driver.id}`, ...(driver.factId ? { factId: driver.factId } : {}), ...(driver.decisionId ? { decisionId: driver.decisionId } : {}) },
    }));
  });
  const driversByMonth = new Map<string, string[]>();
  for (const entry of entries) driversByMonth.set(entry.period, [...new Set([...(driversByMonth.get(entry.period) ?? []), entry.sourceDriverId])].sort());

  const lines = [...input.actualLines.filter((line) => reportedBases.has(line.basis ?? "actual") && line.period <= input.asOfMonth), ...projectedLines];
  const statementFor = (month: string) => buildJournalStatements(lines, month, undefined, { basis: "all" }).byCurrency.find((candidate) => candidate.currency === input.currency);
  const nodes: ForecastNode[] = [];
  const months: ForecastMonth[] = [];
  const firstMonth = addMonths(input.asOfMonth, -3);
  let opening = endingCashMinor(statementFor(firstMonth));
  nodes.push(node("ending_cash", firstMonth, "Ending cash", "sum(cash asset balances)", opening.toString(), [], []));
  for (let month = addMonths(input.asOfMonth, -2); month <= horizon.end; month = addMonths(month, 1)) {
    const statement = statementFor(month);
    const ending = endingCashMinor(statement);
    const driverIds = driversByMonth.get(month) ?? [];
    months.push({ month, basis: month <= input.asOfMonth ? "actual" : "forecast", openingCashMinor: opening.toString(), endingCashMinor: ending.toString(), receiptsMinor: statement?.cashFlow?.cashReceiptsMinor ?? "0", spendingMinor: statement?.cashFlow?.cashSpendingMinor ?? "0", driverIds });
    nodes.push(node("ending_cash", month, "Ending cash", "sum(cash asset balances)", ending.toString(), [], driverIds));
    nodes.push(node("net_burn", month, "Net burn", "opening cash − ending cash", (opening - ending).toString(), [`ending_cash:${addMonths(month, -1)}`, `ending_cash:${month}`], driverIds));
    opening = ending;
  }

  const trailingMonths = months.filter((month) => month.basis === "actual");
  const trailingBurn = trailingMonths.reduce((sum, month) => sum + BigInt(month.openingCashMinor) - BigInt(month.endingCashMinor), 0n) / 3n;
  const asOfCash = BigInt(months.find((month) => month.month === input.asOfMonth)!.endingCashMinor);
  const ratio = trailingBurn > 0n ? tenths((asOfCash * 10n) / trailingBurn) : null;
  const floor = BigInt(input.minimumCashMinor);
  const cashOutMonth = months.find((month) => month.month >= input.asOfMonth && BigInt(month.endingCashMinor) < floor)?.month ?? null;
  const runwayMonths = cashOutMonth ? monthsBetween(input.asOfMonth, cashOutMonth) : null;
  const trailingIds = trailingMonths.map((month) => `net_burn:${month.month}`);
  nodes.push(node("trailing_burn_3m", input.asOfMonth, "Trailing 3-month net burn", "average(net burn, last 3 actual months), truncated to minor units", trailingBurn.toString(), trailingIds, []));
  nodes.push(node("cash_over_trailing_burn", input.asOfMonth, "Cash ÷ trailing burn", "ending cash ÷ trailing burn, truncated to 0.1", ratio, [`ending_cash:${input.asOfMonth}`, `trailing_burn_3m:${input.asOfMonth}`], []));
  const projectedCashIds = months.filter((month) => month.month >= input.asOfMonth).map((month) => `ending_cash:${month.month}`);
  nodes.push(node("cash_out_month", input.asOfMonth, "Cash-out month", `first month with ending cash < ${input.minimumCashMinor}`, cashOutMonth, projectedCashIds, cashOutMonth ? (driversByMonth.get(cashOutMonth) ?? []) : []));
  nodes.push(node("runway_months", input.asOfMonth, "Runway", "months from as-of to cash-out month", runwayMonths === null ? null : String(runwayMonths), [`cash_out_month:${input.asOfMonth}`], []));

  return {
    formulaVersion: forecastFormulaVersion, asOfMonth: input.asOfMonth, horizon, currency: input.currency, months, nodes, projectedLines, drivers, exceptions,
    runway: { cashOutMonth, runwayMonths, trailingBurn3mMinor: trailingBurn.toString(), cashOverTrailingBurn: ratio, minimumCashMinor: input.minimumCashMinor, horizonMonths: input.horizonMonths },
    verificationStatus: exceptions.length ? "exception" : "verified",
  };
}
```

Append to `packages/finance-engine/src/index.ts`: `export * from "./forecast-run";`

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @nevermodel/finance-engine test && pnpm --filter @nevermodel/finance-engine typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add packages/finance-engine/src
git commit -m "Derive forecast cash, burn, and runway from confirmed drivers

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `diffForecastRuns`

**Files:**
- Create: `packages/finance-engine/src/forecast-consequence.ts`, `packages/finance-engine/src/forecast-consequence.test.ts`
- Modify: `packages/finance-engine/src/index.ts`

**Interfaces:**
- Consumes: `ForecastRun` and `ForecastDriver` from Task 2.
- Produces: `ForecastDriverRef`, `ForecastConsequence` (shape below), and `diffForecastRuns(previous: ForecastRun | null, next: ForecastRun): ForecastConsequence | null`.

- [ ] **Step 1: Write failing tests**

`packages/finance-engine/src/forecast-consequence.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { diffForecastRuns } from "./forecast-consequence";
import { buildForecastRun, type ForecastRunInput } from "./forecast-run";

const accounts: ForecastRunInput["accounts"] = [
  { accountId: "cash", accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" },
  { accountId: "equity", accountCode: "3000", accountName: "Owner capital", accountType: "equity", normalBalance: "credit" },
  { accountId: "revenue", accountCode: "4000", accountName: "Revenue", accountType: "revenue", normalBalance: "credit" },
  { accountId: "payroll", accountCode: "6000", accountName: "Payroll", accountType: "expense", normalBalance: "debit" },
];
const capital = [
  { ...accounts[0]!, id: "c:0", entryId: "c", basis: "actual" as const, currency: "USD", debitMinor: "900000", creditMinor: "0", period: "2026-08" },
  { ...accounts[1]!, id: "c:1", entryId: "c", basis: "actual" as const, currency: "USD", debitMinor: "0", creditMinor: "900000", period: "2026-08" },
];
const templates: ForecastRunInput["templates"] = [
  { id: "spend", itemType: "obligation", direction: "spend", debitAccountId: "payroll", creditAccountId: "cash" },
  { id: "receipt", itemType: "agreement", direction: "receipt", debitAccountId: "cash", creditAccountId: "revenue" },
];
const payroll: ForecastRunInput["drivers"][number] = { id: "payroll", label: "Payroll", itemType: "obligation", direction: "spend", amountMinor: "100000", cadence: "monthly", effectiveFrom: "2026-09", evidenceId: "ev-1" };
const input = (drivers: ForecastRunInput["drivers"], asOfMonth = "2026-08"): ForecastRunInput => ({ actualLines: capital, drivers, templates, accounts, currency: "USD", asOfMonth, horizonMonths: 24, minimumCashMinor: "0" });

describe("diffForecastRuns", () => {
  it("returns null when no headline figure changed", () => {
    const run = buildForecastRun(input([payroll]));
    expect(diffForecastRuns(run, buildForecastRun(input([payroll])))).toBeNull();
    expect(diffForecastRuns(run, buildForecastRun(input([{ ...payroll, label: "Renamed" }])))).toBeNull();
  });

  it("attributes an added driver and its runway effect", () => {
    const consequence = diffForecastRuns(buildForecastRun(input([])), buildForecastRun(input([payroll])))!;
    expect(consequence.cashOutMonth).toEqual({ before: null, after: "2027-06" });
    expect(consequence.runwayMonths).toEqual({ before: null, after: 10 });
    expect(consequence.projectedSpending.deltaMinor).toBe("2400000");
    expect(consequence.horizonEndCash).toEqual({ month: "2028-08", beforeMinor: "900000", afterMinor: "-1500000", deltaMinor: "-2400000" });
    expect(consequence.drivers.added).toEqual([{ id: "payroll", label: "Payroll", direction: "spend", amountMinor: "100000", cadence: "monthly", effectiveFrom: "2026-09", evidenceId: "ev-1" }]);
  });

  it("reports changed and removed drivers", () => {
    const before = buildForecastRun(input([payroll]));
    const changed = diffForecastRuns(before, buildForecastRun(input([{ ...payroll, amountMinor: "30000" }])))!;
    expect(changed.drivers.changed[0]?.fields).toEqual(["amountMinor"]);
    expect(changed.runwayMonths.after).toBeNull();
    const removed = diffForecastRuns(before, buildForecastRun(input([])))!;
    expect(removed.drivers.removed.map((driver) => driver.id)).toEqual(["payroll"]);
    expect(removed.cashOutMonth).toEqual({ before: "2027-06", after: null });
  });

  it("handles a previous run with a different horizon", () => {
    const consequence = diffForecastRuns(buildForecastRun(input([payroll], "2026-07")), buildForecastRun(input([payroll])))!;
    expect(consequence.asOfMonth).toEqual({ before: "2026-07", after: "2026-08" });
    expect(consequence.cash.some((row) => row.beforeMinor === null)).toBe(true);
  });

  it("treats a missing previous run as all-null before values", () => {
    const consequence = diffForecastRuns(null, buildForecastRun(input([payroll])))!;
    expect(consequence.asOfMonth.before).toBeNull();
    expect(consequence.horizonEndCash.beforeMinor).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @nevermodel/finance-engine test -- forecast-consequence`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`packages/finance-engine/src/forecast-consequence.ts`:
```ts
import type { ForecastDriver } from "./forecast-projections";
import type { ForecastRun } from "./forecast-run";

export type ForecastDriverRef = Pick<ForecastDriver, "id" | "label" | "direction" | "amountMinor" | "cadence" | "effectiveFrom" | "effectiveTo" | "evidenceId" | "decisionId">;
export type ForecastConsequence = {
  asOfMonth: { before: string | null; after: string };
  cash: { month: string; beforeMinor: string | null; afterMinor: string | null; deltaMinor: string }[];
  horizonEndCash: { month: string; beforeMinor: string | null; afterMinor: string; deltaMinor: string };
  cashOutMonth: { before: string | null; after: string | null };
  runwayMonths: { before: number | null; after: number | null };
  projectedReceipts: { beforeMinor: string; afterMinor: string; deltaMinor: string };
  projectedSpending: { beforeMinor: string; afterMinor: string; deltaMinor: string };
  drivers: { added: ForecastDriverRef[]; removed: ForecastDriverRef[]; changed: { before: ForecastDriverRef; after: ForecastDriverRef; fields: string[] }[] };
  exceptions: { before: number; after: number };
};

const comparedFields = ["label", "direction", "category", "amountMinor", "cadence", "effectiveFrom", "effectiveTo"] as const;
const forecastMonths = (run: ForecastRun | null) => (run?.months ?? []).filter((month) => month.basis === "forecast");
const total = (run: ForecastRun | null, field: "receiptsMinor" | "spendingMinor") => forecastMonths(run).reduce((sum, month) => sum + BigInt(month[field]), 0n);
const pair = (before: bigint, after: bigint) => ({ beforeMinor: before.toString(), afterMinor: after.toString(), deltaMinor: (after - before).toString() });
const ref = (driver: ForecastDriver): ForecastDriverRef => ({ id: driver.id, label: driver.label, direction: driver.direction, amountMinor: driver.amountMinor, cadence: driver.cadence, effectiveFrom: driver.effectiveFrom, ...(driver.effectiveTo ? { effectiveTo: driver.effectiveTo } : {}), ...(driver.evidenceId ? { evidenceId: driver.evidenceId } : {}), ...(driver.decisionId ? { decisionId: driver.decisionId } : {}) });

/** The forward consequence of moving from one forecast run to the next, or null when no headline figure moved. */
export function diffForecastRuns(previous: ForecastRun | null, next: ForecastRun): ForecastConsequence | null {
  const beforeCash = new Map(forecastMonths(previous).map((month) => [month.month, month.endingCashMinor]));
  const afterCash = new Map(forecastMonths(next).map((month) => [month.month, month.endingCashMinor]));
  const cash = [...new Set([...beforeCash.keys(), ...afterCash.keys()])].sort().map((month) => {
    const beforeMinor = beforeCash.get(month) ?? null; const afterMinor = afterCash.get(month) ?? null;
    return { month, beforeMinor, afterMinor, deltaMinor: (BigInt(afterMinor ?? "0") - BigInt(beforeMinor ?? "0")).toString() };
  }).filter((row) => row.deltaMinor !== "0" || row.beforeMinor === null || row.afterMinor === null);
  const endMonth = next.horizon.end;
  const endBefore = beforeCash.get(endMonth) ?? null; const endAfter = afterCash.get(endMonth) ?? "0";
  const beforeDrivers = new Map((previous?.drivers ?? []).map((driver) => [driver.id, driver]));
  const afterDrivers = new Map(next.drivers.map((driver) => [driver.id, driver]));
  const drivers = {
    added: next.drivers.filter((driver) => !beforeDrivers.has(driver.id)).map(ref),
    removed: (previous?.drivers ?? []).filter((driver) => !afterDrivers.has(driver.id)).map(ref),
    changed: next.drivers.flatMap((driver) => {
      const prior = beforeDrivers.get(driver.id);
      const fields = prior ? comparedFields.filter((field) => prior[field] !== driver[field]) : [];
      return prior && fields.length ? [{ before: ref(prior), after: ref(driver), fields: [...fields] }] : [];
    }),
  };
  const consequence: ForecastConsequence = {
    asOfMonth: { before: previous?.asOfMonth ?? null, after: next.asOfMonth },
    cash,
    horizonEndCash: { month: endMonth, beforeMinor: endBefore, afterMinor: endAfter, deltaMinor: (BigInt(endAfter) - BigInt(endBefore ?? "0")).toString() },
    cashOutMonth: { before: previous?.runway.cashOutMonth ?? null, after: next.runway.cashOutMonth },
    runwayMonths: { before: previous?.runway.runwayMonths ?? null, after: next.runway.runwayMonths },
    projectedReceipts: pair(total(previous, "receiptsMinor"), total(next, "receiptsMinor")),
    projectedSpending: pair(total(previous, "spendingMinor"), total(next, "spendingMinor")),
    drivers,
    exceptions: { before: previous?.exceptions.length ?? 0, after: next.exceptions.length },
  };
  const moved = cash.length > 0 || consequence.cashOutMonth.before !== consequence.cashOutMonth.after || consequence.runwayMonths.before !== consequence.runwayMonths.after
    || consequence.projectedReceipts.deltaMinor !== "0" || consequence.projectedSpending.deltaMinor !== "0" || consequence.exceptions.before !== consequence.exceptions.after;
  return moved ? consequence : null;
}
```

Append to `packages/finance-engine/src/index.ts`: `export * from "./forecast-consequence";`

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @nevermodel/finance-engine test && pnpm --filter @nevermodel/finance-engine typecheck`
Expected: PASS. If `projectedSpending.deltaMinor` is not `"2400000"`, check that `cashFlow.cashSpendingMinor` counts the credit to cash (`statements.ts` cash-flow loop). Fix the test's expectation only if the statement code defines spending differently, and write down why in the test.

- [ ] **Step 5: Commit**
```bash
git add packages/finance-engine/src
git commit -m "Diff forecast runs into attributed consequences

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Schema and migration

**Files:**
- Create: `packages/database/drizzle/0072_forecast_consequences.sql`
- Modify: `packages/database/drizzle/meta/_journal.json` (append entry idx 72)
- Modify: `packages/database/src/schema.ts` (companies around line 91; new tables after `calculationOutbox`, around line 226)

**Interfaces:**
- Produces:
  - Drizzle tables `financialStateRevisions` and `forecastConsequences`, and column `companies.minimumCashMinor` (text, default `"0"`).
  - `financialStateRevisions` columns: `companyId, revision, kind, subjectType, subjectId (nullable text), actorUserId (nullable uuid), via`.
  - `forecastConsequences` columns: `companyId, revision, previousRunId (nullable), nextRunId, causes (jsonb), delta (jsonb)`.

- [ ] **Step 1: Add schema**

In `packages/database/src/schema.ts`, in `companies`, after `financialStateRevision`:
```ts
  /** CFO-set cash floor for the forecast's cash-out month, in base-currency minor units. */
  minimumCashMinor: text("minimum_cash_minor").default("0").notNull(),
```
After the `calculationOutbox` table:
```ts
/** Why the financial-state revision advanced: exactly one row per revision. */
export const financialStateRevisions = pgTable("financial_state_revisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  revision: text("revision").notNull(),
  kind: text("kind").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id"),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  via: text("via").notNull(),
  ...timestamps,
}, (table) => [uniqueIndex("financial_state_revisions_company_revision_unique").on(table.companyId, table.revision)]);

/** The forward effect of committed changes: the difference between consecutive forecast runs. */
export const forecastConsequences = pgTable("forecast_consequences", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  revision: text("revision").notNull(),
  previousRunId: uuid("previous_run_id").references(() => calculationRuns.id, { onDelete: "set null" }),
  nextRunId: uuid("next_run_id").notNull().references(() => calculationRuns.id, { onDelete: "cascade" }),
  causes: jsonb("causes").notNull(),
  delta: jsonb("delta").notNull(),
  ...timestamps,
}, (table) => [uniqueIndex("forecast_consequences_company_revision_unique").on(table.companyId, table.revision), index("forecast_consequences_company_index").on(table.companyId, table.createdAt)]);
```

- [ ] **Step 2: Write the migration**

`packages/database/drizzle/0072_forecast_consequences.sql`:
```sql
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "minimum_cash_minor" text DEFAULT '0' NOT NULL;
--> statement-breakpoint
CREATE TABLE "financial_state_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "revision" text NOT NULL,
  "kind" text NOT NULL,
  "subject_type" text NOT NULL,
  "subject_id" text,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "via" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "financial_state_revisions_company_revision_unique" ON "financial_state_revisions" ("company_id", "revision");
--> statement-breakpoint
CREATE TABLE "forecast_consequences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "revision" text NOT NULL,
  "previous_run_id" uuid REFERENCES "calculation_runs"("id") ON DELETE set null,
  "next_run_id" uuid NOT NULL REFERENCES "calculation_runs"("id") ON DELETE cascade,
  "causes" jsonb NOT NULL,
  "delta" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "forecast_consequences_company_revision_unique" ON "forecast_consequences" ("company_id", "revision");
--> statement-breakpoint
CREATE INDEX "forecast_consequences_company_index" ON "forecast_consequences" ("company_id", "created_at");
--> statement-breakpoint
ALTER TABLE "financial_state_revisions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "financial_state_revisions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "financial_state_revisions_company_scope" ON "financial_state_revisions" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "forecast_consequences" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "forecast_consequences" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "forecast_consequences_company_scope" ON "forecast_consequences" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
```

Append to the `entries` array in `packages/database/drizzle/meta/_journal.json`, after idx 71:
```json
    {
      "idx": 72,
      "version": "7",
      "when": 1789300000035,
      "tag": "0072_forecast_consequences",
      "breakpoints": true
    }
```

- [ ] **Step 3: Apply and verify**

Run: `pnpm --filter @finance/database db:migrate && pnpm --filter @finance/database typecheck && pnpm --filter @finance/database test`
Expected: "Database migrations complete". Typecheck is clean, and the existing DB tests pass (they are skipped without a database).

- [ ] **Step 4: Commit**
```bash
git add packages/database
git commit -m "Add revision causes, forecast consequences, and minimum cash

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Required revision causes and the forecast job queue

**Files:**
- Create: `apps/web/src/lib/revision-cause.ts`, `apps/web/src/lib/refresh-calculation-run.types.test.ts`
- Modify: `apps/web/src/lib/refresh-calculation-run.ts` (whole function)
- Modify: `apps/web/src/lib/journal-posting.ts` (request type and the refresh at line ~148)
- Modify: all callers listed in Step 5

**Interfaces:**
- Consumes: `financialStateRevisions` (Task 4) and `forecastFormulaVersion` (Task 2).
- Produces:
  - `RevisionCauseKind` and `RevisionCause`
  - `refreshCurrentCalculationRun(companyId: string, options: { journalPeriods?: string[]; cause: RevisionCause })`, which returns the old result plus `forecastJobId: string | null` and `forecastStatus`
  - `JournalPostingRequest.deferRefresh?: boolean`

This task queues forecast jobs, but `processCalculationOutboxJob` still throws for them until Task 7. Those jobs are marked `failed`, get retried, and are picked up once Task 7 lands. This is safe because the forecast is not yet read anywhere.

- [ ] **Step 1: Write the type test (fails to compile until Step 3)**

`apps/web/src/lib/refresh-calculation-run.types.test.ts`:
```ts
import { describe, expectTypeOf, it } from "vitest";
import type { refreshCurrentCalculationRun } from "./refresh-calculation-run";
import type { RevisionCause } from "./revision-cause";

type Options = Parameters<typeof refreshCurrentCalculationRun>[1];

describe("refreshCurrentCalculationRun", () => {
  it("requires a cause for every revision", () => {
    expectTypeOf<Options["cause"]>().toEqualTypeOf<RevisionCause>();
    // @ts-expect-error a revision without a cause must not compile
    const missing: Options = { journalPeriods: [] };
    void missing;
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @finance/web typecheck`
Expected: FAIL, with "Cannot find module './revision-cause'" and an unused `@ts-expect-error`.

- [ ] **Step 3: Implement cause type and refresh**

`apps/web/src/lib/revision-cause.ts`:
```ts
export type RevisionCauseKind =
  | "evidence_published" | "evidence_revoked" | "evidence_reprocessed"
  | "item_confirmed" | "item_rejected" | "item_edited" | "item_created"
  | "decision_applied" | "journal_posted" | "journal_reversed"
  | "period_closed" | "period_reopened" | "fx_changed" | "entity_changed"
  | "allocation_changed" | "mapping_approved" | "plan_pinned" | "settings_changed";

/** Why the financial state changed; recorded once per revision so every forecast consequence can name its causes. */
export type RevisionCause = { kind: RevisionCauseKind; subjectType: string; subjectId: string | null; actorUserId: string | null; via: "ui" | "agent" | "worker" };
```

Replace the body of `apps/web/src/lib/refresh-calculation-run.ts` with:
```ts
import "server-only";
import { calculationOutbox, companies, financialStateRevisions, getDatabase, journalEntries } from "@finance/database";
import { and, eq, sql } from "drizzle-orm";
import { forecastFormulaVersion, journalCalculationFormulaVersion } from "@nevermodel/finance-engine";
import { processCalculationOutboxJob } from "@/lib/calculation-outbox";
import type { RevisionCause } from "@/lib/revision-cause";

/**
 * Advance the financial-state revision after a committed mutation, record why,
 * and queue the journal graphs plus one derived-forecast run for it.
 */
export async function refreshCurrentCalculationRun(companyId: string, options: { journalPeriods?: string[]; cause: RevisionCause }) {
  const db = getDatabase();
  const revision = await db.transaction(async (tx) => {
    const [company] = await tx.update(companies).set({ financialStateRevision: sql`(financial_state_revision::bigint + 1)::text`, updatedAt: new Date() }).where(eq(companies.id, companyId)).returning({ financialStateRevision: companies.financialStateRevision });
    if (!company) throw new Error("Company not found while refreshing calculation");
    await tx.insert(financialStateRevisions).values({ companyId, revision: company.financialStateRevision, kind: options.cause.kind, subjectType: options.cause.subjectType, subjectId: options.cause.subjectId, actorUserId: options.cause.actorUserId, via: options.cause.via });
    const explicitPeriods = [...new Set(options.journalPeriods ?? [])].filter((period) => /^\d{4}-(0[1-9]|1[0-2])$/.test(period));
    // A non-posting mutation (for example, evidence approval or entity setup)
    // can affect controls or presentation across existing ledger periods. In
    // single-company mode, rebuilding all posted periods is the safe choice.
    const journalPeriods = explicitPeriods.length ? explicitPeriods : [...new Set((await tx.select({ period: journalEntries.period }).from(journalEntries).where(and(eq(journalEntries.companyId, companyId), eq(journalEntries.status, "posted")))).map((entry) => entry.period))];
    const journalJobs = journalPeriods.length
      ? await tx.insert(calculationOutbox).values(journalPeriods.map((period) => ({ companyId, financialStateRevision: company.financialStateRevision, engineVersion: journalCalculationFormulaVersion, period, status: "queued" }))).onConflictDoNothing().returning({ id: calculationOutbox.id, period: calculationOutbox.period })
      : [];
    const [forecastJob] = await tx.insert(calculationOutbox).values({ companyId, financialStateRevision: company.financialStateRevision, engineVersion: forecastFormulaVersion, period: "forecast", status: "queued" }).onConflictDoNothing().returning({ id: calculationOutbox.id });
    return { revision: company.financialStateRevision, journalJobs, forecastJobId: forecastJob?.id ?? null };
  });
  const results = await Promise.all(revision.journalJobs.map((job) => processCalculationOutboxJob(job.id)));
  // The forecast reads posted lines directly, not journal graphs; it runs last so one revision computes at a time.
  const forecastResult = revision.forecastJobId ? await processCalculationOutboxJob(revision.forecastJobId) : null;
  const failed = [...results, ...(forecastResult ? [forecastResult] : [])].find((result) => result.status === "failed");
  // The financial mutation has already committed. A failed calculation stays
  // durable in the outbox for retry; it must not falsely report that the CFO's
  // approved state change failed or invite an unsafe duplicate submission.
  return { financialStateRevision: revision.revision, jobId: revision.journalJobs[0]?.id ?? null, status: failed ? "failed" as const : results.length || forecastResult ? "completed" as const : "not_queued" as const, journalJobIds: revision.journalJobs.map((job) => job.id), forecastJobId: revision.forecastJobId, forecastStatus: forecastResult?.status ?? "not_queued", ...(failed?.error ? { error: failed.error } : {}) };
}
```

- [ ] **Step 4: Journal posting: cause and deferred refresh**

In `apps/web/src/lib/journal-posting.ts`, add to `JournalPostingRequest`:
```ts
  /** Batch posters (plan pins) refresh once themselves after the batch; the single entry must not advance the revision. */
  deferRefresh?: boolean;
```
Replace the final refresh (currently `const calculationRun = committed.idempotent ? null : await refreshCurrentCalculationRun(companyId, { journalPeriods: [request.period] });`) with:
```ts
  const reversing = Boolean(request.reversalOfEntryId) || request.source === "journal_reversal";
  // An idempotent retry must not create a second calculation revision.
  const calculationRun = committed.idempotent || request.deferRefresh ? null : await refreshCurrentCalculationRun(companyId, { journalPeriods: [request.period], cause: { kind: reversing ? "journal_reversed" : "journal_posted", subjectType: "journal_entry", subjectId: committed.entryId, actorUserId: request.actorUserId ?? null, via: request.actorUserId ? "ui" : "worker" } });
```
If the in-transaction `const reversing` declaration now clashes, rename the outer one to `reversingEntry`.

- [ ] **Step 5: Update every caller**

Run `pnpm --filter @finance/web typecheck`. Every caller below fails until it passes a `cause`. In a route, `context.user.id` is the actor and `via` is `"ui"`. In a lib function, pass the function's own actor parameter if it has one (`actorUserId`, `userId`, or `closedByUserId`). If it has none, pass `actorUserId: null, via: "worker"`.

| Caller | `cause` |
|---|---|
| `lib/journal-period-close.ts:65` (retained-earnings close) | `{ kind: "period_closed", subjectType: "reporting_period", subjectId: <period>, … }` |
| `lib/journal-period-close.ts:96` (close) | `{ kind: "period_closed", subjectType: "reporting_period", subjectId: <period>, … }` |
| `lib/fx-remeasurement.ts:99` | `{ kind: "fx_changed", subjectType: "fx_remeasurement", subjectId: <period or null>, … }` |
| `lib/post-intercompany-elimination.ts:31` | `{ kind: "journal_posted", subjectType: "intercompany_elimination", subjectId: <entry id or null>, … }` |
| `api/evidence/route.ts:316` (revoke) | `{ kind: "evidence_revoked", subjectType: "evidence", subjectId: <evidence id>, … }` |
| `api/evidence/route.ts:404` (publication) | `{ kind: "evidence_published", subjectType: "evidence", subjectId: <evidence id>, … }` |
| `api/evidence/[id]/reprocess/route.ts:165` | `{ kind: "evidence_reprocessed", subjectType: "evidence", subjectId: <id>, … }` |
| `api/items/route.ts:66` | `{ kind: body.data.status === "confirmed" ? "item_confirmed" : body.data.status === "rejected" ? "item_rejected" : "item_edited", subjectType: "economic_item", subjectId: rows.length === 1 ? rows[0]!.id : null, … }` |
| `api/state/mutate/route.ts:49` | `{ kind: "item_created", subjectType: "economic_item", subjectId: <new item id>, … }` |
| `api/state/mutate/route.ts:69` | `{ kind: "allocation_changed", subjectType: "allocation", subjectId: <id>, … }` |
| `api/decisions/route.ts:31` (POST) | `{ kind: "decision_applied", subjectType: "decision", subjectId: decision?.id ?? null, … }` |
| `api/decisions/route.ts:59` (PATCH) | `{ kind: "decision_applied", subjectType: "decision", subjectId: decision.id, … }` |
| `api/months/route.ts:34` (reopen) | `{ kind: "period_reopened", subjectType: "reporting_period", subjectId: <month>, … }` |
| `api/source-row-mappings/[id]/approve/route.ts:24` | `{ kind: "mapping_approved", subjectType: "source_row_mapping", subjectId: <id>, … }` |
| `api/intercompany-mappings/route.ts:26` | `{ kind: "mapping_approved", subjectType: "intercompany_mapping", subjectId: <id or null>, … }` |
| `api/allocations/route.ts:34` | `{ kind: "allocation_changed", subjectType: "allocation", subjectId: <id>, … }` |
| `api/entities/route.ts:36,40,53,57,73` | `{ kind: "entity_changed", subjectType: "entity", subjectId: <entity id or null>, … }` |
| `api/fx-rate-sets/route.ts:71` | `{ kind: "fx_changed", subjectType: "fx_rate_set", subjectId: <id>, … }` |
| `api/fx-translation-policies/route.ts:45` | `{ kind: "fx_changed", subjectType: "fx_translation_policy", subjectId: <id or null>, … }` |

`<…>` means the identifier already in scope at that line, for example `body.data.id` or `row.id`. Where none is in scope, use `null`. Leave the forecast-projections apply route for Task 10; it gets its cause there. Until then it compiles because it calls `postApprovedJournal`, not the refresh directly.

- [ ] **Step 6: Verify**

Run: `pnpm --filter @finance/web typecheck && pnpm --filter @finance/web test`
Expected: PASS. The `@ts-expect-error` is now satisfied.

- [ ] **Step 7: Commit**
```bash
git add apps/web/src
git commit -m "Record a cause for every financial-state revision and queue a forecast job

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Forecast input loading and shared driver mapping

**Files:**
- Create: `apps/web/src/lib/forecast-drivers.ts`, `apps/web/src/lib/forecast-drivers.test.ts`
- Create: `apps/web/src/lib/forecast-inputs.ts`
- Modify: `apps/web/src/app/api/forecast-projections/route.ts` (use the loader)

**Interfaces:**
- Consumes: `ForecastDriver`, `ForecastEntryTemplate`, `ForecastAccount`, `ForecastRunInput`, `addMonths`.
- Produces:
  - `amountToMinor(value: string | null | undefined): string`
  - `economicItemToDriver(item: EconomicItemDriverRow): ForecastDriver`
  - `templateRowToTemplate(row: TemplateRow): ForecastEntryTemplate`
  - `chartAccountToForecastAccount(row: ChartAccountRow): ForecastAccount`
  - `loadForecastDrivers(companyId, { scenarioId? }): Promise<{ drivers; templates }>`
  - `forecastAsOfMonth(companyId, now): Promise<string>`
  - `loadForecastInputs(companyId, now = new Date()): Promise<ForecastRunInput>`
  - `forecastHorizonMonths = 24`

- [ ] **Step 1: Write failing mapper tests**

`apps/web/src/lib/forecast-drivers.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { amountToMinor, chartAccountToForecastAccount, economicItemToDriver, templateRowToTemplate } from "./forecast-drivers";

const item = { id: "i1", label: "Retainer", type: "agreement", direction: "receipt" as const, category: "management_fee", amount: "1250.5", cadence: "monthly", effectiveFrom: "2026-09", effectiveTo: null, scenarioId: null, decisionId: null, evidenceId: "ev1", factId: null, counterpartyEntityId: "cp1" };

describe("forecast driver mapping", () => {
  it("converts decimal amounts to minor units", () => {
    expect(amountToMinor("1250.5")).toBe("125050");
    expect(amountToMinor("0.07")).toBe("7");
    expect(amountToMinor("12")).toBe("1200");
    expect(amountToMinor("-3")).toBe("");
    expect(amountToMinor(null)).toBe("");
  });
  it("maps an economic item with lineage and without undefined keys", () => {
    const driver = economicItemToDriver(item);
    expect(driver).toEqual({ id: "i1", label: "Retainer", itemType: "agreement", direction: "receipt", category: "management_fee", amountMinor: "125050", cadence: "monthly", effectiveFrom: "2026-09", evidenceId: "ev1", counterpartyEntityId: "cp1" });
    expect(economicItemToDriver({ ...item, cadence: null }).cadence).toBe("once");
  });
  it("maps templates and chart accounts", () => {
    expect(templateRowToTemplate({ id: "t", itemType: "obligation", direction: "spend", category: null, debitAccountId: "d", creditAccountId: "c", decisionId: null, policyId: "p" })).toEqual({ id: "t", itemType: "obligation", direction: "spend", debitAccountId: "d", creditAccountId: "c", policyId: "p" });
    expect(chartAccountToForecastAccount({ id: "a", code: "1000", name: "Cash", accountType: "asset", normalBalance: "debit", statementSection: null, statementLine: "Cash", balanceTiming: "current", cashFlowCategory: null, workingCapitalCategory: null })).toEqual({ accountId: "a", accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash", balanceTiming: "current" });
  });
});
```
Run: `pnpm --filter @finance/web test -- forecast-drivers`. Expected: FAIL (module not found).

- [ ] **Step 2: Implement mappers**

`apps/web/src/lib/forecast-drivers.ts`:
```ts
import type { ForecastAccount, ForecastDriver, ForecastEntryTemplate, WorkingCapitalCategory } from "@nevermodel/finance-engine";

const cadences = ["once", "monthly", "quarterly", "annual"] as const;
const cashFlowCategories = ["operating", "investing", "financing", "none"] as const;
const workingCapitalCategories = ["receivables", "payables", "deferred_revenue", "prepaids", "inventory", "other"] as const;

/** "1250.5" → "125050". Anything else becomes "", which the engine reports as a driver exception. */
export function amountToMinor(value: string | null | undefined): string {
  if (!value || !/^\d+(?:\.\d{1,2})?$/.test(value)) return "";
  const [whole, fraction = ""] = value.split(".");
  return `${whole}${fraction.padEnd(2, "0")}`.replace(/^0+(?=\d)/, "");
}

export type EconomicItemDriverRow = { id: string; label: string; type: string; direction: "receipt" | "spend"; category: string | null; amount: string | null; cadence: string | null; effectiveFrom: string | null; effectiveTo: string | null; scenarioId: string | null; decisionId: string | null; evidenceId: string | null; factId: string | null; counterpartyEntityId: string | null };
export function economicItemToDriver(item: EconomicItemDriverRow): ForecastDriver {
  return {
    id: item.id, label: item.label, itemType: item.type === "obligation" ? "obligation" : "agreement", direction: item.direction,
    ...(item.category ? { category: item.category } : {}), amountMinor: amountToMinor(item.amount), cadence: cadences.find((cadence) => cadence === item.cadence) ?? "once", effectiveFrom: item.effectiveFrom ?? "",
    ...(item.effectiveTo ? { effectiveTo: item.effectiveTo } : {}), ...(item.scenarioId ? { scenarioId: item.scenarioId } : {}), ...(item.decisionId ? { decisionId: item.decisionId } : {}),
    ...(item.evidenceId ? { evidenceId: item.evidenceId } : {}), ...(item.factId ? { factId: item.factId } : {}), ...(item.counterpartyEntityId ? { counterpartyEntityId: item.counterpartyEntityId } : {}),
  };
}

export type TemplateRow = { id: string; itemType: string; direction: "receipt" | "spend"; category: string | null; debitAccountId: string; creditAccountId: string; decisionId: string | null; policyId: string | null };
export function templateRowToTemplate(row: TemplateRow): ForecastEntryTemplate {
  return { id: row.id, itemType: row.itemType === "obligation" ? "obligation" : "agreement", direction: row.direction, ...(row.category ? { category: row.category } : {}), debitAccountId: row.debitAccountId, creditAccountId: row.creditAccountId, ...(row.decisionId ? { decisionId: row.decisionId } : {}), ...(row.policyId ? { policyId: row.policyId } : {}) };
}

export type ChartAccountRow = { id: string; code: string; name: string; accountType: string; normalBalance: "debit" | "credit"; statementSection: string | null; statementLine: string | null; balanceTiming: string | null; cashFlowCategory: string | null; workingCapitalCategory: string | null };
export function chartAccountToForecastAccount(row: ChartAccountRow): ForecastAccount {
  const timing = row.balanceTiming === "current" || row.balanceTiming === "noncurrent" ? row.balanceTiming : undefined;
  const cashFlow = cashFlowCategories.find((category) => category === row.cashFlowCategory);
  const workingCapital: WorkingCapitalCategory | undefined = workingCapitalCategories.find((category) => category === row.workingCapitalCategory);
  return {
    accountId: row.id, accountCode: row.code, accountName: row.name, accountType: row.accountType, normalBalance: row.normalBalance,
    ...(row.statementSection ? { statementSection: row.statementSection } : {}), ...(row.statementLine ? { statementLine: row.statementLine } : {}),
    ...(timing ? { balanceTiming: timing } : {}), ...(cashFlow ? { cashFlowCategory: cashFlow } : {}), ...(workingCapital ? { workingCapitalCategory: workingCapital } : {}),
  };
}
```

- [ ] **Step 3: Implement server loaders**

`apps/web/src/lib/forecast-inputs.ts`:
```ts
import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { chartAccounts, companies, economicItems, forecastEntryTemplates, getDatabase, journalPeriodClosures } from "@finance/database";
import { addMonths, type ForecastRunInput } from "@nevermodel/finance-engine";
import { chartAccountToForecastAccount, economicItemToDriver, templateRowToTemplate } from "@/lib/forecast-drivers";
import { loadPostedJournalLines } from "@/lib/journal-ledger";

export const forecastHorizonMonths = 24;

/** Confirmed items and active templates: the only inputs a projection may use. */
export async function loadForecastDrivers(companyId: string, options: { scenarioId?: string } = {}) {
  const db = getDatabase();
  const [items, templates] = await Promise.all([
    db.select().from(economicItems).where(and(eq(economicItems.companyId, companyId), eq(economicItems.status, "confirmed"))),
    db.select().from(forecastEntryTemplates).where(and(eq(forecastEntryTemplates.companyId, companyId), eq(forecastEntryTemplates.active, "Y"))),
  ]);
  return {
    drivers: items.filter((item) => (options.scenarioId ? item.scenarioId === options.scenarioId : !item.scenarioId)).map(economicItemToDriver),
    templates: templates.map(templateRowToTemplate),
  };
}

/** The latest closed period; before any close, the last full calendar month. */
export async function forecastAsOfMonth(companyId: string, now: Date) {
  const [closure] = await getDatabase().select({ period: journalPeriodClosures.period }).from(journalPeriodClosures).where(eq(journalPeriodClosures.companyId, companyId)).orderBy(desc(journalPeriodClosures.period)).limit(1);
  return closure?.period ?? addMonths(now.toISOString().slice(0, 7), -1);
}

export async function loadForecastInputs(companyId: string, now = new Date()): Promise<ForecastRunInput> {
  const db = getDatabase();
  const [company] = await db.select({ baseCurrency: companies.baseCurrency, minimumCashMinor: companies.minimumCashMinor }).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) throw new Error("Company not found while loading forecast inputs");
  const asOfMonth = await forecastAsOfMonth(companyId, now);
  const [{ drivers, templates }, actualLines, accountRows] = await Promise.all([
    loadForecastDrivers(companyId),
    loadPostedJournalLines(companyId, asOfMonth),
    db.select().from(chartAccounts).where(and(eq(chartAccounts.companyId, companyId), eq(chartAccounts.active, "Y"))),
  ]);
  return { actualLines, drivers, templates, accounts: accountRows.map(chartAccountToForecastAccount), currency: company.baseCurrency, asOfMonth, horizonMonths: forecastHorizonMonths, minimumCashMinor: company.minimumCashMinor };
}
```
If `chartAccounts` column types differ from `ChartAccountRow` (for example `normalBalance` is a pgEnum), adjust `ChartAccountRow` to match the Drizzle select type. Never add casts inside the mapper.

- [ ] **Step 4: Use the loader in the projection preview route**

In `apps/web/src/app/api/forecast-projections/route.ts`, delete `toMinor` and the inline `items`/`templates` queries and mapping. Replace them with:
```ts
  const { drivers, templates } = await loadForecastDrivers(context.company.id, scenarioId ? { scenarioId } : {});
  const projection = buildProjectedEntries(drivers, templates, { start: start!, end: end! }, scenarioId);
```
Import `loadForecastDrivers` from `@/lib/forecast-inputs`, and remove the unused imports.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @finance/web test -- forecast-drivers && pnpm --filter @finance/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add apps/web/src
git commit -m "Load forecast inputs through one shared driver mapping

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Forecast job, persistence and consequence recording

**Files:**
- Modify: `apps/web/vitest.config.mts`; create `apps/web/src/test/server-only.ts`
- Create: `apps/web/src/lib/forecast-persistence.ts`, `apps/web/src/lib/forecast-job.ts`, `apps/web/src/lib/forecast-job.test.ts`
- Modify: `apps/web/src/lib/calculation-outbox.ts:31-38`

**Interfaces:**
- Consumes:
  - `buildForecastRun`, `diffForecastRuns`, `stableJson`, `forecastFormulaVersion`, `ForecastRun`, `ForecastRunInput`
  - `loadForecastInputs` (Task 6)
  - `financialStateRevisions` and `forecastConsequences` (Task 4)
  - `refreshCurrentCalculationRun` (Task 5)
- Produces:
  - `persistForecastRun({ companyId, financialStateRevision, run, input }): Promise<{ id: string; reused: boolean }>`
  - `loadPreviousForecastRun(companyId, beforeRevision): Promise<{ id; revision; run: ForecastRun } | null>`
  - `recordForecastConsequence({ companyId, financialStateRevision, nextRunId, run }): Promise<{ id: string } | null>`
  - `runForecastJob(companyId, financialStateRevision): Promise<{ id: string; reused: boolean }>`

- [ ] **Step 1: Make server modules testable under vitest**

`apps/web/src/test/server-only.ts`:
```ts
// vitest stand-in for the `server-only` guard, which throws outside a React Server Components build.
export {};
```
`apps/web/vitest.config.mts`:
```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./src/test/server-only.ts", import.meta.url)),
    },
  },
  test: {
    exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**"],
  },
});
```
Run: `pnpm --filter @finance/web test`. Expected: the existing tests still PASS.

- [ ] **Step 2: Write the failing DB-backed test**

`apps/web/src/lib/forecast-job.test.ts`:
```ts
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { and, desc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: fileURLToPath(new URL("../../../../.env.local", import.meta.url)) });
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

// Real Postgres: what is under test is revision attribution across the outbox, which a fake would not prove.
describe.skipIf(!process.env.DATABASE_URL)("forecast job", async () => {
  if (!process.env.DATABASE_URL) return; // skipped suites still run their factory
  const { chartAccounts, closeDatabase, companies, economicItems, financialStateRevisions, forecastConsequences, forecastEntryTemplates, getDatabase } = await import("@finance/database");
  const { refreshCurrentCalculationRun } = await import("./refresh-calculation-run");
  const { forecastAsOfMonth } = await import("./forecast-inputs");
  const { addMonths } = await import("@nevermodel/finance-engine");
  const db = getDatabase();
  let companyId = ""; let itemId = ""; let firstMonth = "";
  const cause = (kind: "entity_changed" | "item_confirmed" | "item_edited", subjectId: string | null) => ({ kind, subjectType: kind === "entity_changed" ? "company" : "economic_item", subjectId, actorUserId: null, via: "worker" as const });
  const latestConsequence = async () => (await db.select().from(forecastConsequences).where(eq(forecastConsequences.companyId, companyId)).orderBy(desc(sql`${forecastConsequences.revision}::bigint`)).limit(1))[0];

  beforeAll(async () => {
    const [company] = await db.insert(companies).values({ name: `Forecast job ${Date.now()}` }).returning({ id: companies.id });
    companyId = company!.id;
    const [cash, payroll] = await db.insert(chartAccounts).values([
      { companyId, code: "1000", name: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" },
      { companyId, code: "6000", name: "Payroll", accountType: "expense", normalBalance: "debit" },
    ]).returning({ id: chartAccounts.id });
    await db.insert(forecastEntryTemplates).values({ companyId, name: "Payroll", itemType: "obligation", direction: "spend", debitAccountId: payroll!.id, creditAccountId: cash!.id });
    firstMonth = addMonths(await forecastAsOfMonth(companyId, new Date()), 1);
    const [item] = await db.insert(economicItems).values({ companyId, type: "obligation", direction: "spend", label: "Payroll", amount: "1000", cadence: "monthly", effectiveFrom: firstMonth, status: "draft" }).returning({ id: economicItems.id });
    itemId = item!.id;
  });

  afterAll(async () => {
    if (companyId) await db.delete(companies).where(eq(companies.id, companyId));
    await closeDatabase();
  });

  it("records no consequence for the first forecast run", async () => {
    const result = await refreshCurrentCalculationRun(companyId, { cause: cause("entity_changed", companyId) });
    expect(result.forecastStatus).toBe("completed");
    expect(await latestConsequence()).toBeUndefined();
  });

  it("attributes a confirmed item's runway effect to the confirmation", async () => {
    await db.update(economicItems).set({ status: "confirmed" }).where(eq(economicItems.id, itemId));
    const result = await refreshCurrentCalculationRun(companyId, { cause: cause("item_confirmed", itemId) });
    const row = (await latestConsequence())!;
    expect(row.revision).toBe(result.financialStateRevision);
    const delta = row.delta as { cashOutMonth: { after: string | null }; runwayMonths: { after: number | null }; drivers: { added: { id: string }[] } };
    expect(delta.cashOutMonth.after).toBe(firstMonth);
    expect(delta.runwayMonths.after).toBe(1);
    expect(delta.drivers.added.map((driver) => driver.id)).toEqual([itemId]);
    expect((row.causes as { kind: string; subjectId: string }[]).map((entry) => [entry.kind, entry.subjectId])).toEqual([["item_confirmed", itemId]]);
  });

  it("carries the causes of revisions whose forecast jobs never ran", async () => {
    // A revision whose job was superseded: bumped and attributed, but never calculated.
    const [bumped] = await db.update(companies).set({ financialStateRevision: sql`(financial_state_revision::bigint + 1)::text` }).where(eq(companies.id, companyId)).returning({ revision: companies.financialStateRevision });
    await db.insert(financialStateRevisions).values({ companyId, revision: bumped!.revision, kind: "fx_changed", subjectType: "fx_rate_set", subjectId: null, via: "worker" });
    await db.update(economicItems).set({ amount: "2000" }).where(eq(economicItems.id, itemId));
    await refreshCurrentCalculationRun(companyId, { cause: cause("item_edited", itemId) });
    const row = (await latestConsequence())!;
    expect((row.causes as { kind: string }[]).map((entry) => entry.kind)).toEqual(["fx_changed", "item_edited"]);
    expect((await db.select().from(financialStateRevisions).where(and(eq(financialStateRevisions.companyId, companyId)))).length).toBe(4);
  });
});
```
Run: `pnpm --filter @finance/web test -- forecast-job`
Expected with a database: FAIL. The forecast job fails with "Unsupported calculation engine or period: forecast-run-2026-09-18.1 / forecast", so `forecastStatus` is `"failed"`. Without a database the suite is skipped. In that case, run it against the local Docker Postgres (`docker compose up -d` and `pnpm --filter @finance/database db:migrate`) before continuing.

- [ ] **Step 3: Implement persistence**

`apps/web/src/lib/forecast-persistence.ts`:
```ts
import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, like, sql } from "drizzle-orm";
import { calculationNodes, calculationRuns, financialStateRevisions, forecastConsequences, getDatabase } from "@finance/database";
import { diffForecastRuns, stableJson, type ForecastRun, type ForecastRunInput } from "@nevermodel/finance-engine";

const forecastEngines = "forecast-run-%";

/** Persist a derived forecast exactly like a journal graph: one run per (revision, engine, input), with inspectable nodes. */
export async function persistForecastRun(input: { companyId: string; financialStateRevision: string; run: ForecastRun; input: ForecastRunInput }) {
  const db = getDatabase();
  const inputJson = stableJson(input.input);
  const inputHash = createHash("sha256").update(inputJson).digest("hex");
  const inserted = await db.insert(calculationRuns).values({
    companyId: input.companyId, engineVersion: input.run.formulaVersion, inputHash, financialStateRevision: input.financialStateRevision,
    asOfMonth: input.run.asOfMonth, horizonStart: input.run.horizon.start, horizonEnd: input.run.horizon.end,
    inputJson, outputJson: stableJson(input.run), verificationStatus: input.run.verificationStatus,
  }).onConflictDoNothing().returning({ id: calculationRuns.id });
  const run = inserted[0] ?? (await db.select({ id: calculationRuns.id }).from(calculationRuns).where(and(eq(calculationRuns.companyId, input.companyId), eq(calculationRuns.financialStateRevision, input.financialStateRevision), eq(calculationRuns.engineVersion, input.run.formulaVersion), eq(calculationRuns.inputHash, inputHash))).limit(1))[0];
  if (!run) throw new Error("Unable to create or locate forecast calculation run");
  if (inserted[0] && input.run.nodes.length) await db.insert(calculationNodes).values(input.run.nodes.map((node) => ({
    calculationRunId: run.id, nodeKey: node.id, kind: node.kind, month: node.month, label: node.label, formula: node.formula, formulaVersion: node.formulaVersion,
    valueJson: stableJson(node.value), inputNodeIds: stableJson(node.inputNodeIds), lineIds: stableJson([]), provenance: stableJson({ driverIds: node.driverIds }),
    verificationStatus: input.run.verificationStatus, verificationReasons: stableJson(input.run.exceptions.map((exception) => exception.reason)),
  })));
  return { id: run.id, reused: !inserted[0] };
}

/** The most recent forecast run strictly before a revision, across forecast formula versions. */
export async function loadPreviousForecastRun(companyId: string, beforeRevision: string) {
  const [row] = await getDatabase().select({ id: calculationRuns.id, revision: calculationRuns.financialStateRevision, outputJson: calculationRuns.outputJson }).from(calculationRuns)
    .where(and(eq(calculationRuns.companyId, companyId), like(calculationRuns.engineVersion, forecastEngines), sql`${calculationRuns.financialStateRevision}::bigint < ${beforeRevision}::bigint`))
    .orderBy(desc(sql`${calculationRuns.financialStateRevision}::bigint`), desc(calculationRuns.createdAt)).limit(1);
  return row ? { id: row.id, revision: row.revision, run: JSON.parse(row.outputJson) as ForecastRun } : null;
}

/**
 * Store the forward consequence of every revision since the previous forecast
 * run. Revisions whose own jobs were superseded are included in `causes`.
 * The first run has nothing to compare against and records nothing.
 */
export async function recordForecastConsequence(input: { companyId: string; financialStateRevision: string; nextRunId: string; run: ForecastRun }) {
  const previous = await loadPreviousForecastRun(input.companyId, input.financialStateRevision);
  if (!previous) return null;
  const delta = diffForecastRuns(previous.run, input.run);
  if (!delta) return null;
  const db = getDatabase();
  const causes = await db.select().from(financialStateRevisions).where(and(
    eq(financialStateRevisions.companyId, input.companyId),
    sql`${financialStateRevisions.revision}::bigint > ${previous.revision}::bigint`,
    sql`${financialStateRevisions.revision}::bigint <= ${input.financialStateRevision}::bigint`,
  )).orderBy(asc(sql`${financialStateRevisions.revision}::bigint`));
  const [row] = await db.insert(forecastConsequences).values({
    companyId: input.companyId, revision: input.financialStateRevision, previousRunId: previous.id, nextRunId: input.nextRunId, delta,
    causes: causes.map((cause) => ({ revision: cause.revision, kind: cause.kind, subjectType: cause.subjectType, subjectId: cause.subjectId, actorUserId: cause.actorUserId, via: cause.via, createdAt: cause.createdAt.toISOString() })),
  }).onConflictDoNothing().returning({ id: forecastConsequences.id });
  return row ?? null;
}
```

`apps/web/src/lib/forecast-job.ts`:
```ts
import "server-only";
import { buildForecastRun } from "@nevermodel/finance-engine";
import { loadForecastInputs } from "@/lib/forecast-inputs";
import { persistForecastRun, recordForecastConsequence } from "@/lib/forecast-persistence";

/** Derive, persist, and diff the forecast for one committed revision. */
export async function runForecastJob(companyId: string, financialStateRevision: string) {
  const input = await loadForecastInputs(companyId);
  const run = buildForecastRun(input);
  const persisted = await persistForecastRun({ companyId, financialStateRevision, run, input });
  if (!persisted.reused) await recordForecastConsequence({ companyId, financialStateRevision, nextRunId: persisted.id, run });
  return persisted;
}
```

- [ ] **Step 4: Route forecast jobs in the outbox**

In `apps/web/src/lib/calculation-outbox.ts`, add these imports: `forecastFormulaVersion` from `@nevermodel/finance-engine` and `runForecastJob` from `@/lib/forecast-job`. Replace the `const run = … ;` expression with:
```ts
    const run = job.engineVersion === forecastFormulaVersion && job.period === "forecast"
      ? await runForecastJob(job.companyId, job.financialStateRevision)
      : job.engineVersion === journalCalculationFormulaVersion && /^\d{4}-(0[1-9]|1[0-2])$/.test(job.period)
        ? await (async () => {
          const reconciliation = await loadJournalReconciliation(job.companyId, job.period);
          const allocationAnalysis = await loadJournalAllocationAnalysis(job.companyId, job.period);
          const graph = buildJournalCalculationGraph({ period: job.period, trialBalance: reconciliation.trialBalance, statements: reconciliation.statements, ledgerReconciliation: reconciliation.report, accountBalances: reconciliation.accountBalances, allocationAnalysis });
          return persistJournalCalculationGraph({ companyId: job.companyId, financialStateRevision: job.financialStateRevision, graph, input: { trialBalance: reconciliation.trialBalance, statements: reconciliation.statements, ledgerReconciliation: reconciliation.report, accountBalances: reconciliation.accountBalances, allocationAnalysis } });
        })()
        : (() => { throw new Error(`Unsupported calculation engine or period: ${job.engineVersion} / ${job.period}`); })();
```
Update the `processQueuedCalculationJobs` doc comment to: `/** Process a bounded batch for a cron/worker invocation. Journal and forecast jobs retry safely. */`

- [ ] **Step 5: Verify**

Run: `pnpm --filter @finance/web test -- forecast-job && pnpm --filter @finance/web typecheck`
Expected: PASS with a database. All three tests should pass: no first consequence, attribution to `item_confirmed`, and the causes `["fx_changed", "item_edited"]`.

- [ ] **Step 6: Commit**
```bash
git add apps/web
git commit -m "Run, persist, and diff the derived forecast for every revision

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Readers use the derived forecast

**Files:**
- Create: `apps/web/src/lib/forecast-read.ts`
- Modify: `apps/web/src/lib/journal-ledger.ts` (`loadTrialBalance`, `loadJournalStatements`, `loadJournalReport`)
- Modify: `apps/web/src/app/api/journal-financials/route.ts`
- Modify: `apps/web/src/app/api/agent/route.ts` (as-of month, context, `read_company_state`)
- Create: `apps/web/src/app/api/forecast/consequences/route.ts`

**Interfaces:**
- Consumes: `ForecastRun`, `ForecastConsequence`, and the tables from Task 4.
- Produces:
  - `loadLatestForecast(companyId): Promise<{ runId: string; revision: string; run: ForecastRun; stale: boolean } | null>`
  - `ConsequenceCause = { revision; kind; subjectType; subjectId; actorUserId; via; createdAt; subjectLabel: string | null }`
  - `loadRecentConsequences(companyId, limit): Promise<{ id: string; revision: string; createdAt: string; causes: ConsequenceCause[]; delta: ForecastConsequence }[]>`
  - `GET /api/forecast/consequences?limit=` → `{ consequences }`
  - The `/api/journal-financials` response gains `runway: (ForecastRunway & { revision: string; horizonEnd: string; stale: boolean; exceptions: number }) | null`.

- [ ] **Step 1: Implement the reader**

`apps/web/src/lib/forecast-read.ts`:
```ts
import "server-only";
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import { calculationRuns, companies, decisions, economicItems, evidence, forecastConsequences, getDatabase } from "@finance/database";
import type { ForecastConsequence, ForecastRun } from "@nevermodel/finance-engine";

const parsedRuns = new Map<string, ForecastRun>();

/** The latest persisted forecast run. `stale` means a newer revision's forecast has not completed yet. */
export async function loadLatestForecast(companyId: string) {
  const db = getDatabase();
  const [[row], [company]] = await Promise.all([
    db.select({ id: calculationRuns.id, revision: calculationRuns.financialStateRevision }).from(calculationRuns).where(and(eq(calculationRuns.companyId, companyId), like(calculationRuns.engineVersion, "forecast-run-%"))).orderBy(desc(sql`${calculationRuns.financialStateRevision}::bigint`), desc(calculationRuns.createdAt)).limit(1),
    db.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, companyId)).limit(1),
  ]);
  if (!row) return null;
  let run = parsedRuns.get(row.id);
  if (!run) {
    const [full] = await db.select({ outputJson: calculationRuns.outputJson }).from(calculationRuns).where(eq(calculationRuns.id, row.id)).limit(1);
    if (!full) return null;
    run = JSON.parse(full.outputJson) as ForecastRun;
    parsedRuns.set(row.id, run);
    if (parsedRuns.size > 20) parsedRuns.delete(parsedRuns.keys().next().value!);
  }
  return { runId: row.id, revision: row.revision, run, stale: company?.revision !== row.revision };
}

export type ConsequenceCause = { revision: string; kind: string; subjectType: string; subjectId: string | null; actorUserId: string | null; via: string; createdAt: string; subjectLabel: string | null };

/** Recent consequences with a human label for each cause's subject. */
export async function loadRecentConsequences(companyId: string, limit = 10) {
  const db = getDatabase();
  const rows = await db.select().from(forecastConsequences).where(eq(forecastConsequences.companyId, companyId)).orderBy(desc(forecastConsequences.createdAt)).limit(Math.max(1, Math.min(limit, 50)));
  const causes = rows.flatMap((row) => row.causes as Omit<ConsequenceCause, "subjectLabel">[]);
  const ids = (type: string) => [...new Set(causes.filter((cause) => cause.subjectType === type && cause.subjectId).map((cause) => cause.subjectId!))];
  const [items, documents, answers] = await Promise.all([
    ids("economic_item").length ? db.select({ id: economicItems.id, label: economicItems.label }).from(economicItems).where(and(eq(economicItems.companyId, companyId), inArray(economicItems.id, ids("economic_item")))) : [],
    ids("evidence").length ? db.select({ id: evidence.id, label: evidence.sourceName }).from(evidence).where(and(eq(evidence.companyId, companyId), inArray(evidence.id, ids("evidence")))) : [],
    ids("decision").length ? db.select({ id: decisions.id, label: decisions.question }).from(decisions).where(and(eq(decisions.companyId, companyId), inArray(decisions.id, ids("decision")))) : [],
  ]);
  const labels = new Map([...items, ...documents, ...answers].map((row) => [row.id, row.label]));
  return rows.map((row) => ({
    id: row.id, revision: row.revision, createdAt: row.createdAt.toISOString(), delta: row.delta as ForecastConsequence,
    causes: (row.causes as Omit<ConsequenceCause, "subjectLabel">[]).map((cause) => ({ ...cause, subjectLabel: cause.subjectId ? labels.get(cause.subjectId) ?? null : null })),
  }));
}
```
If `evidence.sourceName` is nullable, the `labels` map value type is `string | null`, which `subjectLabel` already allows.

- [ ] **Step 2: Overlay projected lines in the ledger loaders**

In `apps/web/src/lib/journal-ledger.ts`, add:
```ts
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
```
Rewrite the three loaders to use it:
```ts
export async function loadTrialBalance(companyId: string, period: string, entityId?: string, selection?: Selection) {
  const view = await withDerivedForecast(companyId, await loadPostedJournalLines(companyId, period), selection);
  return buildTrialBalance(selectJournalLinesForReporting(view.lines, period, view.selection), period, entityId);
}

export async function loadJournalStatements(companyId: string, period: string, entityId?: string, selection?: Selection) {
  const view = await withDerivedForecast(companyId, await loadPostedJournalLines(companyId, period), selection);
  return buildJournalStatements(view.lines, period, entityId, view.selection);
}

export async function loadJournalReport(companyId: string, period: string, entityId?: string, selection?: Selection) {
  const view = await withDerivedForecast(companyId, await loadPostedJournalLines(companyId, period), selection);
  const selected = selectJournalLinesForReporting(view.lines, period, view.selection);
  return { trialBalance: buildTrialBalance(selected, period, entityId), statements: buildJournalStatements(view.lines, period, entityId, view.selection) };
}
```
If `exactOptionalPropertyTypes` rejects passing `view.selection` (possibly `undefined`) to an optional parameter, change the `Selection` parameters to `selection?: Selection | undefined`.

- [ ] **Step 3: Dashboard route returns runway**

In `apps/web/src/app/api/journal-financials/route.ts`, import `loadLatestForecast` from `@/lib/forecast-read`. Replace the `asOfPeriod` line and the return statement:
```ts
  const forecast = await loadLatestForecast(context.company.id);
  const asOfPeriod = url.searchParams.get("asOfPeriod") ?? forecast?.run.asOfMonth ?? current;
```
```ts
  const runway = forecast ? { ...forecast.run.runway, revision: forecast.revision, horizonEnd: forecast.run.horizon.end, stale: forecast.stale, exceptions: forecast.run.exceptions.length } : null;
  return NextResponse.json({ mode: "entry_graph", view, asOfPeriod, months, runway });
```

- [ ] **Step 4: Agent reads the same forecast**

In `apps/web/src/app/api/agent/route.ts` `POST`:
- Before the `Promise.all`, add `const forecast = await loadLatestForecast(context.company.id); const asOfMonth = forecast?.run.asOfMonth ?? currentMonth;`.
- Pass `asOfMonth` where the `loadJournalFinancialMonths` call and the tool `context` currently use `currentMonth` as the as-of month.
- Add `loadRecentConsequences(context.company.id, 5)` to the `Promise.all` as `recentConsequences`.
- Add `consequences: recentConsequences` to the tool `context` object type and value.
- In `runTool`, change the `read_company_state` case to:
```ts
    case "read_company_state": return { items: context.items, entities: context.entities, asOfMonth: asOf, horizon: { start: financials[0]?.month ?? asOf, end: financials.at(-1)?.month ?? asOf }, recentForecastConsequences: context.consequences };
```
In the system prompt near line 160, where `simulate` is described, append: "read_company_state includes recentForecastConsequences: each explains how a committed change moved projected cash and runway, with its causes."

- [ ] **Step 5: Consequences route**

`apps/web/src/app/api/forecast/consequences/route.ts`:
```ts
import { NextResponse } from "next/server";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { loadRecentConsequences } from "@/lib/forecast-read";

/** Recent forecast consequences, newest first, each with its attributed causes. */
export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? "10");
  return NextResponse.json({ consequences: await loadRecentConsequences(context.company.id, Number.isFinite(limit) ? limit : 10) });
}
```

- [ ] **Step 6: Verify**

Run: `pnpm --filter @finance/web typecheck && pnpm --filter @finance/web test`
Expected: PASS. Then run the app (`pnpm dev`), open the dashboard, and check that `GET /api/journal-financials` returns `runway` and that future months show derived cash.

- [ ] **Step 7: Commit**
```bash
git add apps/web/src
git commit -m "Read projections, runway, and consequences from the derived forecast

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Preview endpoint

**Files:**
- Create: `apps/web/src/lib/decision-driver-effects.ts`, `apps/web/src/lib/decision-driver-effects.test.ts`
- Create: `apps/web/src/app/api/forecast/preview/route.ts`
- Create: `apps/web/src/lib/forecast-preview.test.ts` (DB-backed parity)

**Interfaces:**
- Consumes: `DecisionEffect` (type only) and `parseStoredEffect` from `decision-effects.ts`, `amountToMinor`, `economicItemToDriver`, `loadForecastInputs`, `buildForecastRun`, `diffForecastRuns`.
- Produces:
  - `projectDecisionEffectOnDrivers(drivers: ForecastDriver[], effect: DecisionEffect, decisionId: string): ForecastDriver[]`
  - `previewForecastChange(companyId, change: ForecastPreviewChange): Promise<{ consequence: ForecastConsequence | null; exceptionsAfter: number; note?: string }>`, exported from the route module's sibling lib `apps/web/src/lib/forecast-preview.ts`
  - `POST /api/forecast/preview` with body `ForecastPreviewChange` returns the same object, or 409.

- [ ] **Step 1: Write failing pure tests**

`apps/web/src/lib/decision-driver-effects.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { ForecastDriver } from "@nevermodel/finance-engine";
import { projectDecisionEffectOnDrivers } from "./decision-driver-effects";

const payroll: ForecastDriver = { id: "p", label: "Payroll", itemType: "obligation", direction: "spend", category: "salary", amountMinor: "100000", cadence: "monthly", effectiveFrom: "2026-09", counterpartyEntityId: "e1" };

describe("projectDecisionEffectOnDrivers", () => {
  it("adds a base-forecast item and ignores scenario items", () => {
    const item = { label: "Contractor", direction: "spend" as const, amount: 6000, cadence: "monthly" as const, effectiveFrom: "2027-01", category: "contractor" as const, accountingTreatment: "cash" as const };
    expect(projectDecisionEffectOnDrivers([payroll], { kind: "add_item", item }, "d1").at(-1)).toEqual({ id: "decision:d1", label: "Contractor", itemType: "obligation", direction: "spend", category: "contractor", amountMinor: "600000", cadence: "monthly", effectiveFrom: "2027-01", decisionId: "d1" });
    expect(projectDecisionEffectOnDrivers([payroll], { kind: "add_item", item, scenario: "Hiring" }, "d1")).toEqual([payroll]);
  });
  it("ends, re-prices, and re-categorizes like the persisted effect", () => {
    expect(projectDecisionEffectOnDrivers([payroll], { kind: "end_item", itemId: "p", effectiveTo: "2026-12" }, "d2")[0]).toMatchObject({ effectiveTo: "2026-12", decisionId: "d2" });
    const changed = projectDecisionEffectOnDrivers([payroll], { kind: "change_amount", itemId: "p", amount: 1500.5, effectiveFrom: "2027-01" }, "d3");
    expect(changed[0]).toMatchObject({ id: "p", effectiveTo: "2026-12" });
    expect(changed[1]).toMatchObject({ id: "decision:d3", amountMinor: "150050", effectiveFrom: "2027-01", decisionId: "d3" });
    expect(changed[1]).not.toHaveProperty("effectiveTo");
    expect(projectDecisionEffectOnDrivers([payroll], { kind: "set_category", entityId: "e1", category: "contractor" }, "d4")[0]?.category).toBe("contractor");
  });
});
```
Run: `pnpm --filter @finance/web test -- decision-driver-effects`. Expected: FAIL (module not found).

- [ ] **Step 2: Implement pure projection**

`apps/web/src/lib/decision-driver-effects.ts`:
```ts
import { addMonths, type ForecastDriver } from "@nevermodel/finance-engine";
import type { DecisionEffect } from "@/lib/decision-effects";
import { amountToMinor } from "@/lib/forecast-drivers";

/**
 * What applying a decision would do to the base forecast's drivers, in memory.
 * Mirrors `applyDecisionEffect` in decision-effects.ts; the DB-backed parity
 * test in forecast-preview.test.ts fails if the two ever disagree.
 */
export function projectDecisionEffectOnDrivers(drivers: ForecastDriver[], effect: DecisionEffect, decisionId: string): ForecastDriver[] {
  if (effect.kind === "add_item") {
    if (effect.scenario) return drivers;
    const { item } = effect;
    return [...drivers, { id: `decision:${decisionId}`, label: item.label, itemType: item.direction === "spend" ? "obligation" : "agreement", direction: item.direction, category: item.category, amountMinor: amountToMinor(String(item.amount)), cadence: item.cadence, effectiveFrom: item.effectiveFrom, ...(item.effectiveTo ? { effectiveTo: item.effectiveTo } : {}), decisionId }];
  }
  if (effect.kind === "end_item") return drivers.map((driver) => (driver.id === effect.itemId ? { ...driver, effectiveTo: effect.effectiveTo, decisionId } : driver));
  if (effect.kind === "change_amount") {
    const original = drivers.find((driver) => driver.id === effect.itemId);
    if (!original) return drivers;
    const { effectiveTo: _previousEnd, ...copy } = original;
    void _previousEnd;
    return [...drivers.map((driver) => (driver.id === original.id ? { ...driver, effectiveTo: addMonths(effect.effectiveFrom, -1) } : driver)), { ...copy, id: `decision:${decisionId}`, amountMinor: amountToMinor(String(effect.amount)), effectiveFrom: effect.effectiveFrom, decisionId }];
  }
  return drivers.map((driver) => (driver.counterpartyEntityId === effect.entityId ? { ...driver, category: effect.category } : driver));
}
```

- [ ] **Step 3: Implement preview lib and route**

`apps/web/src/lib/forecast-preview.ts`:
```ts
import "server-only";
import { and, eq } from "drizzle-orm";
import { decisions, economicItems, getDatabase } from "@finance/database";
import { buildForecastRun, diffForecastRuns } from "@nevermodel/finance-engine";
import { parseStoredEffect } from "@/lib/decision-effects";
import { projectDecisionEffectOnDrivers } from "@/lib/decision-driver-effects";
import { amountToMinor, economicItemToDriver } from "@/lib/forecast-drivers";
import { loadForecastInputs } from "@/lib/forecast-inputs";

export type ForecastPreviewChange =
  | { kind: "confirm_item"; itemId: string; edits?: { amount?: number; cadence?: "once" | "monthly" | "quarterly" | "annual"; effectiveFrom?: string; effectiveTo?: string | null; category?: string } }
  | { kind: "apply_decision"; decisionId: string };

export class PreviewConflict extends Error {}

/** Compute both sides fresh, so a stale stored run cannot distort the preview. Nothing is written. */
export async function previewForecastChange(companyId: string, change: ForecastPreviewChange) {
  const inputs = await loadForecastInputs(companyId);
  const db = getDatabase();
  let drivers = inputs.drivers;
  if (change.kind === "confirm_item") {
    const [item] = await db.select().from(economicItems).where(and(eq(economicItems.id, change.itemId), eq(economicItems.companyId, companyId))).limit(1);
    if (!item) throw new PreviewConflict("Item not found");
    if (item.status !== "draft") throw new PreviewConflict("Only a draft item can be previewed");
    if (item.scenarioId) return { consequence: null, exceptionsAfter: 0, note: "Scenario items do not change the base forecast." };
    const edits = change.edits ?? {};
    const driver = economicItemToDriver({ ...item, ...(edits.cadence ? { cadence: edits.cadence } : {}), ...(edits.effectiveFrom ? { effectiveFrom: edits.effectiveFrom } : {}), ...(edits.effectiveTo !== undefined ? { effectiveTo: edits.effectiveTo } : {}), ...(edits.category ? { category: edits.category } : {}) });
    drivers = [...drivers, edits.amount !== undefined ? { ...driver, amountMinor: amountToMinor(String(edits.amount)) } : driver];
  } else {
    const [decision] = await db.select({ status: decisions.status, effect: decisions.effect }).from(decisions).where(and(eq(decisions.id, change.decisionId), eq(decisions.companyId, companyId))).limit(1);
    if (!decision) throw new PreviewConflict("Decision not found");
    if (decision.status !== "proposed") throw new PreviewConflict("Only a proposed decision can be previewed");
    const effect = parseStoredEffect(decision.effect);
    if (!effect) return { consequence: null, exceptionsAfter: 0, note: "This decision has no forecast effect." };
    drivers = projectDecisionEffectOnDrivers(drivers, effect, change.decisionId);
  }
  const asIs = buildForecastRun(inputs);
  const withChange = buildForecastRun({ ...inputs, drivers });
  return { consequence: diffForecastRuns(asIs, withChange), exceptionsAfter: withChange.exceptions.length };
}
```

`apps/web/src/app/api/forecast/preview/route.ts`:
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { categories } from "@nevermodel/finance-engine";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { PreviewConflict, previewForecastChange } from "@/lib/forecast-preview";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("confirm_item"), itemId: z.string().uuid(), edits: z.object({ amount: z.number().positive().optional(), cadence: z.enum(["once", "monthly", "quarterly", "annual"]).optional(), effectiveFrom: month.optional(), effectiveTo: month.nullable().optional(), category: z.enum(categories).optional() }).optional() }),
  z.object({ kind: z.literal("apply_decision"), decisionId: z.string().uuid() }),
]);

/** What a pending approval would do to cash and runway. Read-only. */
export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid preview request" }, { status: 400 });
  try {
    return NextResponse.json(await previewForecastChange(context.company.id, parsed.data));
  } catch (error) {
    if (error instanceof PreviewConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
```
If zod's inferred `edits` type does not match `ForecastPreviewChange` under `exactOptionalPropertyTypes`, strip the `undefined` keys before calling. Build `edits` with conditional spreads from `parsed.data.edits`.

- [ ] **Step 4: Write the DB-backed parity test**

`apps/web/src/lib/forecast-preview.test.ts`:
```ts
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { desc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: fileURLToPath(new URL("../../../../.env.local", import.meta.url)) });
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!process.env.DATABASE_URL)("forecast preview parity", async () => {
  if (!process.env.DATABASE_URL) return; // skipped suites still run their factory
  const { chartAccounts, closeDatabase, companies, decisions, economicItems, forecastConsequences, forecastEntryTemplates, getDatabase } = await import("@finance/database");
  const { refreshCurrentCalculationRun } = await import("./refresh-calculation-run");
  const { previewForecastChange } = await import("./forecast-preview");
  const { applyDecisionIfEffective } = await import("./decision-effects");
  const { forecastAsOfMonth } = await import("./forecast-inputs");
  const { addMonths } = await import("@nevermodel/finance-engine");
  const db = getDatabase();
  let companyId = ""; let firstMonth = "";
  const headline = (delta: unknown) => { const value = delta as { horizonEndCash: unknown; cashOutMonth: unknown; runwayMonths: unknown; projectedSpending: unknown; projectedReceipts: unknown }; return { horizonEndCash: value.horizonEndCash, cashOutMonth: value.cashOutMonth, runwayMonths: value.runwayMonths, projectedSpending: value.projectedSpending, projectedReceipts: value.projectedReceipts }; };
  const latest = async () => (await db.select().from(forecastConsequences).where(eq(forecastConsequences.companyId, companyId)).orderBy(desc(sql`${forecastConsequences.revision}::bigint`)).limit(1))[0]!;

  beforeAll(async () => {
    const [company] = await db.insert(companies).values({ name: `Preview parity ${Date.now()}` }).returning({ id: companies.id });
    companyId = company!.id;
    const [cash, payroll] = await db.insert(chartAccounts).values([
      { companyId, code: "1000", name: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" },
      { companyId, code: "6000", name: "Payroll", accountType: "expense", normalBalance: "debit" },
    ]).returning({ id: chartAccounts.id });
    await db.insert(forecastEntryTemplates).values({ companyId, name: "Spend", itemType: "obligation", direction: "spend", debitAccountId: payroll!.id, creditAccountId: cash!.id });
    firstMonth = addMonths(await forecastAsOfMonth(companyId, new Date()), 1);
    await refreshCurrentCalculationRun(companyId, { cause: { kind: "entity_changed", subjectType: "company", subjectId: companyId, actorUserId: null, via: "worker" } });
  });

  afterAll(async () => {
    if (companyId) await db.delete(companies).where(eq(companies.id, companyId));
    await closeDatabase();
  });

  it("previews an item confirmation exactly as it later lands", async () => {
    const [item] = await db.insert(economicItems).values({ companyId, type: "obligation", direction: "spend", label: "Rent", amount: "500", cadence: "monthly", effectiveFrom: firstMonth, status: "draft" }).returning({ id: economicItems.id });
    const preview = await previewForecastChange(companyId, { kind: "confirm_item", itemId: item!.id });
    await db.update(economicItems).set({ status: "confirmed" }).where(eq(economicItems.id, item!.id));
    await refreshCurrentCalculationRun(companyId, { cause: { kind: "item_confirmed", subjectType: "economic_item", subjectId: item!.id, actorUserId: null, via: "worker" } });
    expect(headline((await latest()).delta)).toEqual(headline(preview.consequence));
  });

  it("previews a decision exactly as it later lands", async () => {
    const effect = { kind: "add_item", item: { label: "Contractor", direction: "spend", amount: 250, cadence: "monthly", effectiveFrom: firstMonth, category: "contractor", accountingTreatment: "cash" } };
    const [decision] = await db.insert(decisions).values({ companyId, question: "Hire a contractor?", answer: "Yes", status: "proposed", effect: JSON.stringify(effect) }).returning({ id: decisions.id });
    const preview = await previewForecastChange(companyId, { kind: "apply_decision", decisionId: decision!.id });
    await db.update(decisions).set({ status: "applied" }).where(eq(decisions.id, decision!.id));
    await applyDecisionIfEffective(companyId, decision!.id, null);
    await refreshCurrentCalculationRun(companyId, { cause: { kind: "decision_applied", subjectType: "decision", subjectId: decision!.id, actorUserId: null, via: "worker" } });
    expect(headline((await latest()).delta)).toEqual(headline(preview.consequence));
  });
});
```
If `decisions` has more required columns, add them to the insert using the values `api/decisions/route.ts` POST writes. The test's point is parity, not decision creation.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @finance/web test -- decision-driver-effects forecast-preview && pnpm --filter @finance/web typecheck`
Expected: PASS. Driver ids differ between the preview (`decision:<id>`) and the persisted item (a uuid). That is why parity compares headline figures, not `drivers`.

- [ ] **Step 6: Commit**
```bash
git add apps/web/src
git commit -m "Preview the forecast consequence of confirming an item or applying a decision

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Pin as plan

**Files:**
- Create: `apps/web/src/lib/forecast-plan-pin.ts`, `apps/web/src/lib/forecast-plan-pin.test.ts`
- Modify: `apps/web/src/app/api/forecast-projections/apply/route.ts` (becomes a thin wrapper)
- Modify: `apps/web/src/components/forecast-projections-panel.tsx`, `apps/web/src/components/accounting-modal.tsx:67`

**Interfaces:**
- Consumes: `loadForecastDrivers`, `buildProjectedEntries`, `postApprovedJournal` (with `deferRefresh`), and `refreshCurrentCalculationRun`.
- Produces: `pinForecastAsPlan(companyId: string, input: { start: string; end: string; scenarioId?: string; actorUserId: string | null; baseCurrency: string }): Promise<{ posted: number; idempotent: number; reversed: number; exceptions: { driverId: string; reason: string }[]; calculationRun: Awaited<ReturnType<typeof refreshCurrentCalculationRun>> | null }>`

- [ ] **Step 1: Write the failing DB-backed test**

`apps/web/src/lib/forecast-plan-pin.test.ts`:
```ts
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: fileURLToPath(new URL("../../../../.env.local", import.meta.url)) });
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!process.env.DATABASE_URL)("pin forecast as plan", async () => {
  if (!process.env.DATABASE_URL) return; // skipped suites still run their factory
  const { chartAccounts, closeDatabase, companies, economicItems, forecastEntryTemplates, getDatabase, journalEntries, policies } = await import("@finance/database");
  const { pinForecastAsPlan } = await import("./forecast-plan-pin");
  const db = getDatabase();
  let companyId = "";
  const revision = async () => (await db.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, companyId)))[0]!.revision;

  beforeAll(async () => {
    const [company] = await db.insert(companies).values({ name: `Plan pin ${Date.now()}` }).returning({ id: companies.id });
    companyId = company!.id;
    const [cash, payroll] = await db.insert(chartAccounts).values([
      { companyId, code: "1000", name: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" },
      { companyId, code: "6000", name: "Payroll", accountType: "expense", normalBalance: "debit" },
    ]).returning({ id: chartAccounts.id });
    const [policy] = await db.insert(policies).values({ companyId, name: "Forecast payroll", rule: "Payroll is expensed monthly." }).returning({ id: policies.id });
    await db.insert(forecastEntryTemplates).values({ companyId, name: "Payroll", itemType: "obligation", direction: "spend", debitAccountId: payroll!.id, creditAccountId: cash!.id, policyId: policy!.id });
    await db.insert(economicItems).values({ companyId, type: "obligation", direction: "spend", label: "Payroll", amount: "1000", cadence: "monthly", effectiveFrom: "2027-01", status: "confirmed" });
  });

  afterAll(async () => {
    if (companyId) await db.delete(companies).where(eq(companies.id, companyId));
    await closeDatabase();
  });

  it("posts plan-basis journals and advances the revision exactly once", async () => {
    const before = BigInt(await revision());
    const result = await pinForecastAsPlan(companyId, { start: "2027-01", end: "2027-03", actorUserId: null, baseCurrency: "USD" });
    expect(result.posted).toBe(3);
    expect(BigInt(await revision())).toBe(before + 1n);
    const entries = await db.select({ basis: journalEntries.basis }).from(journalEntries).where(and(eq(journalEntries.companyId, companyId)));
    expect(entries.every((entry) => entry.basis === "plan")).toBe(true);
  });
});
```
Run: `pnpm --filter @finance/web test -- forecast-plan-pin`. Expected: FAIL (module not found).

- [ ] **Step 2: Extract and convert the pin logic**

Create `apps/web/src/lib/forecast-plan-pin.ts` by moving the body of `apps/web/src/app/api/forecast-projections/apply/route.ts` `POST`, from the scenario check through the posting loop, into this function. Make these changes:
```ts
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { buildProjectedEntries } from "@nevermodel/finance-engine";
import { getDatabase, journalBatches, journalEntries, journalLines, scenarios } from "@finance/database";
import { loadForecastDrivers } from "@/lib/forecast-inputs";
import { postApprovedJournal } from "@/lib/journal-posting";
import { refreshCurrentCalculationRun } from "@/lib/refresh-calculation-run";

/**
 * Freeze the current projection as plan-basis journals for later
 * variance-to-plan work. The live forecast never reads these entries.
 */
export async function pinForecastAsPlan(companyId: string, input: { start: string; end: string; scenarioId?: string; actorUserId: string | null; baseCurrency: string }) {
  const db = getDatabase();
  if (input.scenarioId && !(await db.select({ id: scenarios.id }).from(scenarios).where(and(eq(scenarios.id, input.scenarioId), eq(scenarios.companyId, companyId))).limit(1))[0]) throw new Error("Scenario not found");
  const { drivers, templates } = await loadForecastDrivers(companyId, input.scenarioId ? { scenarioId: input.scenarioId } : {});
  const projection = buildProjectedEntries(drivers, templates, { start: input.start, end: input.end }, input.scenarioId);
  // … the existing loop, with these changes:
}
```
Changes inside the moved loop:
1. `context.company.id` → `companyId`; `context.company.baseCurrency` → `input.baseCurrency`; `templateById` is built from `templates`.
2. The prior-version lookup `where` matches both legacy and new pins. Replace `eq(journalEntries.basis, entry.basis)` and `eq(journalBatches.source, "forecast_projection")` with:
   ```ts
   inArray(journalEntries.basis, ["forecast", "plan"]), inArray(journalBatches.source, ["forecast_projection", "forecast_plan_pin"])
   ```
3. Both `postApprovedJournal` calls use `basis: "plan"` and `deferRefresh: true`, and include `...(input.actorUserId ? { actorUserId: input.actorUserId } : {})`. The reversal keeps `source: "forecast_projection_reversal"`, and the pin uses `source: "forecast_plan_pin"`.
4. After the loop:
   ```ts
   const changed = results.some((result) => !result.idempotent) || reversed > 0;
   const calculationRun = changed ? await refreshCurrentCalculationRun(companyId, { cause: { kind: "plan_pinned", subjectType: "forecast_plan", subjectId: `${input.start}..${input.end}`, actorUserId: input.actorUserId, via: input.actorUserId ? "ui" : "worker" } }) : null;
   return { posted: results.length, idempotent: results.filter((result) => result.idempotent).length, reversed, exceptions: projection.exceptions, calculationRun };
   ```
   Because no posting period is passed, the refresh re-queues every posted period. That is acceptable for a pin.

Rewrite `apps/web/src/app/api/forecast-projections/apply/route.ts`:
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { pinForecastAsPlan } from "@/lib/forecast-plan-pin";

const body = z.object({ start: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), end: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), scenarioId: z.string().uuid().optional() });

/** Pin the current projection as a plan. The live forecast is derived and never reads these entries. */
export async function POST(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess(); const parsed = body.safeParse(await request.json());
  if (!parsed.success || parsed.data.start > parsed.data.end) return NextResponse.json({ error: "start and end must be an ordered YYYY-MM range" }, { status: 400 });
  try {
    return NextResponse.json(await pinForecastAsPlan(context.company.id, { start: parsed.data.start, end: parsed.data.end, ...(parsed.data.scenarioId ? { scenarioId: parsed.data.scenarioId } : {}), actorUserId: context.user.id, baseCurrency: context.company.baseCurrency }));
  } catch (error) {
    if (error instanceof Error && error.message === "Scenario not found") return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
```

- [ ] **Step 3: Rename in the UI**

- In `apps/web/src/components/accounting-modal.tsx:67`, change the `forecastEntries` tab label to `"Pin as plan"`.
- In `apps/web/src/components/forecast-projections-panel.tsx`:
  - Change the apply button's visible text to `Pin as plan`.
  - Add a one-line description under the panel heading: `Freezes these projected entries as a plan for later comparison. The live forecast updates on its own.`
  - Change the `Entry` type's `basis` to `"forecast" | "scenario" | "plan"`.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @finance/web test -- forecast-plan-pin && pnpm --filter @finance/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src
git commit -m "Turn apply projections into pin as plan with a single revision

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: UI, including consequence lines, runway, what changed, and the minimum cash setting

**Files:**
- Create: `apps/web/src/lib/consequence-copy.ts`, `apps/web/src/lib/consequence-copy.test.ts`
- Create: `apps/web/src/components/forecast-consequence-line.tsx`, `apps/web/src/components/forecast-what-changed.tsx`
- Create: `apps/web/src/app/api/forecast/settings/route.ts`
- Modify: `apps/web/src/components/app-shell.tsx` (state near line 485, fetch at ~776, draft item rows at ~1590-1606, decision rows at ~1615-1625, figures at ~1749)
- Modify: `apps/web/src/components/company-settings-dialog.tsx`

**Interfaces:**
- Consumes: `ForecastConsequence`, `ForecastRunway`, `ConsequenceCause`, and `/api/forecast/preview`, `/api/forecast/consequences`, `/api/journal-financials`.
- Produces:
  - `describeConsequence(consequence: ForecastConsequence | null, exceptionsAfter?: number): string`
  - `describeCause(cause: { kind: string; subjectLabel: string | null }): string`
  - `GET/PATCH /api/forecast/settings` → `{ minimumCash: number }` (major units)

- [ ] **Step 1: Write failing copy tests**

`apps/web/src/lib/consequence-copy.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { ForecastConsequence } from "@nevermodel/finance-engine";
import { describeCause, describeConsequence } from "./consequence-copy";

const base: ForecastConsequence = {
  asOfMonth: { before: "2026-08", after: "2026-08" }, cash: [], horizonEndCash: { month: "2028-08", beforeMinor: "0", afterMinor: "12000000", deltaMinor: "12000000" },
  cashOutMonth: { before: "2028-03", after: null }, runwayMonths: { before: 14, after: null },
  projectedReceipts: { beforeMinor: "0", afterMinor: "12000000", deltaMinor: "12000000" }, projectedSpending: { beforeMinor: "0", afterMinor: "0", deltaMinor: "0" },
  drivers: { added: [], removed: [], changed: [] }, exceptions: { before: 0, after: 0 },
};

describe("consequence copy", () => {
  it("summarizes cash, runway, and cash-out", () => {
    expect(describeConsequence(base)).toBe("Aug 2028 ending cash +$120k · runway 14 mo → beyond horizon · cash-out Mar 2028 → none");
  });
  it("formats small and negative deltas", () => {
    expect(describeConsequence({ ...base, horizonEndCash: { ...base.horizonEndCash, deltaMinor: "-150000" }, runwayMonths: { before: 14, after: 14 }, cashOutMonth: { before: null, after: null } })).toBe("Aug 2028 ending cash −$1.5k");
    expect(describeConsequence({ ...base, horizonEndCash: { ...base.horizonEndCash, deltaMinor: "95000" }, runwayMonths: { before: 3, after: 3 }, cashOutMonth: { before: null, after: null } })).toBe("Aug 2028 ending cash +$950");
  });
  it("says when nothing moves and when drivers are excluded", () => {
    expect(describeConsequence(null)).toBe("No forecast effect");
    expect(describeConsequence(null, 2)).toBe("No forecast effect · 2 drivers excluded");
  });
  it("describes causes", () => {
    expect(describeCause({ kind: "item_confirmed", subjectLabel: "Acme retainer" })).toBe("Confirmed Acme retainer");
    expect(describeCause({ kind: "period_closed", subjectLabel: null })).toBe("Closed a period");
  });
});
```
Run: `pnpm --filter @finance/web test -- consequence-copy`. Expected: FAIL.

- [ ] **Step 2: Implement copy**

`apps/web/src/lib/consequence-copy.ts`:
```ts
import type { ForecastConsequence } from "@nevermodel/finance-engine";

const monthName = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const signedMoney = (minor: string) => {
  const value = BigInt(minor); const dollars = Number((value < 0n ? -value : value) / 100n);
  const text = dollars >= 1000 ? `$${(dollars / 1000).toFixed(dollars >= 100_000 ? 0 : 1).replace(/\.0$/, "")}k` : `$${dollars}`;
  return `${value < 0n ? "−" : "+"}${text}`;
};
const runway = (months: number | null) => (months === null ? "beyond horizon" : `${months} mo`);

/** One line a CFO can read before approving: the horizon-end cash change, runway, and cash-out month. */
export function describeConsequence(consequence: ForecastConsequence | null, exceptionsAfter = 0): string {
  const parts: string[] = [];
  if (consequence) {
    if (consequence.horizonEndCash.deltaMinor !== "0") parts.push(`${monthName(consequence.horizonEndCash.month)} ending cash ${signedMoney(consequence.horizonEndCash.deltaMinor)}`);
    if (consequence.runwayMonths.before !== consequence.runwayMonths.after) parts.push(`runway ${runway(consequence.runwayMonths.before)} → ${runway(consequence.runwayMonths.after)}`);
    if (consequence.cashOutMonth.before !== consequence.cashOutMonth.after) parts.push(`cash-out ${consequence.cashOutMonth.before ? monthName(consequence.cashOutMonth.before) : "none"} → ${consequence.cashOutMonth.after ? monthName(consequence.cashOutMonth.after) : "none"}`);
  }
  const head = parts.length ? parts.join(" · ") : "No forecast effect";
  return exceptionsAfter > 0 ? `${head} · ${exceptionsAfter} driver${exceptionsAfter === 1 ? "" : "s"} excluded` : head;
}

const verbs: Record<string, [string, string]> = {
  evidence_published: ["Published", "evidence"], evidence_revoked: ["Revoked", "evidence"], evidence_reprocessed: ["Reprocessed", "evidence"],
  item_confirmed: ["Confirmed", "an item"], item_rejected: ["Rejected", "an item"], item_edited: ["Edited", "an item"], item_created: ["Added", "an item"],
  decision_applied: ["Applied", "a decision"], journal_posted: ["Posted", "a journal entry"], journal_reversed: ["Reversed", "a journal entry"],
  period_closed: ["Closed", "a period"], period_reopened: ["Reopened", "a period"], fx_changed: ["Changed", "FX rates"], entity_changed: ["Changed", "an entity"],
  allocation_changed: ["Changed", "an allocation"], mapping_approved: ["Approved", "a mapping"], plan_pinned: ["Pinned", "a plan"], settings_changed: ["Changed", "forecast settings"],
};

export function describeCause(cause: { kind: string; subjectLabel: string | null }): string {
  const [verb, noun] = verbs[cause.kind] ?? ["Changed", "the books"];
  return `${verb} ${cause.subjectLabel ?? noun}`;
}
```
Run: `pnpm --filter @finance/web test -- consequence-copy`. Expected: PASS.

- [ ] **Step 3: Components**

`apps/web/src/components/forecast-consequence-line.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";
import { describeConsequence } from "@/lib/consequence-copy";

type PreviewRequest = { kind: "confirm_item"; itemId: string } | { kind: "apply_decision"; decisionId: string };

/** "Forecast: …" under a pending approval, computed by the read-only preview endpoint. */
export function ForecastConsequenceLine({ request }: { request: PreviewRequest }) {
  const [text, setText] = useState<string | null>(null);
  const key = JSON.stringify(request);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/forecast/preview", { method: "POST", headers: { "content-type": "application/json" }, body: key })
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => { if (!cancelled) setText(result ? result.note ?? describeConsequence(result.consequence, result.exceptionsAfter) : null); })
      .catch(() => { if (!cancelled) setText(null); });
    return () => { cancelled = true; };
  }, [key]);
  if (!text) return null;
  return <div className="mt-0.5 text-[13px] text-pencil">Forecast: {text}</div>;
}
```

`apps/web/src/components/forecast-what-changed.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";
import type { ForecastConsequence } from "@nevermodel/finance-engine";
import { describeCause, describeConsequence } from "@/lib/consequence-copy";

type Row = { id: string; createdAt: string; delta: ForecastConsequence; causes: { kind: string; subjectLabel: string | null }[] };

/** The latest forecast consequences, each with what caused it. `refreshKey` changes when a new forecast revision lands. */
export function ForecastWhatChanged({ refreshKey }: { refreshKey: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/forecast/consequences?limit=5").then((response) => (response.ok ? response.json() : { consequences: [] })).then((result) => { if (!cancelled) setRows(result.consequences ?? []); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [refreshKey]);
  if (!rows.length) return null;
  return (
    <section className="border-b border-rule py-4">
      <div className="pb-2 text-[12px] uppercase tracking-[0.12em] text-ink-2">What changed</div>
      {rows.map((row) => (
        <div className="grid gap-0.5 border-t border-rule py-2.5 text-[13px]" key={row.id}>
          <span className="text-ink">{describeConsequence(row.delta, row.delta.exceptions.after)}</span>
          <span className="text-pencil">{row.causes.map(describeCause).join(" · ")} · {new Date(row.createdAt).toLocaleString()}</span>
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 4: Wire into `app-shell.tsx`**

1. Imports: `ForecastConsequenceLine`, `ForecastWhatChanged`, and `type ForecastRunway` from `@nevermodel/finance-engine`.
2. State, next to `const [forecast, setForecast]` (~line 485):
   ```tsx
   const [runway, setRunway] = useState<(ForecastRunway & { revision: string; horizonEnd: string; stale: boolean; exceptions: number }) | null>(null);
   ```
3. In `loadForecast` (~line 776), after `if (payload?.months) { … }`, add `setRunway(payload?.runway ?? null);`.
4. In the draft item row (~1600), after the `{item.sourceName && …}` line, add:
   ```tsx
   <ForecastConsequenceLine request={{ kind: "confirm_item", itemId: item.id }} />
   ```
5. In the decision row (~1620), after the `If applied:` line, add:
   ```tsx
   <ForecastConsequenceLine request={{ kind: "apply_decision", decisionId: decision.id }} />
   ```
6. Change the figures grid class `sm:grid-cols-4` (~1749) to `sm:grid-cols-5`, and add a fifth `Figure` after "Cash":
   ```tsx
   <Figure
     label="Runway"
     value={runway ? (runway.runwayMonths === null ? `> ${runway.horizonMonths} mo` : `${runway.runwayMonths} mo`) : "—"}
     note={runway ? `${runway.cashOutMonth ? `Cash-out ${monthLabel(runway.cashOutMonth)}` : "No cash-out in horizon"}${BigInt(runway.trailingBurn3mMinor) > 0n ? ` · burn ${money(Number(runway.trailingBurn3mMinor) / 100)}/mo` : ""}${runway.cashOverTrailingBurn ? ` · ${runway.cashOverTrailingBurn}× burn` : ""}${runway.stale ? " · updating" : ""}` : "Forecast not calculated yet"}
     pencil
     negative={Boolean(runway?.runwayMonths !== null && runway?.runwayMonths !== undefined && runway.runwayMonths < 6)}
   />
   ```
7. Directly below the figures grid's closing `</div>`, add `{runway && <ForecastWhatChanged refreshKey={runway.revision} />}`.

- [ ] **Step 5: Minimum cash setting**

`apps/web/src/app/api/forecast/settings/route.ts`:
```ts
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { companies, getDatabase } from "@finance/database";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { amountToMinor } from "@/lib/forecast-drivers";
import { refreshCurrentCalculationRun } from "@/lib/refresh-calculation-run";

export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const [company] = await getDatabase().select({ minimumCashMinor: companies.minimumCashMinor }).from(companies).where(eq(companies.id, context.company.id)).limit(1);
  return NextResponse.json({ minimumCash: Number(company?.minimumCashMinor ?? "0") / 100 });
}

/** The cash floor that defines the forecast's cash-out month. Changing it is a revision with its own consequence. */
export async function PATCH(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  if (context.company.role !== "owner") return NextResponse.json({ error: "Only the company owner can change forecast settings" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { minimumCash?: unknown };
  const minor = typeof body.minimumCash === "number" && body.minimumCash >= 0 ? amountToMinor(body.minimumCash.toFixed(2)) : "";
  if (!minor) return NextResponse.json({ error: "Minimum cash must be zero or a positive amount" }, { status: 400 });
  await getDatabase().update(companies).set({ minimumCashMinor: minor, updatedAt: new Date() }).where(eq(companies.id, context.company.id));
  const calculationRun = await refreshCurrentCalculationRun(context.company.id, { cause: { kind: "settings_changed", subjectType: "company", subjectId: context.company.id, actorUserId: context.user.id, via: "ui" } });
  return NextResponse.json({ minimumCash: Number(minor) / 100, calculationRun });
}
```

In `apps/web/src/components/company-settings-dialog.tsx`:
- Add `useEffect` to the React import and state `const [minimumCash, setMinimumCash] = useState("0");`.
- Add this effect:
  ```tsx
  useEffect(() => {
    if (!open) return;
    fetch("/api/forecast/settings").then((response) => (response.ok ? response.json() : null)).then((result) => { if (result) setMinimumCash(String(result.minimumCash)); }).catch(() => undefined);
  }, [open]);
  ```
- In `save()`, before `onOpenChange(false)`, add:
  ```tsx
  const floor = Number(minimumCash);
  if (!Number.isFinite(floor) || floor < 0) throw new Error("Minimum cash must be zero or a positive amount");
  const settings = await fetch("/api/forecast/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ minimumCash: floor }) });
  if (!settings.ok) throw new Error((await settings.json()).error ?? "Unable to save the minimum cash setting");
  ```
- After the Base currency `<label>`, add:
  ```tsx
  <label className="grid gap-1.5 text-[13px] text-ink-2">
    Minimum cash for runway
    <Input value={minimumCash} onChange={(event) => setMinimumCash(event.target.value)} inputMode="decimal" className="max-w-[160px]" />
  </label>
  ```

- [ ] **Step 6: Verify in the running app**

Run: `pnpm --filter @finance/web typecheck && pnpm --filter @finance/web test`, then `pnpm dev`.

Manual check against a company with a cash balance and one forecast template:
1. The dashboard shows a Runway figure.
2. A draft item shows a "Forecast: …" line.
3. Confirm it. After reload, "What changed" lists it as "Confirmed <label>".
4. Setting minimum cash in Company settings changes the runway and adds a "Changed forecast settings" entry.

Report which of these you saw.

- [ ] **Step 7: Commit**
```bash
git add apps/web/src
git commit -m "Show forecast consequences before approval, runway, and what changed

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Accounting eval

**Files:**
- Modify: `packages/accounting-evals/src/index.ts`

**Interfaces:**
- Consumes: `buildForecastRun`, `diffForecastRuns`.

- [ ] **Step 1: Add the eval (fails until imports resolve)**

In `packages/accounting-evals/src/index.ts`, add `buildForecastRun, diffForecastRuns` to the `@nevermodel/finance-engine` import. Insert this after the `forecast-is-a-balanced-journal-overlay-before-close` eval:
```ts
  {
    id: "confirming-a-contract-extends-runway-with-attribution",
    stage: "forecasting",
    reason: "A confirmed contract must move the forward runway, and the consequence must trace back to the evidence behind it.",
    execute: () => {
      const accounts = [
        { accountId: "1000", accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit" as const, statementLine: "Cash" },
        { accountId: "3000", accountCode: "3000", accountName: "Capital", accountType: "equity", normalBalance: "credit" as const },
        { accountId: "4000", accountCode: "4000", accountName: "Revenue", accountType: "revenue", normalBalance: "credit" as const },
        { accountId: "6000", accountCode: "6000", accountName: "Payroll", accountType: "expense", normalBalance: "debit" as const },
      ];
      const actualLines = [{ ...line("capital", "1000", "asset", "debit", "300000", "0", "2026-08"), accountName: "Cash", statementLine: "Cash" }, line("capital-equity", "3000", "equity", "credit", "0", "300000", "2026-08")];
      const templates = [{ id: "spend", itemType: "obligation" as const, direction: "spend" as const, debitAccountId: "6000", creditAccountId: "1000" }, { id: "receipt", itemType: "agreement" as const, direction: "receipt" as const, debitAccountId: "1000", creditAccountId: "4000" }];
      const payroll = { id: "payroll", label: "Payroll", itemType: "obligation" as const, direction: "spend" as const, amountMinor: "100000", cadence: "monthly" as const, effectiveFrom: "2026-09" };
      const contract = { id: "contract", label: "Acme retainer", itemType: "agreement" as const, direction: "receipt" as const, amountMinor: "100000", cadence: "monthly" as const, effectiveFrom: "2026-09", evidenceId: "ev-acme" };
      const input = { actualLines, templates, accounts, currency: "USD", asOfMonth: "2026-08", horizonMonths: 24, minimumCashMinor: "0" };
      const before = buildForecastRun({ ...input, drivers: [payroll] });
      const consequence = diffForecastRuns(before, buildForecastRun({ ...input, drivers: [payroll, contract] }));
      return [
        before.runway.runwayMonths === 4 ? "" : "Payroll against 3,000 of cash did not produce a four-month runway.",
        consequence?.runwayMonths.after === null ? "" : "A contract that covers payroll did not extend runway beyond the horizon.",
        consequence?.drivers.added[0]?.evidenceId === "ev-acme" ? "" : "The runway consequence lost its link to the contract evidence.",
      ];
    },
  },
```
The eval file's `line` helper sets `accountName` to the account id. The cash line overrides `accountName` and `statementLine`, so the cash rule matches. The trailing `period` argument is supported by `line`.

- [ ] **Step 2: Run evals**

Run: `pnpm --filter @nevermodel/accounting-evals test`
Expected: PASS. Cash 300,000 minus 100,000 a month first goes below zero at month 4, 2026-12.

- [ ] **Step 3: Commit**
```bash
git add packages/accounting-evals/src/index.ts
git commit -m "Eval: a confirmed contract extends runway with evidence attribution

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Full verification

- [ ] **Step 1:** Run `pnpm test && pnpm -r typecheck`. Expected: all packages pass. DB-backed suites run when `DATABASE_URL` is set, so set it.
- [ ] **Step 2:** Run `pnpm --filter @finance/database db:doctor` if the repo's doctor checks migrations. Expected: clean.
- [ ] **Step 3:** Search for leftovers: `rg "forecast_projection\"" apps/web/src` should only match the pin's legacy lookup. `rg "cashMinor\(" apps/web/src` should return nothing.
- [ ] **Step 4:** Write a summary of what was verified manually in Task 11 Step 6 into the PR description.
