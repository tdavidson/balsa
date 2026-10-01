# Forecast Scenarios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the CFO save named sets of hypothetical driver changes (scenarios), see each one's runway, net cash bars, and consequence against the base forecast on the dashboard, promote a scenario into proposed decisions, turn a proposed decision into a scenario, and let the agent's `simulate` tool answer what-if questions. All of it runs on the existing engine (`buildForecastRun` + `diffForecastRuns`), and nothing about a scenario is persisted as a forecast run.

**Architecture:**
- A pure module, `scenario-changes.ts`, defines `ScenarioChange`, its zod schema, and the mapping to and from `DecisionEffect`. `applyScenarioChanges` maps each change to a `DecisionEffect` and runs `projectDecisionEffectOnDrivers`, so scenarios and decision previews share one implementation. `runSimulation` builds the base and changed runs from one input and diffs them.
- The stored-input-or-full-load logic in `forecast-preview.ts` moves to `forecast-base.ts` as `loadForecastBase`. The preview, the scenario forecast, and the agent all use it.
- `scenarios.ts` (server) holds scenario CRUD, promotion, and creation from a decision, with company scoping and typed errors. `forecast-scenarios.ts` (server) computes a scenario's forecast and the agent's `simulate` result.
- Thin API routes live under `/api/scenarios`. The dashboard gets a scenario switcher, a scenario Runway figure, a "Scenario vs base" line, outlined overlay bars, an editor dialog, "Promote to proposals", and "Try as scenario" on proposed decisions.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Next.js 16 app router, React 19, zod 4, Drizzle ORM 0.45 on postgres-js, vitest, pnpm workspaces.

**Spec:** `internal/specs/2026-09-18-forecast-scenarios-design.md` (builds on forecast consequences, Group B performance/concurrency, and C1 traceability `internal/specs/2026-09-18-consequence-traceability-design.md`).

**Precondition:** The C1 traceability work has landed. `apps/web/src/lib/consequence-copy.ts` exports `ConsequenceSource = { evidenceId: string; sourceName: string | null }` and `describeSources`. `apps/web/src/lib/forecast-read.ts` contains the private helper `driverEvidenceIds(delta: ForecastConsequence): string[]`. `ForecastConsequenceLine` and `ForecastWhatChanged` take `onOpenEvidence`, and `app-shell.tsx` has `const openEvidence = useCallback(...)`. Before Task 1, run `grep -n "driverEvidenceIds\|export type ConsequenceSource" apps/web/src/lib/forecast-read.ts apps/web/src/lib/consequence-copy.ts` and confirm both are present. If `driverEvidenceIds` has a different name, use that name wherever this plan says `driverEvidenceIds`.

## Global Constraints

- Work in `/Users/taylordavidson/Documents/GitHub/balsa` on branch `feature/forecast-consequences`. Commit there and do not push. End every commit message with a trailer that names the implementing model, for example `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. Implementers do not spawn subagents.
- TypeScript is strict with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`. Build optional properties with conditional spreads, and never assign `undefined` to an optional property.
- Pure modules have no `server-only` import and no DB access, and they get unit tests. Server modules start with `import "server-only"`. The apps/web vitest config aliases `@` to `src` and stubs `server-only`.
- DB-backed tests follow `apps/web/src/lib/forecast-job.test.ts`:
  - Load dotenv from the repo root (`.env.local`, then `.env`), and let `TEST_DATABASE_URL` override `DATABASE_URL`.
  - Use `describe.skipIf(!process.env.DATABASE_URL)`, with `if (!process.env.DATABASE_URL) return;` at the top of the factory.
  - Create and delete their own companies.
  - Run against the local dev DB, which is approved.
- Company-scope every query. Money is minor units as strings, or `bigint` during math. Scenario change `amount`s are dollars as numbers, exactly like `DecisionEffect` amounts, so that promotion is lossless. They become minor units only through `amountToMinor`.
- Nothing inside `runForecastJob`'s transaction may call `getDatabase()`. This plan does not touch that job.
- Migrations are handwritten SQL plus a `packages/database/drizzle/meta/_journal.json` entry. This plan uses **0074** (`idx` 74, `when` 1789300000037). The later C3 feature takes the next free number after it. Apply with `pnpm --filter @finance/database db:migrate`. No destructive SQL. No new tables, so RLS is unchanged (`scenarios` already has `scenarios_company_scope` from 0070).
- Verify before every commit:
  - `pnpm --filter @balsa/finance-engine test`
  - `pnpm --filter @finance/web test` (the DB suites must run, not skip)
  - `pnpm -r typecheck`
  - `pnpm --filter @finance/web lint`: the baseline is 10 errors / 13 warnings. Record the counts before Task 1, in case C1 changed them, and add none.
- Update the spec when behavior differs from it (Task 6 records the planning rulings).
- Binding values from the spec:
  - The three change kinds are `add_driver`, `change_amount`, and `end_item`. "Remove" is `end_item` at the forecast as-of.
  - Added drivers get the id `scenario:<scenarioId>:<index>`.
  - A scenario run uses base drivers, plus that scenario's **confirmed** items, plus its `changes`, in that order.
  - Scenario runs are never persisted or versioned. Scenario edits never bump the financial-state revision (never call `refreshCurrentCalculationRun` from scenario code).
  - Names are unique among **active** scenarios per company, and a duplicate gets 409. `DELETE` soft-deactivates (`active = 'N'`).
  - Promotion creates proposed decisions only, with the question `Apply from scenario <name>: <description>`. Nothing applies automatically.
  - The switcher never changes the Cash, Cash in, Cash out, or Net figures. Only Runway, the overlay bars, and the "Scenario vs base" line reflect the scenario.
  - The agent's `simulate` writes nothing.

Commands:
- Engine: `pnpm --filter @balsa/finance-engine test`
- Web (one file): `pnpm --filter @finance/web test -- <file-stem>`
- Web (all): `pnpm --filter @finance/web test`
- `pnpm -r typecheck`
- `pnpm --filter @finance/web lint`
- Migrate: `pnpm --filter @finance/database db:migrate`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `apps/web/src/lib/scenario-changes.ts` | create (pure) | `ScenarioChange` type and zod schema, `parseScenarioChange(s)`, `parseStoredChanges`, `scenarioChangeFromFlat`, `scenarioChangeToEffect`, `effectToScenarioChange`, `describeScenarioChange`, `scenarioDriverId`, `applyScenarioChanges`, `runSimulation`, and the view types `ScenarioSummary`, `ScenarioDetail`, `ScenarioForecastView` |
| `apps/web/src/lib/scenario-changes.test.ts` | create | Unit tests covering each kind, ordering, parity with `projectDecisionEffectOnDrivers`, parsing, mapping, and simulation |
| `apps/web/src/test/forecast-fixture.ts` | create (test helper) | `fixtureBaseInput()` and `fixturePayroll`: 900,000 cash at 2026-08 and 100,000/month payroll |
| `packages/database/drizzle/0074_forecast_scenarios.sql` | create | Adds `scenarios.description` and `scenarios.changes` |
| `packages/database/drizzle/meta/_journal.json` | modify | Journal entry idx 74 |
| `packages/database/src/schema.ts` | modify | `scenarios` gains `description` and `changes` |
| `apps/web/src/lib/forecast-base.ts` | create (server) | `loadForecastBase(companyId, now)`, moved from `forecast-preview.ts` |
| `apps/web/src/lib/forecast-preview.ts` | modify | Uses `loadForecastBase`; the local copy is deleted |
| `apps/web/src/lib/forecast-read.ts` | modify | Exports `driverEvidenceIds` |
| `apps/web/src/lib/scenarios.ts` | create (server) | Errors, `loadActiveScenario` (Task 2), then the full CRUD, promote, and from-decision (Task 3) |
| `apps/web/src/lib/forecast-scenarios.ts` | create (server) | `loadScenarioForecast` (Task 2), and `simulateForAgent` (Task 4) |
| `apps/web/src/lib/forecast-scenarios.test.ts` | create | DB tests for the scenario forecast |
| `apps/web/src/lib/scenarios.test.ts` | create | DB tests for CRUD, scoping, promote parity, from-decision round trip |
| `apps/web/src/lib/forecast-scenarios.simulate.test.ts` | create | Unit test of `simulateForAgent` with a stubbed base |
| `apps/web/src/lib/decision-effects.ts` | modify | An `add_item` with a scenario name matches only **active** scenarios |
| `apps/web/src/lib/scenario-http.ts` | create (server) | `scenarioErrorResponse`, which maps the errors to 404/409/400 |
| `apps/web/src/app/api/scenarios/route.ts` | create | `GET` list, `POST` create |
| `apps/web/src/app/api/scenarios/[id]/route.ts` | create | `PATCH`, `DELETE` |
| `apps/web/src/app/api/scenarios/[id]/forecast/route.ts` | create | `GET` scenario forecast |
| `apps/web/src/app/api/scenarios/[id]/promote/route.ts` | create | `POST` promote |
| `apps/web/src/app/api/scenarios/from-decision/route.ts` | create | `POST` from a proposed decision |
| `apps/web/src/app/api/agent/route.ts` | modify | `simulate` re-enabled, saved scenarios added to the context, system prompt updated |
| `apps/web/src/components/scenario-editor-dialog.tsx` | create (client) | Create, edit, and delete a scenario, and add or remove changes |
| `apps/web/src/components/scenario-vs-base-line.tsx` | create (client) | The "Scenario vs base: …" line with source links |
| `apps/web/src/components/app-shell.tsx` | modify | Switcher, state, fetches, Runway figure, overlay bars, legend, actions, "Try as scenario", dialog mount |
| `internal/specs/2026-09-18-forecast-scenarios-design.md` | modify (Task 6) | Records the planning rulings |

---

### Task 1: Pure scenario changes, applier, and parity tests

**Files:**
- Create: `apps/web/src/test/forecast-fixture.ts`
- Create: `apps/web/src/lib/scenario-changes.ts`
- Test: `apps/web/src/lib/scenario-changes.test.ts`

**Interfaces:**
- Consumes:
  - `projectDecisionEffectOnDrivers(drivers: ForecastDriver[], effect: DecisionEffect, decisionId: string): ForecastDriver[]` (`@/lib/decision-driver-effects`)
  - `type DecisionEffect` (`@/lib/decision-effects`, type-only import)
  - `buildForecastRun`, `diffForecastRuns`, `categories`, and the types `Category`, `ForecastDriver`, `ForecastRunInput`, `ForecastRun`, `ForecastMonth`, `ForecastRunway`, `ForecastConsequence` (`@balsa/finance-engine`)
  - `type ConsequenceSource` (`@/lib/consequence-copy`)
- Produces:
  - `type ScenarioChange = { kind: "add_driver"; label: string; direction: "receipt" | "spend"; amount: number; cadence: "once" | "monthly" | "quarterly" | "annual"; effectiveFrom: string; effectiveTo?: string; category?: Category } | { kind: "change_amount"; itemId: string; amount: number; effectiveFrom: string } | { kind: "end_item"; itemId: string; effectiveTo: string }`
  - `scenarioChangeSchema` (zod discriminated union)
  - `parseScenarioChange(value: unknown): ScenarioChange | null`
  - `parseScenarioChanges(value: unknown): ScenarioChange[] | null`, which is strict: any invalid entry returns null
  - `parseStoredChanges(value: unknown): ScenarioChange[]`, which is lenient: invalid entries are dropped
  - `scenarioChangeFromFlat(value: unknown): ScenarioChange | null`, which drops null-valued keys and then parses
  - `scenarioChangeToEffect(change: ScenarioChange): DecisionEffect`
  - `effectToScenarioChange(effect: DecisionEffect | undefined): ScenarioChange | null`
  - `describeScenarioChange(change: ScenarioChange, itemLabel?: string): string`
  - `scenarioDriverId(scenarioId: string, index: number): string`
  - `applyScenarioChanges(drivers: ForecastDriver[], changes: ScenarioChange[], scenarioId: string): ForecastDriver[]`
  - `runSimulation(base: ForecastRunInput, changes: ScenarioChange[], options?: { scenarioId?: string; scenarioDrivers?: ForecastDriver[] }): { baseRun: ForecastRun; run: ForecastRun; consequence: ForecastConsequence | null }`
  - `type ScenarioSummary = { id: string; name: string; description: string | null; changeCount: number; itemCount: number }`
  - `type ScenarioDetail = { id: string; name: string; description: string | null; changes: ScenarioChange[]; itemCount: number }`
  - `type ScenarioForecastView = { scenario: ScenarioDetail; months: ForecastMonth[]; runway: ForecastRunway; consequence: ForecastConsequence | null; exceptions: ForecastRun["exceptions"]; sources: ConsequenceSource[] }`

- [ ] **Step 1: Create the shared test fixture.** `apps/web/src/test/forecast-fixture.ts`:
```ts
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
```

- [ ] **Step 2: Write the failing tests.** `apps/web/src/lib/scenario-changes.test.ts`:
```ts
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildForecastRun, type ForecastDriver } from "@balsa/finance-engine";
import { fixtureBaseInput, fixturePayroll } from "@/test/forecast-fixture";
import { projectDecisionEffectOnDrivers } from "./decision-driver-effects";
import {
  applyScenarioChanges, describeScenarioChange, effectToScenarioChange, parseScenarioChange, parseScenarioChanges, parseStoredChanges,
  runSimulation, scenarioChangeFromFlat, scenarioChangeToEffect, type ScenarioChange,
} from "./scenario-changes";

const payroll: ForecastDriver = { ...fixturePayroll, decisionId: "d0" };
const addContractor: ScenarioChange = { kind: "add_driver", label: "Contractor", direction: "spend", amount: 6000, cadence: "monthly", effectiveFrom: "2027-01", category: "contractor" };
const addGrant: ScenarioChange = { kind: "add_driver", label: "Grant", direction: "receipt", amount: 500, cadence: "monthly", effectiveFrom: "2026-09" };
const reprice: ScenarioChange = { kind: "change_amount", itemId: "payroll", amount: 1500.5, effectiveFrom: "2027-01" };
const end: ScenarioChange = { kind: "end_item", itemId: "payroll", effectiveTo: "2026-12" };
const endLater: ScenarioChange = { kind: "end_item", itemId: "payroll", effectiveTo: "2027-06" };

/** Scenario and decision drivers differ only in id prefix and lineage fields; strip those to compare semantics. */
const normalize = (drivers: ForecastDriver[]) => drivers.map((driver) => {
  const copy: Partial<ForecastDriver> = { ...driver, id: driver.id.replace(/^decision:/, "") };
  delete copy.decisionId;
  delete copy.scenarioId;
  return copy;
});
const project = (drivers: ForecastDriver[], changes: ScenarioChange[], scenarioId: string) =>
  changes.reduce<ForecastDriver[]>((current, change, index) => projectDecisionEffectOnDrivers(current, scenarioChangeToEffect(change), `scenario:${scenarioId}:${index}`), drivers);
const cash = (drivers: ForecastDriver[]) => {
  const run = buildForecastRun(fixtureBaseInput(drivers));
  return { months: run.months.map((month) => ({ month: month.month, endingCashMinor: month.endingCashMinor, receiptsMinor: month.receiptsMinor, spendingMinor: month.spendingMinor })), runway: run.runway };
};

describe("applyScenarioChanges", () => {
  it("adds a driver with a scenario id, the scenario, and no decision", () => {
    expect(applyScenarioChanges([payroll], [addContractor], "s1")[1]).toEqual({ id: "scenario:s1:0", label: "Contractor", itemType: "obligation", direction: "spend", category: "contractor", amountMinor: "600000", cadence: "monthly", effectiveFrom: "2027-01", scenarioId: "s1" });
  });

  it("defaults a missing category to other, as promotion will", () => {
    expect(applyScenarioChanges([], [addGrant], "s1")[0]).toMatchObject({ id: "scenario:s1:0", itemType: "agreement", category: "other", amountMinor: "50000" });
  });

  it("re-prices from a month, keeping the original's lineage and its decision", () => {
    const [original, copy] = applyScenarioChanges([payroll], [reprice], "s1");
    expect(original).toEqual({ ...payroll, effectiveTo: "2026-12" });
    expect(copy).toEqual({ ...fixturePayroll, id: "scenario:s1:0", amountMinor: "150050", effectiveFrom: "2027-01", scenarioId: "s1" });
  });

  it("ends an item without replacing its own decision lineage", () => {
    expect(applyScenarioChanges([payroll], [end], "s1")).toEqual([{ ...payroll, effectiveTo: "2026-12" }]);
    expect(applyScenarioChanges([fixturePayroll], [end], "s1")).toEqual([{ ...fixturePayroll, effectiveTo: "2026-12" }]);
  });

  it("applies changes in order and indexes added ids by position", () => {
    expect(applyScenarioChanges([payroll], [reprice, endLater], "s1").find((driver) => driver.id === "payroll")?.effectiveTo).toBe("2027-06");
    expect(applyScenarioChanges([payroll], [endLater, reprice], "s1").find((driver) => driver.id === "payroll")?.effectiveTo).toBe("2026-12");
    expect(applyScenarioChanges([payroll], [addContractor, addContractor], "s1").map((driver) => driver.id)).toEqual(["payroll", "scenario:s1:0", "scenario:s1:1"]);
  });

  it("leaves the drivers alone when a change's item is not in the forecast", () => {
    expect(applyScenarioChanges([payroll], [{ kind: "change_amount", itemId: "gone", amount: 10, effectiveFrom: "2027-01" }, { kind: "end_item", itemId: "gone", effectiveTo: "2027-01" }], "s1")).toEqual([payroll]);
  });
});

describe("parity with projectDecisionEffectOnDrivers", () => {
  it("matches the mapped decision effect for every kind", () => {
    for (const change of [addContractor, addGrant, reprice, end]) {
      expect(normalize(applyScenarioChanges([payroll], [change], "s1"))).toEqual(normalize(project([payroll], [change], "s1")));
    }
  });

  it("matches a sequence of mapped effects, and forecasts identical cash", () => {
    const sequence = [addContractor, reprice, endLater, addGrant];
    const scenario = applyScenarioChanges([payroll], sequence, "s1");
    const decisions = project([payroll], sequence, "s1");
    expect(normalize(scenario)).toEqual(normalize(decisions));
    expect(cash(scenario)).toEqual(cash(decisions));
  });
});

describe("scenario change mapping", () => {
  it("maps each change to the decision effect promotion proposes, and back", () => {
    expect(scenarioChangeToEffect(addContractor)).toEqual({ kind: "add_item", item: { label: "Contractor", direction: "spend", amount: 6000, cadence: "monthly", effectiveFrom: "2027-01", category: "contractor", accountingTreatment: "cash" } });
    expect(scenarioChangeToEffect(reprice)).toEqual({ kind: "change_amount", itemId: "payroll", amount: 1500.5, effectiveFrom: "2027-01" });
    expect(scenarioChangeToEffect(end)).toEqual({ kind: "end_item", itemId: "payroll", effectiveTo: "2026-12" });
    for (const change of [addContractor, reprice, end]) expect(effectToScenarioChange(scenarioChangeToEffect(change))).toEqual(change);
    expect(effectToScenarioChange({ kind: "set_category", entityId: randomUUID(), category: "software" })).toBeNull();
    expect(effectToScenarioChange(undefined)).toBeNull();
  });

  it("describes changes like decision effects, naming the item when known", () => {
    expect(describeScenarioChange(addContractor)).toBe("Adds an expense: Contractor $6,000 monthly from 2027-01");
    expect(describeScenarioChange({ ...addGrant, effectiveTo: "2027-08" })).toBe("Adds a receipt: Grant $500 monthly from 2026-09 to 2027-08");
    expect(describeScenarioChange(reprice, "Payroll")).toBe("Changes Payroll to $1,500.5 from 2027-01");
    expect(describeScenarioChange(end)).toBe("Ends an item after 2026-12");
  });
});

describe("parsing", () => {
  const itemId = randomUUID();

  it("accepts valid changes and normalizes them", () => {
    expect(parseScenarioChanges([
      { kind: "add_driver", label: " Grant ", direction: "receipt", amount: 500, cadence: "monthly", effectiveFrom: "2026-09" },
      { kind: "change_amount", itemId, amount: 12.5, effectiveFrom: "2027-01" },
      { kind: "end_item", itemId, effectiveTo: "2026-08" },
    ])).toEqual([
      { kind: "add_driver", label: "Grant", direction: "receipt", amount: 500, cadence: "monthly", effectiveFrom: "2026-09" },
      { kind: "change_amount", itemId, amount: 12.5, effectiveFrom: "2027-01" },
      { kind: "end_item", itemId, effectiveTo: "2026-08" },
    ]);
  });

  it("rejects bad months, amounts, cadences, categories, ids, kinds, and reversed ranges", () => {
    const driver = { kind: "add_driver", label: "X", direction: "spend", amount: 10, cadence: "monthly", effectiveFrom: "2026-09" };
    for (const bad of [
      { ...driver, effectiveFrom: "2026-13" }, { ...driver, amount: -10 }, { ...driver, amount: 10.555 }, { ...driver, effectiveTo: "2026-08" },
      { ...driver, cadence: "weekly" }, { ...driver, category: "rent" }, { ...driver, label: "  " },
      { kind: "change_amount", itemId: "payroll", amount: 10, effectiveFrom: "2026-09" }, { kind: "end_item", itemId, effectiveTo: "soon" }, { kind: "remove", itemId },
    ]) expect(parseScenarioChange(bad)).toBeNull();
    expect(parseScenarioChanges([{ kind: "end_item", itemId, effectiveTo: "2026-08" }, { kind: "remove" }])).toBeNull();
    expect(parseScenarioChanges("nope")).toBeNull();
  });

  it("reads stored changes leniently and flat agent changes with nulls", () => {
    expect(parseStoredChanges([{ kind: "end_item", itemId, effectiveTo: "2026-08" }, { kind: "remove" }])).toEqual([{ kind: "end_item", itemId, effectiveTo: "2026-08" }]);
    expect(parseStoredChanges(null)).toEqual([]);
    expect(scenarioChangeFromFlat({ kind: "add_driver", label: "Grant", direction: "receipt", amount: 500, cadence: "monthly", effectiveFrom: "2026-09", effectiveTo: null, category: null, itemId: null }))
      .toEqual({ kind: "add_driver", label: "Grant", direction: "receipt", amount: 500, cadence: "monthly", effectiveFrom: "2026-09" });
    expect(scenarioChangeFromFlat("add a grant")).toBeNull();
  });
});

describe("runSimulation", () => {
  it("diffs the changed forecast against the base built from the same input", () => {
    const { baseRun, run, consequence } = runSimulation(fixtureBaseInput(), [{ kind: "add_driver", label: "Retainer", direction: "receipt", amount: 500, cadence: "monthly", effectiveFrom: "2026-09" }], { scenarioId: "s1" });
    expect(baseRun.runway).toMatchObject({ runwayMonths: 9, cashOutMonth: "2027-06" });
    // 900,000 − 50,000·n < 0 first at n = 19: eighteen funded months, cash-out 2026-08 + 19 = 2028-03.
    expect(run.runway).toMatchObject({ runwayMonths: 18, cashOutMonth: "2028-03" });
    expect(consequence?.runwayMonths).toEqual({ before: 9, after: 18 });
    expect(consequence?.drivers.added.map((driver) => driver.id)).toEqual(["scenario:s1:0"]);
  });

  it("adds scenario items before the changes, and reports no consequence for no change", () => {
    const grant: ForecastDriver = { id: "grant", label: "Grant", itemType: "agreement", direction: "receipt", amountMinor: "50000", cadence: "monthly", effectiveFrom: "2026-09", scenarioId: "s1" };
    expect(runSimulation(fixtureBaseInput(), [], { scenarioId: "s1", scenarioDrivers: [grant] }).run.runway.runwayMonths).toBe(18);
    expect(runSimulation(fixtureBaseInput(), [{ kind: "end_item", itemId: "grant", effectiveTo: "2026-08" }], { scenarioId: "s1", scenarioDrivers: [grant] }).run.runway.runwayMonths).toBe(9);
    expect(runSimulation(fixtureBaseInput(), []).consequence).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests and verify they fail.** Run `pnpm --filter @finance/web test -- scenario-changes`. Expected: FAIL with `Failed to resolve import "./scenario-changes"`.

- [ ] **Step 4: Implement the module.** `apps/web/src/lib/scenario-changes.ts`:
```ts
import { z } from "zod";
import {
  buildForecastRun, categories, diffForecastRuns,
  type Category, type ForecastConsequence, type ForecastDriver, type ForecastMonth, type ForecastRun, type ForecastRunInput, type ForecastRunway,
} from "@balsa/finance-engine";
import type { ConsequenceSource } from "@/lib/consequence-copy";
import type { DecisionEffect } from "@/lib/decision-effects";
import { projectDecisionEffectOnDrivers } from "@/lib/decision-driver-effects";

/**
 * A scenario is a named, ordered list of hypothetical changes to the base
 * forecast's drivers. The three kinds mirror the decision effects, so each
 * change maps to exactly one `DecisionEffect`. That mapping is how a scenario
 * is applied (through `projectDecisionEffectOnDrivers`) and how it is promoted
 * into proposed decisions, so the two can never disagree. Amounts are dollars,
 * like decision effects. "Remove an item" is `end_item` at the forecast as-of.
 */
export type ScenarioChange =
  | { kind: "add_driver"; label: string; direction: "receipt" | "spend"; amount: number; cadence: "once" | "monthly" | "quarterly" | "annual"; effectiveFrom: string; effectiveTo?: string; category?: Category }
  | { kind: "change_amount"; itemId: string; amount: number; effectiveFrom: string }
  | { kind: "end_item"; itemId: string; effectiveTo: string };

export type ScenarioSummary = { id: string; name: string; description: string | null; changeCount: number; itemCount: number };
export type ScenarioDetail = { id: string; name: string; description: string | null; changes: ScenarioChange[]; itemCount: number };
/** What `GET /api/scenarios/[id]/forecast` returns: the scenario's forecast-basis months and runway, and its consequence versus the base. */
export type ScenarioForecastView = { scenario: ScenarioDetail; months: ForecastMonth[]; runway: ForecastRunway; consequence: ForecastConsequence | null; exceptions: ForecastRun["exceptions"]; sources: ConsequenceSource[] };

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
/** Positive dollars with at most two decimals, so `amountToMinor` never turns the amount into a driver exception. */
const dollars = z.number().positive().refine((value) => /^\d+(?:\.\d{1,2})?$/.test(String(value)), "At most two decimal places");
const cadence = z.enum(["once", "monthly", "quarterly", "annual"]);

export const scenarioChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add_driver"), label: z.string().trim().min(1).max(200), direction: z.enum(["receipt", "spend"]), amount: dollars, cadence, effectiveFrom: month, effectiveTo: month.optional(), category: z.enum(categories).optional() }),
  z.object({ kind: z.literal("change_amount"), itemId: z.string().uuid(), amount: dollars, effectiveFrom: month }),
  z.object({ kind: z.literal("end_item"), itemId: z.string().uuid(), effectiveTo: month }),
]);

/** One change, validated and rebuilt without `undefined` optionals; null when invalid. */
export function parseScenarioChange(value: unknown): ScenarioChange | null {
  const parsed = scenarioChangeSchema.safeParse(value);
  if (!parsed.success) return null;
  const change = parsed.data;
  if (change.kind === "add_driver") {
    if (change.effectiveTo && change.effectiveTo < change.effectiveFrom) return null;
    return { kind: "add_driver", label: change.label, direction: change.direction, amount: change.amount, cadence: change.cadence, effectiveFrom: change.effectiveFrom, ...(change.effectiveTo ? { effectiveTo: change.effectiveTo } : {}), ...(change.category ? { category: change.category } : {}) };
  }
  if (change.kind === "change_amount") return { kind: "change_amount", itemId: change.itemId, amount: change.amount, effectiveFrom: change.effectiveFrom };
  return { kind: "end_item", itemId: change.itemId, effectiveTo: change.effectiveTo };
}

/** A whole change list from a request: every entry must be valid, or the list is rejected (null). At most 100 changes. */
export function parseScenarioChanges(value: unknown): ScenarioChange[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const changes = value.map(parseScenarioChange);
  return changes.every((change): change is ScenarioChange => change !== null) ? changes : null;
}

/** A stored list, read leniently: rows written before a schema change keep their valid entries. */
export function parseStoredChanges(value: unknown): ScenarioChange[] {
  if (!Array.isArray(value)) return [];
  return value.map(parseScenarioChange).filter((change): change is ScenarioChange => change !== null);
}

/** The agent's flat shape: every key present, unused ones null. Nulls are dropped before the strict parse. */
export function scenarioChangeFromFlat(value: unknown): ScenarioChange | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return parseScenarioChange(Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null)));
}

/** The decision effect a change stands for. A missing category becomes "other", both here and in promotion. */
export function scenarioChangeToEffect(change: ScenarioChange): DecisionEffect {
  if (change.kind === "add_driver") {
    return { kind: "add_item", item: { label: change.label, direction: change.direction, amount: change.amount, cadence: change.cadence, effectiveFrom: change.effectiveFrom, ...(change.effectiveTo ? { effectiveTo: change.effectiveTo } : {}), category: change.category ?? "other", accountingTreatment: "cash" } };
  }
  if (change.kind === "change_amount") return { kind: "change_amount", itemId: change.itemId, amount: change.amount, effectiveFrom: change.effectiveFrom };
  return { kind: "end_item", itemId: change.itemId, effectiveTo: change.effectiveTo };
}

/**
 * The scenario change for a decision effect, or null when the effect is not a driver change (set_category, none).
 * An add_item's counterparty, non-cash treatment, recognition window, and scenario name are not carried.
 */
export function effectToScenarioChange(effect: DecisionEffect | undefined): ScenarioChange | null {
  if (!effect) return null;
  if (effect.kind === "add_item") {
    const { item } = effect;
    return { kind: "add_driver", label: item.label, direction: item.direction, amount: item.amount, cadence: item.cadence, effectiveFrom: item.effectiveFrom, ...(item.effectiveTo ? { effectiveTo: item.effectiveTo } : {}), category: item.category };
  }
  if (effect.kind === "change_amount") return { kind: "change_amount", itemId: effect.itemId, amount: effect.amount, effectiveFrom: effect.effectiveFrom };
  if (effect.kind === "end_item") return { kind: "end_item", itemId: effect.itemId, effectiveTo: effect.effectiveTo };
  return null;
}

/** One line per change. An add matches `describeEffect` for the equivalent add_item exactly. */
export function describeScenarioChange(change: ScenarioChange, itemLabel?: string): string {
  const money = (amount: number) => `$${amount.toLocaleString("en-US")}`;
  if (change.kind === "add_driver") return `${change.direction === "spend" ? "Adds an expense" : "Adds a receipt"}: ${change.label} ${money(change.amount)} ${change.cadence} from ${change.effectiveFrom}${change.effectiveTo ? ` to ${change.effectiveTo}` : ""}`;
  if (change.kind === "change_amount") return `Changes ${itemLabel ?? "an item"} to ${money(change.amount)} from ${change.effectiveFrom}`;
  return `Ends ${itemLabel ?? "an item"} after ${change.effectiveTo}`;
}

/** The driver id a change adds, stable for a scenario's saved change list. */
export const scenarioDriverId = (scenarioId: string, index: number) => `scenario:${scenarioId}:${index}`;

function withoutDecision(driver: ForecastDriver): ForecastDriver {
  const { decisionId: _decisionId, ...rest } = driver;
  void _decisionId;
  return rest;
}

/**
 * Apply changes in order, each through `projectDecisionEffectOnDrivers` with the
 * change's scenario driver id standing in for a decision id. Then relabel: an
 * added driver takes the id `scenario:<scenarioId>:<index>`, carries the
 * scenario, and has no decision. A driver the change only touched keeps the
 * decision lineage it had before. A change whose item is absent does nothing.
 */
export function applyScenarioChanges(drivers: ForecastDriver[], changes: ScenarioChange[], scenarioId: string): ForecastDriver[] {
  return changes.reduce<ForecastDriver[]>((current, change, index) => {
    const id = scenarioDriverId(scenarioId, index);
    const priorDecisionIds = new Map(current.map((driver) => [driver.id, driver.decisionId]));
    return projectDecisionEffectOnDrivers(current, scenarioChangeToEffect(change), id).map((driver) => {
      if (driver.id === `decision:${id}`) return { ...withoutDecision(driver), id, scenarioId };
      if (driver.decisionId !== id) return driver;
      const prior = priorDecisionIds.get(driver.id);
      return prior ? { ...withoutDecision(driver), decisionId: prior } : withoutDecision(driver);
    });
  }, drivers);
}

/**
 * The base run and the changed run built from one input, and their difference.
 * The changed drivers are the base drivers, then `scenarioDrivers` (a saved
 * scenario's confirmed items), then `changes`. Nothing is written.
 */
export function runSimulation(base: ForecastRunInput, changes: ScenarioChange[], options: { scenarioId?: string; scenarioDrivers?: ForecastDriver[] } = {}) {
  const drivers = applyScenarioChanges([...base.drivers, ...(options.scenarioDrivers ?? [])], changes, options.scenarioId ?? "adhoc");
  const baseRun = buildForecastRun(base);
  const run = buildForecastRun({ ...base, drivers });
  return { baseRun, run, consequence: diffForecastRuns(baseRun, run) };
}
```

- [ ] **Step 5: Run the tests and verify they pass.** Run `pnpm --filter @finance/web test -- scenario-changes`. Expected: PASS, with all tests green. If the runway numbers differ, do not change the assertions until you have re-derived them from `fixtureBaseInput`: the base is 900,000 at 2026-08 with 100,000/month of spend, so the base cash-out month is 2027-06.

- [ ] **Step 6: Run the full verification.** Run the four commands in Global Constraints. Expected: all pass, and the lint counts are unchanged.

- [ ] **Step 7: Commit.**
```bash
git add apps/web/src/lib/scenario-changes.ts apps/web/src/lib/scenario-changes.test.ts apps/web/src/test/forecast-fixture.ts
git commit -m "$(cat <<'EOF'
Add pure scenario changes that apply through the decision-effect projection

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 2: Migration, storage, `loadForecastBase`, and the scenario forecast loader

**Files:**
- Create: `packages/database/drizzle/0074_forecast_scenarios.sql`
- Modify: `packages/database/drizzle/meta/_journal.json`, `packages/database/src/schema.ts`
- Create: `apps/web/src/lib/forecast-base.ts`
- Modify: `apps/web/src/lib/forecast-preview.ts`, `apps/web/src/lib/forecast-read.ts`
- Create: `apps/web/src/lib/scenarios.ts` (read part only; Task 3 replaces the file)
- Create: `apps/web/src/lib/forecast-scenarios.ts`
- Test: `apps/web/src/lib/forecast-scenarios.test.ts`

**Interfaces:**
- Consumes (Task 1): `runSimulation`, `parseStoredChanges`, `scenarioChangeToEffect`, `ScenarioDetail`, `ScenarioForecastView`.
- Consumes (existing):
  - `loadForecastDrivers(companyId, { scenarioId }, db?)`, `loadForecastInputs`, `loadForecastAccounts`, `forecastAsOfMonth`, `compareIds` (`forecast-inputs.ts`)
  - `driverEvidenceIds(delta: ForecastConsequence): string[]` (`forecast-read.ts`, from C1)
- Produces:
  - `loadForecastBase(companyId: string, now?: Date): Promise<ForecastRunInput>`
  - `export function driverEvidenceIds` (visibility change only)
  - `class ScenarioNotFound extends Error`, `class ScenarioConflict extends Error`, `class ScenarioInvalid extends Error`
  - `loadActiveScenario(companyId: string, scenarioId: string): Promise<ScenarioDetail>`, which throws `ScenarioNotFound` for another company's scenario, an inactive one, or a non-uuid id
  - `loadScenarioForecast(companyId: string, scenarioId: string, now?: Date): Promise<ScenarioForecastView>`
  - DB: `scenarios.description text NULL`, `scenarios.changes jsonb NOT NULL DEFAULT '[]'`

- [ ] **Step 1: Write the migration.** `packages/database/drizzle/0074_forecast_scenarios.sql`:
```sql
ALTER TABLE "scenarios" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "scenarios" ADD COLUMN IF NOT EXISTS "changes" jsonb DEFAULT '[]'::jsonb NOT NULL;
```
Then append this entry to the `entries` array in `packages/database/drizzle/meta/_journal.json`, after the `0073_bulk_confirm_attribution` entry. Add a comma after that entry's closing `}`. First confirm with `tail -12 packages/database/drizzle/meta/_journal.json` that 0073 (`when` 1789300000036) is still the last entry. If a newer entry exists, use the next idx, `when` + 1, and the next file number, and rename the SQL file to match.
```json
    {
      "idx": 74,
      "version": "7",
      "when": 1789300000037,
      "tag": "0074_forecast_scenarios",
      "breakpoints": true
    }
```

- [ ] **Step 2: Update the Drizzle schema.** In `packages/database/src/schema.ts`, replace the `scenarios` table's middle line
```ts
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), name: text("name").notNull(), assumptionIds: text("assumption_ids").default("[]").notNull(), active: char("active", { length: 1 }).default("Y").notNull(), ...timestamps,
```
with
```ts
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), name: text("name").notNull(),
  /** What the scenario explores, in the CFO's words. */
  description: text("description"),
  assumptionIds: text("assumption_ids").default("[]").notNull(),
  /** Hypothetical driver changes (ScenarioChange[], apps/web/src/lib/scenario-changes.ts), applied in order over the base forecast. Read with parseStoredChanges. */
  changes: jsonb("changes").$type<unknown>().default([]).notNull(),
  active: char("active", { length: 1 }).default("Y").notNull(), ...timestamps,
```
`jsonb` is already imported in schema.ts. It is used by `financialStateRevisions.subjectIds`.

- [ ] **Step 3: Apply the migration.** Run `pnpm --filter @finance/database db:migrate`. Expected: `Database migrations complete`.

- [ ] **Step 4: Write the failing DB tests.** `apps/web/src/lib/forecast-scenarios.test.ts`:
```ts
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

config({ path: fileURLToPath(new URL("../../../../.env.local", import.meta.url)) });
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!process.env.DATABASE_URL)("scenario forecast", async () => {
  if (!process.env.DATABASE_URL) return; // skipped suites still run their factory
  const { calculationRuns, chartAccounts, closeDatabase, companies, decisions, economicItems, evidence, forecastEntryTemplates, getDatabase, scenarios, users } = await import("@finance/database");
  const { refreshCurrentCalculationRun } = await import("./refresh-calculation-run");
  const { previewForecastChange } = await import("./forecast-preview");
  const { forecastAsOfMonth } = await import("./forecast-inputs");
  const { loadScenarioForecast } = await import("./forecast-scenarios");
  const { ScenarioNotFound } = await import("./scenarios");
  const { scenarioChangeToEffect } = await import("./scenario-changes");
  const { addMonths } = await import("@balsa/finance-engine");
  const db = getDatabase();
  let companyId = ""; let otherCompanyId = ""; let firstMonth = "";
  const headline = (delta: unknown) => { const value = delta as { horizonEndCash: unknown; cashOutMonth: unknown; runwayMonths: unknown; projectedSpending: unknown; projectedReceipts: unknown }; return { horizonEndCash: value.horizonEndCash, cashOutMonth: value.cashOutMonth, runwayMonths: value.runwayMonths, projectedSpending: value.projectedSpending, projectedReceipts: value.projectedReceipts }; };
  const newScenario = async (name: string, changes: unknown[] = [], company = companyId) => (await db.insert(scenarios).values({ companyId: company, name, changes }).returning({ id: scenarios.id }))[0]!.id;

  beforeAll(async () => {
    const [company, other] = await db.insert(companies).values([{ name: `Scenario forecast ${Date.now()}` }, { name: `Scenario forecast other ${Date.now()}` }]).returning({ id: companies.id });
    companyId = company!.id; otherCompanyId = other!.id;
    const accounts = await db.insert(chartAccounts).values([
      { companyId, code: "1000", name: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" },
      { companyId, code: "4000", name: "Revenue", accountType: "revenue", normalBalance: "credit" },
      { companyId, code: "6000", name: "Payroll", accountType: "expense", normalBalance: "debit" },
    ]).returning({ id: chartAccounts.id, code: chartAccounts.code });
    const account = (code: string) => accounts.find((row) => row.code === code)!.id;
    await db.insert(forecastEntryTemplates).values([
      { companyId, name: "Spend", itemType: "obligation", direction: "spend", debitAccountId: account("6000"), creditAccountId: account("1000") },
      { companyId, name: "Receipts", itemType: "agreement", direction: "receipt", debitAccountId: account("1000"), creditAccountId: account("4000") },
    ]);
    firstMonth = addMonths(await forecastAsOfMonth(companyId, new Date()), 1);
    await db.insert(economicItems).values({ companyId, type: "obligation", direction: "spend", label: "Payroll", amount: "1000", cadence: "monthly", effectiveFrom: firstMonth, category: "salary", status: "confirmed" });
    await refreshCurrentCalculationRun(companyId, { cause: { kind: "entity_changed", subjectType: "company", subjectId: companyId, actorUserId: null, via: "worker" } });
  });

  afterAll(async () => {
    for (const id of [companyId, otherCompanyId]) if (id) await db.delete(companies).where(eq(companies.id, id));
    await closeDatabase();
  });

  it("gives an add_driver the same consequence as previewing the equivalent proposed decision", async () => {
    const change = { kind: "add_driver" as const, label: "Contractor", direction: "spend" as const, amount: 250, cadence: "monthly" as const, effectiveFrom: firstMonth, category: "contractor" as const };
    const scenarioId = await newScenario("Contractor", [change]);
    const [decision] = await db.insert(decisions).values({ companyId, question: "Hire a contractor?", answer: "Yes", status: "proposed", effect: JSON.stringify(scenarioChangeToEffect(change)) }).returning({ id: decisions.id });
    const forecast = await loadScenarioForecast(companyId, scenarioId);
    const preview = await previewForecastChange(companyId, { kind: "apply_decision", decisionId: decision!.id });
    expect(forecast.consequence).not.toBeNull();
    expect(headline(forecast.consequence)).toEqual(headline(preview.consequence));
    expect(forecast.consequence!.drivers.added.map((driver) => driver.id)).toEqual([`scenario:${scenarioId}:0`]);
    expect(forecast.scenario).toEqual({ id: scenarioId, name: "Contractor", description: null, changes: [change], itemCount: 0 });
    expect(forecast.months.length).toBe(24);
    expect(forecast.months.every((month) => month.basis === "forecast")).toBe(true);
  });

  it("includes the scenario's confirmed items, not its drafts", async () => {
    const scenarioId = await newScenario("With items");
    await db.insert(economicItems).values([
      { companyId, scenarioId, type: "agreement", direction: "receipt", label: "Grant", amount: "400", cadence: "monthly", effectiveFrom: firstMonth, category: "other_revenue", status: "confirmed" },
      { companyId, scenarioId, type: "agreement", direction: "receipt", label: "Draft grant", amount: "900", cadence: "monthly", effectiveFrom: firstMonth, status: "draft" },
    ]);
    const forecast = await loadScenarioForecast(companyId, scenarioId);
    expect(forecast.scenario.itemCount).toBe(1);
    expect(forecast.consequence!.drivers.added.map((driver) => driver.label)).toEqual(["Grant"]);
    // 400.00 a month over the 24-month horizon that starts at firstMonth.
    expect(forecast.consequence!.projectedReceipts.deltaMinor).toBe("960000");
  });

  it("persists nothing and reuses the stored input instead of reading the ledger", async () => {
    const ledger = await import("./journal-ledger");
    const scenarioId = await newScenario("Read only", [{ kind: "add_driver", label: "Rent", direction: "spend", amount: 100, cadence: "monthly", effectiveFrom: firstMonth }]);
    const runsBefore = (await db.select({ id: calculationRuns.id }).from(calculationRuns).where(eq(calculationRuns.companyId, companyId))).length;
    const revisionBefore = (await db.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, companyId)))[0]!.revision;
    const spy = vi.spyOn(ledger, "loadPostedJournalLines");
    await loadScenarioForecast(companyId, scenarioId);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect((await db.select({ id: calculationRuns.id }).from(calculationRuns).where(eq(calculationRuns.companyId, companyId))).length).toBe(runsBefore);
    expect((await db.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, companyId)))[0]!.revision).toBe(revisionBefore);
  });

  it("resolves sources for the company's own evidence only", async () => {
    const stamp = Date.now();
    const [user] = await db.insert(users).values({ authProvider: "test", authProviderUserId: `scenario-sources-${stamp}`, email: `scenario-sources-${stamp}@example.com` }).returning({ id: users.id });
    try {
      const [own] = await db.insert(evidence).values({ companyId, createdByUserId: user!.id, sourceName: "Grant letter.pdf", rawText: "" }).returning({ id: evidence.id });
      const [foreign] = await db.insert(evidence).values({ companyId: otherCompanyId, createdByUserId: user!.id, sourceName: "Secret.pdf", rawText: "" }).returning({ id: evidence.id });
      const scenarioId = await newScenario("Sourced");
      await db.insert(economicItems).values([
        { companyId, scenarioId, evidenceId: own!.id, type: "agreement", direction: "receipt", label: "Grant A", amount: "100", cadence: "monthly", effectiveFrom: firstMonth, status: "confirmed" },
        { companyId, scenarioId, evidenceId: foreign!.id, type: "agreement", direction: "receipt", label: "Grant B", amount: "100", cadence: "monthly", effectiveFrom: firstMonth, status: "confirmed" },
      ]);
      expect((await loadScenarioForecast(companyId, scenarioId)).sources).toEqual([{ evidenceId: own!.id, sourceName: "Grant letter.pdf" }]);
    } finally {
      await db.delete(users).where(eq(users.id, user!.id));
    }
  });

  it("treats another company's, an inactive, or a malformed scenario id as not found", async () => {
    const foreign = await newScenario("Foreign", [], otherCompanyId);
    await expect(loadScenarioForecast(companyId, foreign)).rejects.toBeInstanceOf(ScenarioNotFound);
    const inactive = await newScenario("Gone");
    await db.update(scenarios).set({ active: "N" }).where(eq(scenarios.id, inactive));
    await expect(loadScenarioForecast(companyId, inactive)).rejects.toBeInstanceOf(ScenarioNotFound);
    await expect(loadScenarioForecast(companyId, "not-a-uuid")).rejects.toBeInstanceOf(ScenarioNotFound);
  });
});
```

- [ ] **Step 5: Run the tests and verify they fail.** Run `pnpm --filter @finance/web test -- forecast-scenarios`. Expected: FAIL with `Failed to resolve import "./forecast-scenarios"` (or `./scenarios`). If the output says `skipped`, `DATABASE_URL` is not loaded. Fix `.env.local` before continuing, because this suite must run.

- [ ] **Step 6: Create `loadForecastBase`.** `apps/web/src/lib/forecast-base.ts` (this is the body of `loadPreviewBaseInput`, moved and renamed):
```ts
import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { calculationRuns, companies, getDatabase } from "@finance/database";
import { forecastFormulaVersion, type ForecastRunInput } from "@balsa/finance-engine";
import { compareIds, forecastAsOfMonth, loadForecastAccounts, loadForecastDrivers, loadForecastInputs } from "@/lib/forecast-inputs";

/** Parse the stored input, treating a parse failure or a non-object result as not reusable. */
function parseStoredInput(inputJson: string): (Partial<ForecastRunInput> & Record<string, unknown>) | null {
  try {
    const parsed: unknown = JSON.parse(inputJson);
    return parsed && typeof parsed === "object" ? (parsed as Partial<ForecastRunInput> & Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The base forecast input for anything computed on demand: previews, scenario
 * forecasts, and the agent's simulate tool. When the latest run at the current
 * formula version is at the company's head revision and its as-of month, its
 * stored actuals summary and settings are reused, so the ledger is not
 * reloaded. Drivers, templates, and active chart accounts are always reloaded:
 * they can change without a revision bump (a new account or template), and a
 * stale account list would exclude a driver whose template uses a new account.
 * Otherwise the whole input is loaded fresh. Base drivers never include
 * scenario-tagged items.
 */
export async function loadForecastBase(companyId: string, now: Date = new Date()): Promise<ForecastRunInput> {
  const db = getDatabase();
  const [[latestRun], [company]] = await Promise.all([
    db.select({ id: calculationRuns.id, revision: calculationRuns.financialStateRevision, inputJson: calculationRuns.inputJson })
      .from(calculationRuns)
      .where(and(eq(calculationRuns.companyId, companyId), eq(calculationRuns.engineVersion, forecastFormulaVersion)))
      .orderBy(desc(sql`${calculationRuns.financialStateRevision}::bigint`), desc(calculationRuns.createdAt))
      .limit(1),
    db.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, companyId)).limit(1),
  ]);
  if (latestRun && company && latestRun.revision === company.revision) {
    const parsed = parseStoredInput(latestRun.inputJson);
    const asOfMonth = await forecastAsOfMonth(companyId, now, db);
    if (parsed && "actuals" in parsed && parsed.asOfMonth === asOfMonth) {
      const [{ drivers, templates }, accounts] = await Promise.all([loadForecastDrivers(companyId, {}, db), loadForecastAccounts(companyId, db)]);
      return { ...(parsed as ForecastRunInput), drivers: drivers.sort((left, right) => compareIds(left.id, right.id)), templates: templates.sort((left, right) => compareIds(left.id, right.id)), accounts };
    }
  }
  return loadForecastInputs(companyId, { now, db });
}
```
Before saving, diff this body against the current `loadPreviewBaseInput` in `forecast-preview.ts`. If C1 or anything else changed that function, carry those changes over, so the move is exact.

- [ ] **Step 7: Point the preview at it.** In `apps/web/src/lib/forecast-preview.ts`:
  1. Delete the `parseStoredInput` function and the `loadPreviewBaseInput` function, including their doc comments.
  2. Add `import { loadForecastBase } from "@/lib/forecast-base";` with the other `@/lib` imports.
  3. Replace every `loadPreviewBaseInput(` call with `loadForecastBase(`.
  4. In the `previewForecastChange` doc comment, replace `(see loadPreviewBaseInput)` with `(see loadForecastBase in forecast-base.ts)`.
  5. Grep the file for each of `desc`, `sql`, `calculationRuns`, `companies`, `forecastFormulaVersion`, `ForecastRunInput`, `compareIds`, `forecastAsOfMonth`, `loadForecastAccounts`, `loadForecastDrivers`, and `loadForecastInputs`. Remove from the import lines any that no longer appear outside an import.

- [ ] **Step 8: Export the evidence-id helper.** In `apps/web/src/lib/forecast-read.ts`, change `function driverEvidenceIds(` to `export function driverEvidenceIds(`. Change nothing else.

- [ ] **Step 9: Create the scenario read module.** `apps/web/src/lib/scenarios.ts` (Task 3 replaces this file with the full version):
```ts
import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { economicItems, getDatabase, scenarios } from "@finance/database";
import { parseStoredChanges, type ScenarioDetail } from "@/lib/scenario-changes";

/** The scenario (or the decision a scenario is made from) does not exist in this company, or the scenario is inactive. */
export class ScenarioNotFound extends Error {}
/** A rule the CFO can fix: a duplicate active name, or a decision that is no longer proposed. */
export class ScenarioConflict extends Error {}
/** Well-formed but unusable: a change targets an item outside the company's confirmed base forecast, or a decision holds no driver change. */
export class ScenarioInvalid extends Error {}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type ScenarioRow = typeof scenarios.$inferSelect;

const toDetail = (row: ScenarioRow, itemCount: number): ScenarioDetail => ({ id: row.id, name: row.name, description: row.description, changes: parseStoredChanges(row.changes), itemCount });

/** Confirmed items tagged to each scenario: the items a scenario run includes. */
async function itemCounts(companyId: string, scenarioIds: string[]): Promise<Map<string, number>> {
  if (!scenarioIds.length) return new Map();
  const rows = await getDatabase().select({ scenarioId: economicItems.scenarioId, count: sql<number>`count(*)::int` }).from(economicItems)
    .where(and(eq(economicItems.companyId, companyId), eq(economicItems.status, "confirmed"), inArray(economicItems.scenarioId, scenarioIds)))
    .groupBy(economicItems.scenarioId);
  return new Map(rows.flatMap((row) => (row.scenarioId ? [[row.scenarioId, Number(row.count)] as const] : [])));
}

/** An active scenario of this company. Anything else, including a malformed id, is not found. */
export async function loadActiveScenario(companyId: string, scenarioId: string): Promise<ScenarioDetail> {
  if (!uuidPattern.test(scenarioId)) throw new ScenarioNotFound("Scenario not found");
  const [row] = await getDatabase().select().from(scenarios).where(and(eq(scenarios.id, scenarioId), eq(scenarios.companyId, companyId), eq(scenarios.active, "Y"))).limit(1);
  if (!row) throw new ScenarioNotFound("Scenario not found");
  return toDetail(row, (await itemCounts(companyId, [row.id])).get(row.id) ?? 0);
}
```

- [ ] **Step 10: Create the scenario forecast loader.** `apps/web/src/lib/forecast-scenarios.ts` (Task 4 replaces this file with a superset):
```ts
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { evidence, getDatabase } from "@finance/database";
import type { ForecastConsequence } from "@balsa/finance-engine";
import type { ConsequenceSource } from "@/lib/consequence-copy";
import { loadForecastBase } from "@/lib/forecast-base";
import { loadForecastDrivers } from "@/lib/forecast-inputs";
import { driverEvidenceIds } from "@/lib/forecast-read";
import { runSimulation, type ScenarioForecastView } from "@/lib/scenario-changes";
import { loadActiveScenario } from "@/lib/scenarios";

/** The documents behind the drivers a consequence names, as in C1, resolved within the company only. */
async function resolveSources(companyId: string, consequence: ForecastConsequence | null): Promise<ConsequenceSource[]> {
  const ids = consequence ? driverEvidenceIds(consequence) : [];
  if (!ids.length) return [];
  const rows = await getDatabase().select({ id: evidence.id, sourceName: evidence.sourceName }).from(evidence).where(and(eq(evidence.companyId, companyId), inArray(evidence.id, ids)));
  const names = new Map(rows.map((row) => [row.id, row.sourceName]));
  return ids.filter((id) => names.has(id)).map((evidenceId) => ({ evidenceId, sourceName: names.get(evidenceId) ?? null }));
}

/**
 * A scenario's forecast, computed on demand and never persisted: the base
 * input (loadForecastBase), plus the scenario's confirmed items, plus its
 * changes, diffed against the base run built from the same input.
 */
export async function loadScenarioForecast(companyId: string, scenarioId: string, now: Date = new Date()): Promise<ScenarioForecastView> {
  const scenario = await loadActiveScenario(companyId, scenarioId);
  const [base, { drivers: scenarioDrivers }] = await Promise.all([loadForecastBase(companyId, now), loadForecastDrivers(companyId, { scenarioId })]);
  const { run, consequence } = runSimulation(base, scenario.changes, { scenarioId, scenarioDrivers });
  return { scenario, months: run.months.filter((month) => month.basis === "forecast"), runway: run.runway, consequence, exceptions: run.exceptions, sources: await resolveSources(companyId, consequence) };
}
```

- [ ] **Step 11: Run the tests and verify they pass.** Run `pnpm --filter @finance/web test -- forecast-scenarios forecast-preview`. Expected: PASS. The preview suite still passes, which shows the move of `loadForecastBase` kept its behavior.

- [ ] **Step 12: Run the full verification.** Run the four commands in Global Constraints. Expected: all pass, and the lint counts are unchanged.

- [ ] **Step 13: Commit.**
```bash
git add packages/database/drizzle/0074_forecast_scenarios.sql packages/database/drizzle/meta/_journal.json packages/database/src/schema.ts apps/web/src/lib/forecast-base.ts apps/web/src/lib/forecast-preview.ts apps/web/src/lib/forecast-read.ts apps/web/src/lib/scenarios.ts apps/web/src/lib/forecast-scenarios.ts apps/web/src/lib/forecast-scenarios.test.ts
git commit -m "$(cat <<'EOF'
Store scenario changes and compute a scenario's forecast from the shared base input

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 3: Scenario CRUD, promote, from-decision, and the API routes

**Files:**
- Modify (replace whole file): `apps/web/src/lib/scenarios.ts`
- Modify: `apps/web/src/lib/decision-effects.ts`
- Create: `apps/web/src/lib/scenario-http.ts`
- Create: `apps/web/src/app/api/scenarios/route.ts`, `apps/web/src/app/api/scenarios/[id]/route.ts`, `apps/web/src/app/api/scenarios/[id]/forecast/route.ts`, `apps/web/src/app/api/scenarios/[id]/promote/route.ts`, `apps/web/src/app/api/scenarios/from-decision/route.ts`
- Test: `apps/web/src/lib/scenarios.test.ts`

**Interfaces:**
- Consumes:
  - Task 1: `parseStoredChanges`, `parseScenarioChanges`, `scenarioChangeToEffect`, `effectToScenarioChange`, `describeScenarioChange`, `ScenarioChange`, `ScenarioDetail`, `ScenarioSummary`
  - Task 2: `loadScenarioForecast`
  - Existing: `decisionEffectSchema`, `describeEffect`, `parseStoredEffect`, `applyDecisionIfEffective`, `type DecisionEffect` (`decision-effects.ts`); `recordAudit` (`@finance/database`); `auth`, `requireCompanyAccess` (`@/lib/auth`)
- Produces (in `scenarios.ts`, alongside the Task 2 exports, which stay unchanged):
  - `listScenarios(companyId: string): Promise<ScenarioSummary[]>`
  - `type ScenarioInput = { name: string; description?: string | null; changes?: ScenarioChange[] }`
  - `createScenario(companyId: string, input: ScenarioInput, actorUserId: string | null): Promise<ScenarioDetail>`: throws `ScenarioConflict` for a duplicate active name, and `ScenarioInvalid` when a change targets an item outside the company's confirmed base forecast
  - `type ScenarioPatch = { name?: string; description?: string | null; changes?: ScenarioChange[] }`
  - `updateScenario(companyId: string, scenarioId: string, patch: ScenarioPatch, actorUserId: string | null): Promise<ScenarioDetail>`: `changes` replaces the whole list
  - `deactivateScenario(companyId: string, scenarioId: string, actorUserId: string | null): Promise<void>`
  - `scenarioItemToEffect(item: typeof economicItems.$inferSelect): DecisionEffect | null`
  - `promoteScenario(companyId: string, scenarioId: string, actorUserId: string | null): Promise<{ decisionIds: string[]; skippedItems: number }>`: creates one decision per scenario item first, then one per change in order
  - `scenarioFromDecision(companyId: string, decisionId: string, actorUserId: string | null): Promise<ScenarioDetail>`
  - `scenarioErrorResponse(error: unknown): NextResponse` (`scenario-http.ts`): returns 404, 409, or 400, and rethrows any other error
  - HTTP:
    - `GET /api/scenarios` → `{ scenarios: ScenarioSummary[] }`
    - `POST /api/scenarios` → 201 `{ scenario: ScenarioDetail }`
    - `PATCH /api/scenarios/[id]` → `{ scenario }`
    - `DELETE /api/scenarios/[id]` → `{ deactivated: true }`
    - `GET /api/scenarios/[id]/forecast` → `ScenarioForecastView`
    - `POST /api/scenarios/[id]/promote` → `{ decisionIds, skippedItems }`
    - `POST /api/scenarios/from-decision` `{ decisionId }` → 201 `{ scenario }`

- [ ] **Step 1: Write the failing DB tests.** `apps/web/src/lib/scenarios.test.ts`:
```ts
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: fileURLToPath(new URL("../../../../.env.local", import.meta.url)) });
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!process.env.DATABASE_URL)("scenarios", async () => {
  if (!process.env.DATABASE_URL) return; // skipped suites still run their factory
  const { chartAccounts, closeDatabase, companies, decisions, economicItems, forecastEntryTemplates, getDatabase } = await import("@finance/database");
  const { refreshCurrentCalculationRun } = await import("./refresh-calculation-run");
  const { applyDecisionIfEffective, parseStoredEffect } = await import("./decision-effects");
  const { forecastAsOfMonth, loadForecastInputs } = await import("./forecast-inputs");
  const { loadScenarioForecast } = await import("./forecast-scenarios");
  const { createScenario, deactivateScenario, listScenarios, loadActiveScenario, promoteScenario, scenarioFromDecision, updateScenario, ScenarioConflict, ScenarioInvalid, ScenarioNotFound } = await import("./scenarios");
  const { addMonths, buildForecastRun } = await import("@balsa/finance-engine");
  const db = getDatabase();
  const companyIds: string[] = [];
  let main = { id: "", firstMonth: "", payrollId: "", softwareId: "" };
  let other = { id: "", firstMonth: "", payrollId: "", softwareId: "" };

  /** A company with cash, revenue, and payroll accounts; spend and receipt templates; confirmed Payroll and Software items; and a persisted forecast run. */
  async function seedCompany(label: string) {
    const [company] = await db.insert(companies).values({ name: `${label} ${Date.now()}` }).returning({ id: companies.id });
    const id = company!.id; companyIds.push(id);
    const accounts = await db.insert(chartAccounts).values([
      { companyId: id, code: "1000", name: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" },
      { companyId: id, code: "4000", name: "Revenue", accountType: "revenue", normalBalance: "credit" },
      { companyId: id, code: "6000", name: "Payroll", accountType: "expense", normalBalance: "debit" },
    ]).returning({ id: chartAccounts.id, code: chartAccounts.code });
    const account = (code: string) => accounts.find((row) => row.code === code)!.id;
    await db.insert(forecastEntryTemplates).values([
      { companyId: id, name: "Spend", itemType: "obligation", direction: "spend", debitAccountId: account("6000"), creditAccountId: account("1000") },
      { companyId: id, name: "Receipts", itemType: "agreement", direction: "receipt", debitAccountId: account("1000"), creditAccountId: account("4000") },
    ]);
    const firstMonth = addMonths(await forecastAsOfMonth(id, new Date()), 1);
    const items = await db.insert(economicItems).values([
      { companyId: id, type: "obligation", direction: "spend", label: "Payroll", amount: "1000", cadence: "monthly", effectiveFrom: firstMonth, category: "salary", status: "confirmed" },
      { companyId: id, type: "obligation", direction: "spend", label: "Software", amount: "120", cadence: "monthly", effectiveFrom: firstMonth, category: "software", status: "confirmed" },
    ]).returning({ id: economicItems.id, label: economicItems.label });
    await refreshCurrentCalculationRun(id, { cause: { kind: "entity_changed", subjectType: "company", subjectId: id, actorUserId: null, via: "worker" } });
    return { id, firstMonth, payrollId: items.find((item) => item.label === "Payroll")!.id, softwareId: items.find((item) => item.label === "Software")!.id };
  }

  beforeAll(async () => {
    main = await seedCompany("Scenarios");
    other = await seedCompany("Scenarios other");
  });

  afterAll(async () => {
    if (companyIds.length) await db.delete(companies).where(inArray(companies.id, companyIds));
    await closeDatabase();
  });

  it("creates, lists, updates, and deactivates, with names unique among active scenarios", async () => {
    const change = { kind: "end_item" as const, itemId: main.softwareId, effectiveTo: main.firstMonth };
    const created = await createScenario(main.id, { name: "Hiring", description: " Two hires " }, null);
    expect(created).toMatchObject({ name: "Hiring", description: "Two hires", changes: [], itemCount: 0 });
    await expect(createScenario(main.id, { name: "Hiring" }, null)).rejects.toBeInstanceOf(ScenarioConflict);
    expect(await createScenario(other.id, { name: "Hiring" }, null)).toMatchObject({ name: "Hiring" });
    expect((await listScenarios(main.id)).find((scenario) => scenario.id === created.id)).toEqual({ id: created.id, name: "Hiring", description: "Two hires", changeCount: 0, itemCount: 0 });

    const updated = await updateScenario(main.id, created.id, { changes: [change], description: null }, null);
    expect(updated).toMatchObject({ name: "Hiring", description: null, changes: [change] });
    expect((await listScenarios(main.id)).find((scenario) => scenario.id === created.id)?.changeCount).toBe(1);
    const second = await createScenario(main.id, { name: "Hiring later" }, null);
    await expect(updateScenario(main.id, second.id, { name: "Hiring" }, null)).rejects.toBeInstanceOf(ScenarioConflict);

    await deactivateScenario(main.id, created.id, null);
    expect((await listScenarios(main.id)).some((scenario) => scenario.id === created.id)).toBe(false);
    await expect(updateScenario(main.id, created.id, { name: "Back" }, null)).rejects.toBeInstanceOf(ScenarioNotFound);
    await expect(deactivateScenario(main.id, created.id, null)).rejects.toBeInstanceOf(ScenarioNotFound);
    expect(await createScenario(main.id, { name: "Hiring" }, null)).toMatchObject({ name: "Hiring" });
  });

  it("rejects changes that target another company's item, a draft, or a scenario item", async () => {
    const [draft] = await db.insert(economicItems).values({ companyId: main.id, type: "obligation", direction: "spend", label: "Draft", amount: "5", cadence: "monthly", effectiveFrom: main.firstMonth, status: "draft" }).returning({ id: economicItems.id });
    const holder = await createScenario(main.id, { name: "Holder" }, null);
    const [tagged] = await db.insert(economicItems).values({ companyId: main.id, scenarioId: holder.id, type: "obligation", direction: "spend", label: "Tagged", amount: "5", cadence: "monthly", effectiveFrom: main.firstMonth, status: "confirmed" }).returning({ id: economicItems.id });
    for (const itemId of [other.payrollId, draft!.id, tagged!.id]) {
      await expect(createScenario(main.id, { name: `Bad ${itemId}`, changes: [{ kind: "end_item", itemId, effectiveTo: main.firstMonth }] }, null)).rejects.toBeInstanceOf(ScenarioInvalid);
      await expect(updateScenario(main.id, holder.id, { changes: [{ kind: "change_amount", itemId, amount: 1, effectiveFrom: main.firstMonth }] }, null)).rejects.toBeInstanceOf(ScenarioInvalid);
    }
  });

  it("scopes every read and write to the company", async () => {
    const foreign = await createScenario(other.id, { name: "Foreign" }, null);
    const [foreignDecision] = await db.insert(decisions).values({ companyId: other.id, question: "Foreign?", answer: "Yes", status: "proposed", effect: JSON.stringify({ kind: "end_item", itemId: other.softwareId, effectiveTo: other.firstMonth }) }).returning({ id: decisions.id });
    await expect(loadActiveScenario(main.id, foreign.id)).rejects.toBeInstanceOf(ScenarioNotFound);
    await expect(loadScenarioForecast(main.id, foreign.id)).rejects.toBeInstanceOf(ScenarioNotFound);
    await expect(updateScenario(main.id, foreign.id, { name: "Stolen" }, null)).rejects.toBeInstanceOf(ScenarioNotFound);
    await expect(deactivateScenario(main.id, foreign.id, null)).rejects.toBeInstanceOf(ScenarioNotFound);
    await expect(promoteScenario(main.id, foreign.id, null)).rejects.toBeInstanceOf(ScenarioNotFound);
    await expect(scenarioFromDecision(main.id, foreignDecision!.id, null)).rejects.toBeInstanceOf(ScenarioNotFound);
    expect((await listScenarios(main.id)).some((scenario) => scenario.id === foreign.id)).toBe(false);
    expect((await loadActiveScenario(other.id, foreign.id)).name).toBe("Foreign");
  });

  it("promotes to proposed decisions that, applied one by one, reach the scenario's forecast", async () => {
    const company = await seedCompany("Scenario promotion");
    const scenario = await createScenario(company.id, { name: "Promote me", changes: [
      { kind: "add_driver", label: "Contractor", direction: "spend", amount: 250, cadence: "monthly", effectiveFrom: company.firstMonth, category: "contractor" },
      { kind: "change_amount", itemId: company.payrollId, amount: 1200, effectiveFrom: addMonths(company.firstMonth, 3) },
      { kind: "end_item", itemId: company.softwareId, effectiveTo: addMonths(company.firstMonth, 5) },
    ] }, null);
    await db.insert(economicItems).values({ companyId: company.id, scenarioId: scenario.id, type: "agreement", direction: "receipt", label: "Grant", amount: "400", cadence: "monthly", effectiveFrom: company.firstMonth, category: "other_revenue", status: "confirmed" });
    const expected = await loadScenarioForecast(company.id, scenario.id);
    expect(expected.consequence).not.toBeNull();

    const { decisionIds, skippedItems } = await promoteScenario(company.id, scenario.id, null);
    expect(skippedItems).toBe(0);
    expect(decisionIds).toHaveLength(4);
    const rows = await db.select().from(decisions).where(inArray(decisions.id, decisionIds));
    expect(rows.every((row) => row.status === "proposed" && row.question.startsWith("Apply from scenario Promote me: "))).toBe(true);
    expect(rows.map((row) => row.question)).toContain(`Apply from scenario Promote me: Changes Payroll to $1,200 from ${addMonths(company.firstMonth, 3)}`);
    // Promotion alone changes nothing: until the CFO applies each proposal, the base is still the scenario's "before".
    expect(buildForecastRun(await loadForecastInputs(company.id)).runway.runwayMonths).toBe(expected.consequence!.runwayMonths.before);

    for (const id of decisionIds) {
      await db.update(decisions).set({ status: "applied" }).where(eq(decisions.id, id));
      await applyDecisionIfEffective(company.id, id, null);
    }
    const after = buildForecastRun(await loadForecastInputs(company.id));
    expect(after.runway).toEqual(expected.runway);
    expect(after.months.filter((month) => month.basis === "forecast").map((month) => month.endingCashMinor)).toEqual(expected.months.map((month) => month.endingCashMinor));
  });

  it("round-trips a proposed decision through a scenario", async () => {
    const effect = { kind: "add_item", item: { label: "Designer", direction: "spend", amount: 300, cadence: "monthly", effectiveFrom: main.firstMonth, category: "contractor", accountingTreatment: "cash" } };
    const [decision] = await db.insert(decisions).values({ companyId: main.id, question: "Hire a designer?", answer: "Yes", status: "proposed", effect: JSON.stringify(effect) }).returning({ id: decisions.id });
    const scenario = await scenarioFromDecision(main.id, decision!.id, null);
    expect(scenario).toMatchObject({ name: "Hire a designer?", description: "From proposed decision: Hire a designer?", itemCount: 0 });
    expect(scenario.changes).toEqual([{ kind: "add_driver", label: "Designer", direction: "spend", amount: 300, cadence: "monthly", effectiveFrom: main.firstMonth, category: "contractor" }]);
    expect((await scenarioFromDecision(main.id, decision!.id, null)).name).toBe("Hire a designer? (2)");

    const { decisionIds } = await promoteScenario(main.id, scenario.id, null);
    const [promoted] = await db.select({ effect: decisions.effect }).from(decisions).where(eq(decisions.id, decisionIds[0]!));
    expect(parseStoredEffect(promoted!.effect)).toEqual(parseStoredEffect(JSON.stringify(effect)));
  });

  it("refuses decisions that are not proposed or hold no driver change", async () => {
    const [applied] = await db.insert(decisions).values({ companyId: main.id, question: "Done?", answer: "Yes", status: "applied", effect: JSON.stringify({ kind: "end_item", itemId: main.softwareId, effectiveTo: main.firstMonth }) }).returning({ id: decisions.id });
    const [plain] = await db.insert(decisions).values({ companyId: main.id, question: "Just a note?", answer: "Yes", status: "proposed" }).returning({ id: decisions.id });
    await expect(scenarioFromDecision(main.id, applied!.id, null)).rejects.toBeInstanceOf(ScenarioConflict);
    await expect(scenarioFromDecision(main.id, plain!.id, null)).rejects.toBeInstanceOf(ScenarioInvalid);
    await expect(scenarioFromDecision(main.id, "not-a-uuid", null)).rejects.toBeInstanceOf(ScenarioNotFound);
  });

  it("files a decision's scenario item under an active scenario, never a deactivated one of the same name", async () => {
    const old = await createScenario(main.id, { name: "Revived" }, null);
    await deactivateScenario(main.id, old.id, null);
    const [decision] = await db.insert(decisions).values({ companyId: main.id, question: "Assume a grant?", answer: "Yes", status: "applied", effect: JSON.stringify({ kind: "add_item", scenario: "Revived", item: { label: "Grant", direction: "receipt", amount: 100, cadence: "monthly", effectiveFrom: main.firstMonth, category: "other_revenue", accountingTreatment: "cash" } }) }).returning({ id: decisions.id });
    await applyDecisionIfEffective(main.id, decision!.id, null);
    const [item] = await db.select({ scenarioId: economicItems.scenarioId }).from(economicItems).where(eq(economicItems.decisionId, decision!.id));
    expect(item!.scenarioId).not.toBe(old.id);
    expect((await listScenarios(main.id)).find((scenario) => scenario.name === "Revived")).toMatchObject({ id: item!.scenarioId, itemCount: 1 });
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail.** Run `pnpm --filter @finance/web test -- scenarios.test`. Expected: FAIL. The import resolves, but `createScenario` is not a function (the Task 2 file does not export it yet), and the suite does not report `skipped`.

- [ ] **Step 3: Replace `apps/web/src/lib/scenarios.ts` with the full module.**
```ts
import "server-only";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { decisions, economicItems, getDatabase, recordAudit, scenarios } from "@finance/database";
import { isCategory } from "@balsa/finance-engine";
import { decisionEffectSchema, describeEffect, parseStoredEffect, type DecisionEffect } from "@/lib/decision-effects";
import { describeScenarioChange, effectToScenarioChange, parseStoredChanges, scenarioChangeToEffect, type ScenarioChange, type ScenarioDetail, type ScenarioSummary } from "@/lib/scenario-changes";

/** The scenario (or the decision a scenario is made from) does not exist in this company, or the scenario is inactive. */
export class ScenarioNotFound extends Error {}
/** A rule the CFO can fix: a duplicate active name, or a decision that is no longer proposed. */
export class ScenarioConflict extends Error {}
/** Well-formed but unusable: a change targets an item outside the company's confirmed base forecast, or a decision holds no driver change. */
export class ScenarioInvalid extends Error {}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type ScenarioRow = typeof scenarios.$inferSelect;
type ItemRow = typeof economicItems.$inferSelect;

const toDetail = (row: ScenarioRow, itemCount: number): ScenarioDetail => ({ id: row.id, name: row.name, description: row.description, changes: parseStoredChanges(row.changes), itemCount });
const cleanDescription = (value: string | null | undefined) => value?.trim() || null;

/** Confirmed items tagged to each scenario: the items a scenario run includes. */
async function itemCounts(companyId: string, scenarioIds: string[]): Promise<Map<string, number>> {
  if (!scenarioIds.length) return new Map();
  const rows = await getDatabase().select({ scenarioId: economicItems.scenarioId, count: sql<number>`count(*)::int` }).from(economicItems)
    .where(and(eq(economicItems.companyId, companyId), eq(economicItems.status, "confirmed"), inArray(economicItems.scenarioId, scenarioIds)))
    .groupBy(economicItems.scenarioId);
  return new Map(rows.flatMap((row) => (row.scenarioId ? [[row.scenarioId, Number(row.count)] as const] : [])));
}

/** An active scenario of this company. Anything else, including a malformed id, is not found. */
export async function loadActiveScenario(companyId: string, scenarioId: string): Promise<ScenarioDetail> {
  if (!uuidPattern.test(scenarioId)) throw new ScenarioNotFound("Scenario not found");
  const [row] = await getDatabase().select().from(scenarios).where(and(eq(scenarios.id, scenarioId), eq(scenarios.companyId, companyId), eq(scenarios.active, "Y"))).limit(1);
  if (!row) throw new ScenarioNotFound("Scenario not found");
  return toDetail(row, (await itemCounts(companyId, [row.id])).get(row.id) ?? 0);
}

/** Active scenarios by name, with how many changes and confirmed items each holds. */
export async function listScenarios(companyId: string): Promise<ScenarioSummary[]> {
  const rows = await getDatabase().select().from(scenarios).where(and(eq(scenarios.companyId, companyId), eq(scenarios.active, "Y"))).orderBy(asc(scenarios.name), asc(scenarios.createdAt));
  const counts = await itemCounts(companyId, rows.map((row) => row.id));
  return rows.map((row) => ({ id: row.id, name: row.name, description: row.description, changeCount: parseStoredChanges(row.changes).length, itemCount: counts.get(row.id) ?? 0 }));
}

/** Names are unique among a company's active scenarios, compared exactly, as the decision path looks scenarios up. */
async function assertNameFree(companyId: string, name: string, exceptId?: string) {
  const [taken] = await getDatabase().select({ id: scenarios.id }).from(scenarios)
    .where(and(eq(scenarios.companyId, companyId), eq(scenarios.active, "Y"), eq(scenarios.name, name), exceptId ? ne(scenarios.id, exceptId) : undefined)).limit(1);
  if (taken) throw new ScenarioConflict(`A scenario named "${name}" already exists`);
}

/** A change may target only a confirmed base-forecast item of this company, the only kind promotion can apply to. */
async function assertChangeTargets(companyId: string, changes: ScenarioChange[]) {
  const ids = [...new Set(changes.flatMap((change) => (change.kind === "add_driver" ? [] : [change.itemId])))];
  if (!ids.length) return;
  const rows = await getDatabase().select({ id: economicItems.id }).from(economicItems)
    .where(and(eq(economicItems.companyId, companyId), eq(economicItems.status, "confirmed"), isNull(economicItems.scenarioId), inArray(economicItems.id, ids)));
  if (rows.length !== ids.length) throw new ScenarioInvalid("A change targets an item that is not a confirmed base-forecast item of this company");
}

export type ScenarioInput = { name: string; description?: string | null; changes?: ScenarioChange[] };

/** Create a scenario. Scenario writes never bump the financial-state revision: the base forecast does not change. */
export async function createScenario(companyId: string, input: ScenarioInput, actorUserId: string | null): Promise<ScenarioDetail> {
  const name = input.name.trim();
  const changes = input.changes ?? [];
  await assertNameFree(companyId, name);
  await assertChangeTargets(companyId, changes);
  const db = getDatabase();
  const [row] = await db.insert(scenarios).values({ companyId, name, description: cleanDescription(input.description), changes }).returning();
  if (!row) throw new Error("Scenario insert returned no row");
  await recordAudit(db, { companyId, actorUserId, via: "ui", action: "scenario.created", entityType: "scenario", entityId: row.id, summary: `Created scenario ${name}`, after: { name, description: row.description, changes } });
  return toDetail(row, 0);
}

export type ScenarioPatch = { name?: string; description?: string | null; changes?: ScenarioChange[] };

/** Rename, re-describe, or replace the whole change list of an active scenario. */
export async function updateScenario(companyId: string, scenarioId: string, patch: ScenarioPatch, actorUserId: string | null): Promise<ScenarioDetail> {
  const current = await loadActiveScenario(companyId, scenarioId);
  const name = patch.name?.trim();
  if (name && name !== current.name) await assertNameFree(companyId, name, scenarioId);
  if (patch.changes) await assertChangeTargets(companyId, patch.changes);
  const db = getDatabase();
  const [row] = await db.update(scenarios).set({
    ...(name ? { name } : {}),
    ...(patch.description !== undefined ? { description: cleanDescription(patch.description) } : {}),
    ...(patch.changes ? { changes: patch.changes } : {}),
    updatedAt: new Date(),
  }).where(and(eq(scenarios.id, scenarioId), eq(scenarios.companyId, companyId), eq(scenarios.active, "Y"))).returning();
  if (!row) throw new ScenarioNotFound("Scenario not found");
  await recordAudit(db, { companyId, actorUserId, via: "ui", action: "scenario.updated", entityType: "scenario", entityId: row.id, summary: `Updated scenario ${row.name}`, before: { name: current.name, description: current.description, changes: current.changes }, after: { name: row.name, description: row.description, changes: parseStoredChanges(row.changes) } });
  return toDetail(row, current.itemCount);
}

/** Soft delete: the row stays for audit, and its name becomes free. */
export async function deactivateScenario(companyId: string, scenarioId: string, actorUserId: string | null): Promise<void> {
  if (!uuidPattern.test(scenarioId)) throw new ScenarioNotFound("Scenario not found");
  const db = getDatabase();
  const [row] = await db.update(scenarios).set({ active: "N", updatedAt: new Date() })
    .where(and(eq(scenarios.id, scenarioId), eq(scenarios.companyId, companyId), eq(scenarios.active, "Y"))).returning({ id: scenarios.id, name: scenarios.name });
  if (!row) throw new ScenarioNotFound("Scenario not found");
  await recordAudit(db, { companyId, actorUserId, via: "ui", action: "scenario.deactivated", entityType: "scenario", entityId: row.id, summary: `Deleted scenario ${row.name}` });
}

/** The base-forecast add_item equivalent of a scenario-tagged item, or null when the item cannot be expressed as one (no positive amount or valid months). */
export function scenarioItemToEffect(item: ItemRow): DecisionEffect | null {
  const parsed = decisionEffectSchema.safeParse({
    kind: "add_item",
    item: {
      label: item.label, counterparty: item.counterparty, direction: item.direction, amount: Number(item.amount ?? ""), cadence: item.cadence, effectiveFrom: item.effectiveFrom, effectiveTo: item.effectiveTo,
      category: isCategory(item.category) ? item.category : "other", accountingTreatment: item.accountingTreatment, recognitionStart: item.recognitionStart, recognitionEnd: item.recognitionEnd,
    },
  });
  return parsed.success ? parsed.data : null;
}

/**
 * Turn a scenario into proposed decisions, one per confirmed scenario item
 * (as a base add_item) and then one per change in order: the order a scenario
 * run applies them. Nothing is applied. The CFO applies each proposal, which
 * keeps the trust model. The scenario itself is left as it is.
 */
export async function promoteScenario(companyId: string, scenarioId: string, actorUserId: string | null): Promise<{ decisionIds: string[]; skippedItems: number }> {
  const scenario = await loadActiveScenario(companyId, scenarioId);
  const db = getDatabase();
  const items = await db.select().from(economicItems).where(and(eq(economicItems.companyId, companyId), eq(economicItems.scenarioId, scenarioId), eq(economicItems.status, "confirmed"))).orderBy(asc(economicItems.createdAt), asc(economicItems.id));
  const targetIds = [...new Set(scenario.changes.flatMap((change) => (change.kind === "add_driver" ? [] : [change.itemId])))];
  const labels = new Map(targetIds.length ? (await db.select({ id: economicItems.id, label: economicItems.label }).from(economicItems).where(and(eq(economicItems.companyId, companyId), inArray(economicItems.id, targetIds)))).map((row) => [row.id, row.label]) : []);
  const itemEffects = items.map(scenarioItemToEffect);
  const proposals = [
    ...itemEffects.flatMap((effect) => (effect ? [{ effect, summary: describeEffect(effect) ?? "" }] : [])),
    ...scenario.changes.map((change) => ({ effect: scenarioChangeToEffect(change), summary: describeScenarioChange(change, change.kind === "add_driver" ? undefined : labels.get(change.itemId)) })),
  ];
  const skippedItems = itemEffects.filter((effect) => effect === null).length;
  if (!proposals.length) return { decisionIds: [], skippedItems };
  const rows = await db.insert(decisions).values(proposals.map(({ effect, summary }) => ({
    companyId, question: `Apply from scenario ${scenario.name}: ${summary}`, answer: `Promoted from scenario ${scenario.name}.`, status: "proposed", effect: JSON.stringify(effect), createdByUserId: actorUserId,
  }))).returning({ id: decisions.id });
  await recordAudit(db, { companyId, actorUserId, via: "ui", action: "scenario.promoted", entityType: "scenario", entityId: scenario.id, summary: `Promoted scenario ${scenario.name} to ${rows.length} proposed decision${rows.length === 1 ? "" : "s"}`, after: { decisionIds: rows.map((row) => row.id), skippedItems } });
  return { decisionIds: rows.map((row) => row.id), skippedItems };
}

/** `base`, or `base (2)`, `base (3)`, … : the first name no active scenario of the company uses. */
async function freeScenarioName(companyId: string, base: string) {
  const rows = await getDatabase().select({ name: scenarios.name }).from(scenarios).where(and(eq(scenarios.companyId, companyId), eq(scenarios.active, "Y")));
  const taken = new Set(rows.map((row) => row.name));
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base} (${suffix})`)) suffix += 1;
  return `${base} (${suffix})`;
}

/** "Try as scenario": a new scenario named after a proposed decision, holding its effect as the one change. */
export async function scenarioFromDecision(companyId: string, decisionId: string, actorUserId: string | null): Promise<ScenarioDetail> {
  if (!uuidPattern.test(decisionId)) throw new ScenarioNotFound("Decision not found");
  const [decision] = await getDatabase().select({ question: decisions.question, status: decisions.status, effect: decisions.effect }).from(decisions).where(and(eq(decisions.id, decisionId), eq(decisions.companyId, companyId))).limit(1);
  if (!decision) throw new ScenarioNotFound("Decision not found");
  if (decision.status !== "proposed") throw new ScenarioConflict("Only a proposed decision can be tried as a scenario");
  const change = effectToScenarioChange(parseStoredEffect(decision.effect));
  if (!change) throw new ScenarioInvalid("This decision has no forecast change a scenario can hold");
  const question = decision.question.trim();
  const name = await freeScenarioName(companyId, question.slice(0, 80).trim() || "Proposed decision");
  return createScenario(companyId, { name, description: `From proposed decision: ${question}`, changes: [change] }, actorUserId);
}
```

- [ ] **Step 4: Match only active scenarios by name in the decision path.** In `apps/web/src/lib/decision-effects.ts`, inside `applyDecisionEffect`'s `add_item` branch, replace
```ts
      const [existing] = await db.select({ id: scenarios.id }).from(scenarios).where(and(eq(scenarios.companyId, companyId), eq(scenarios.name, effect.scenario)));
```
with
```ts
      // Only an active scenario takes new items: a deleted scenario's name is free to start a new one.
      const [existing] = await db.select({ id: scenarios.id }).from(scenarios).where(and(eq(scenarios.companyId, companyId), eq(scenarios.name, effect.scenario), eq(scenarios.active, "Y")));
```

- [ ] **Step 5: Add the error mapping.** `apps/web/src/lib/scenario-http.ts`:
```ts
import "server-only";
import { NextResponse } from "next/server";
import { ScenarioConflict, ScenarioInvalid, ScenarioNotFound } from "@/lib/scenarios";

/** Scenario errors as HTTP: not found 404, conflict 409, invalid 400. Anything else is rethrown. */
export function scenarioErrorResponse(error: unknown) {
  if (error instanceof ScenarioNotFound) return NextResponse.json({ error: error.message }, { status: 404 });
  if (error instanceof ScenarioConflict) return NextResponse.json({ error: error.message }, { status: 409 });
  if (error instanceof ScenarioInvalid) return NextResponse.json({ error: error.message }, { status: 400 });
  throw error;
}
```

- [ ] **Step 6: Add the routes.** `apps/web/src/app/api/scenarios/route.ts`:
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { parseScenarioChanges } from "@/lib/scenario-changes";
import { scenarioErrorResponse } from "@/lib/scenario-http";
import { createScenario, listScenarios } from "@/lib/scenarios";

const createBody = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(2000).nullable().optional(), changes: z.array(z.unknown()).max(100).optional() });

/** Active scenarios with change and item counts. */
export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  return NextResponse.json({ scenarios: await listScenarios(context.company.id) });
}

/** Create a scenario. A duplicate active name is 409. Never touches the base forecast. */
export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const body = createBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "A scenario needs a name" }, { status: 400 });
  const changes = parseScenarioChanges(body.data.changes ?? []);
  if (!changes) return NextResponse.json({ error: "Invalid scenario changes" }, { status: 400 });
  try {
    const scenario = await createScenario(context.company.id, { name: body.data.name, changes, ...(body.data.description !== undefined ? { description: body.data.description } : {}) }, context.user.id);
    return NextResponse.json({ scenario }, { status: 201 });
  } catch (error) {
    return scenarioErrorResponse(error);
  }
}
```
`apps/web/src/app/api/scenarios/[id]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { parseScenarioChanges } from "@/lib/scenario-changes";
import { scenarioErrorResponse } from "@/lib/scenario-http";
import { deactivateScenario, updateScenario } from "@/lib/scenarios";

const patchBody = z.object({ name: z.string().trim().min(1).max(120).optional(), description: z.string().max(2000).nullable().optional(), changes: z.array(z.unknown()).max(100).optional() });

/** Rename, re-describe, or replace the whole change list. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const { id } = await params;
  const body = patchBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid scenario update" }, { status: 400 });
  const changes = body.data.changes === undefined ? undefined : parseScenarioChanges(body.data.changes);
  if (changes === null) return NextResponse.json({ error: "Invalid scenario changes" }, { status: 400 });
  try {
    const scenario = await updateScenario(context.company.id, id, {
      ...(body.data.name !== undefined ? { name: body.data.name } : {}),
      ...(body.data.description !== undefined ? { description: body.data.description } : {}),
      ...(changes ? { changes } : {}),
    }, context.user.id);
    return NextResponse.json({ scenario });
  } catch (error) {
    return scenarioErrorResponse(error);
  }
}

/** Soft-deactivate the scenario. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const { id } = await params;
  try {
    await deactivateScenario(context.company.id, id, context.user.id);
    return NextResponse.json({ deactivated: true });
  } catch (error) {
    return scenarioErrorResponse(error);
  }
}
```
`apps/web/src/app/api/scenarios/[id]/forecast/route.ts`:
```ts
import { NextResponse } from "next/server";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { loadScenarioForecast } from "@/lib/forecast-scenarios";
import { scenarioErrorResponse } from "@/lib/scenario-http";

/** The scenario's forecast versus the base, computed now. Read-only, and nothing is persisted. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const { id } = await params;
  try {
    return NextResponse.json(await loadScenarioForecast(context.company.id, id));
  } catch (error) {
    return scenarioErrorResponse(error);
  }
}
```
`apps/web/src/app/api/scenarios/[id]/promote/route.ts`:
```ts
import { NextResponse } from "next/server";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { scenarioErrorResponse } from "@/lib/scenario-http";
import { promoteScenario } from "@/lib/scenarios";

/** One proposed decision per scenario item and change. Nothing is applied. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const { id } = await params;
  try {
    return NextResponse.json(await promoteScenario(context.company.id, id, context.user.id));
  } catch (error) {
    return scenarioErrorResponse(error);
  }
}
```
`apps/web/src/app/api/scenarios/from-decision/route.ts`:
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { scenarioErrorResponse } from "@/lib/scenario-http";
import { scenarioFromDecision } from "@/lib/scenarios";

const body = z.object({ decisionId: z.string().uuid() });

/** "Try as scenario": a scenario holding a proposed decision's effect. */
export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "decisionId is required" }, { status: 400 });
  try {
    return NextResponse.json({ scenario: await scenarioFromDecision(context.company.id, parsed.data.decisionId, context.user.id) }, { status: 201 });
  } catch (error) {
    return scenarioErrorResponse(error);
  }
}
```

- [ ] **Step 7: Run the tests and verify they pass.** Run `pnpm --filter @finance/web test -- scenarios.test forecast-scenarios forecast-preview`. Expected: PASS. If the promotion test's months differ, compare `expected.consequence.drivers` with the applied items before touching the code. `applyDecisionEffect`'s `change_amount` ends the original at `effectiveFrom - 1` and copies it, exactly as `projectDecisionEffectOnDrivers` does.

- [ ] **Step 8: Run the full verification.** Run the four commands in Global Constraints. Expected: all pass, and the lint counts are unchanged.

- [ ] **Step 9: Commit.**
```bash
git add apps/web/src/lib/scenarios.ts apps/web/src/lib/scenarios.test.ts apps/web/src/lib/decision-effects.ts apps/web/src/lib/scenario-http.ts apps/web/src/app/api/scenarios
git commit -m "$(cat <<'EOF'
Add scenario CRUD, promotion to proposed decisions, and try-as-scenario routes

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 4: Agent `simulate`

**Files:**
- Modify (replace whole file): `apps/web/src/lib/forecast-scenarios.ts`
- Modify: `apps/web/src/app/api/agent/route.ts`
- Test: `apps/web/src/lib/forecast-scenarios.simulate.test.ts`

**Interfaces:**
- Consumes: `runSimulation`, `scenarioChangeFromFlat`, `ScenarioChange`, `ScenarioForecastView` (Task 1); `loadForecastBase`, `loadScenarioForecast` (Task 2); `ScenarioNotFound`, `listScenarios` (Tasks 2–3); `describeConsequence(consequence, exceptionsAfter)` (`consequence-copy.ts`).
- Produces:
  - `type SimulateDeps = { loadBase?: (companyId: string) => Promise<ForecastRunInput>; loadScenario?: (companyId: string, scenarioId: string) => Promise<ScenarioForecastView> }`
  - `simulateForAgent(companyId: string, input: Record<string, unknown>, deps?: SimulateDeps): Promise<{ error: string } | { runway: ForecastRunway; consequence: string; exceptions: ForecastRun["exceptions"] } | { scenario: string; runway: ForecastRunway; consequence: string; exceptions: ForecastRun["exceptions"] }>`
  - The agent tool input is `{"changes":[flat ScenarioChange…]}` or `{"scenarioId":"<uuid>"}`. A flat change has every key (`kind`, `label`, `direction`, `amount`, `cadence`, `effectiveFrom`, `effectiveTo`, `category`, `itemId`), with the unused ones set to null.

- [ ] **Step 1: Write the failing test.** `apps/web/src/lib/forecast-scenarios.simulate.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { fixtureBaseInput } from "@/test/forecast-fixture";
import { simulateForAgent } from "./forecast-scenarios";
import type { ScenarioForecastView } from "./scenario-changes";
import { ScenarioNotFound } from "./scenarios";

const retainer = { kind: "add_driver", label: "Retainer", direction: "receipt", amount: 500, cadence: "monthly", effectiveFrom: "2026-09", effectiveTo: null, category: null, itemId: null };
const loadBase = async () => fixtureBaseInput();
const noScenario = async (): Promise<ScenarioForecastView> => { throw new ScenarioNotFound("Scenario not found"); };
const deps = { loadBase, loadScenario: noScenario };

describe("simulate tool", () => {
  it("simulates flat changes against the stubbed base", async () => {
    const result = await simulateForAgent("company", { changes: [retainer] }, deps);
    if (!("consequence" in result)) throw new Error(`expected a simulation, got ${JSON.stringify(result)}`);
    expect(result.runway).toMatchObject({ runwayMonths: 18, cashOutMonth: "2028-03" });
    expect(result.consequence).toContain("runway 9 mo → 18 mo");
    expect(result.exceptions).toEqual([]);
  });

  it("reports a saved scenario's result by name", async () => {
    const view: ScenarioForecastView = {
      scenario: { id: "s1", name: "Hiring", description: null, changes: [], itemCount: 0 }, months: [],
      runway: { cashOutMonth: "2027-06", runwayMonths: 9, trailingBurn3mMinor: "100000", cashOverTrailingBurn: "9.0", minimumCashMinor: "0", horizonMonths: 24 },
      consequence: null, exceptions: [], sources: [],
    };
    expect(await simulateForAgent("company", { scenarioId: "s1" }, { loadBase, loadScenario: async () => view })).toEqual({ scenario: "Hiring", runway: view.runway, consequence: "No forecast effect", exceptions: [] });
  });

  it("explains input it cannot use", async () => {
    expect(await simulateForAgent("company", {}, deps)).toEqual({ error: expect.stringContaining("changes") });
    expect(await simulateForAgent("company", { query: "what if we hire" }, deps)).toEqual({ error: expect.stringContaining("changes") });
    expect(await simulateForAgent("company", { changes: [retainer, { kind: "remove" }] }, deps)).toEqual({ error: "Change 2 is not a valid scenario change." });
    expect(await simulateForAgent("company", { scenarioId: "missing" }, deps)).toEqual({ error: "Scenario not found." });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails.** Run `pnpm --filter @finance/web test -- forecast-scenarios.simulate`. Expected: FAIL with `simulateForAgent is not a function` (or no matching export).

- [ ] **Step 3: Replace `apps/web/src/lib/forecast-scenarios.ts`.** The Task 2 code is unchanged; `simulateForAgent` is added.
```ts
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { evidence, getDatabase } from "@finance/database";
import type { ForecastConsequence, ForecastRun, ForecastRunInput, ForecastRunway } from "@balsa/finance-engine";
import { describeConsequence, type ConsequenceSource } from "@/lib/consequence-copy";
import { loadForecastBase } from "@/lib/forecast-base";
import { loadForecastDrivers } from "@/lib/forecast-inputs";
import { driverEvidenceIds } from "@/lib/forecast-read";
import { runSimulation, scenarioChangeFromFlat, type ScenarioChange, type ScenarioForecastView } from "@/lib/scenario-changes";
import { loadActiveScenario, ScenarioNotFound } from "@/lib/scenarios";

/** The documents behind the drivers a consequence names, as in C1, resolved within the company only. */
async function resolveSources(companyId: string, consequence: ForecastConsequence | null): Promise<ConsequenceSource[]> {
  const ids = consequence ? driverEvidenceIds(consequence) : [];
  if (!ids.length) return [];
  const rows = await getDatabase().select({ id: evidence.id, sourceName: evidence.sourceName }).from(evidence).where(and(eq(evidence.companyId, companyId), inArray(evidence.id, ids)));
  const names = new Map(rows.map((row) => [row.id, row.sourceName]));
  return ids.filter((id) => names.has(id)).map((evidenceId) => ({ evidenceId, sourceName: names.get(evidenceId) ?? null }));
}

/**
 * A scenario's forecast, computed on demand and never persisted: the base
 * input (loadForecastBase), plus the scenario's confirmed items, plus its
 * changes, diffed against the base run built from the same input.
 */
export async function loadScenarioForecast(companyId: string, scenarioId: string, now: Date = new Date()): Promise<ScenarioForecastView> {
  const scenario = await loadActiveScenario(companyId, scenarioId);
  const [base, { drivers: scenarioDrivers }] = await Promise.all([loadForecastBase(companyId, now), loadForecastDrivers(companyId, { scenarioId })]);
  const { run, consequence } = runSimulation(base, scenario.changes, { scenarioId, scenarioDrivers });
  return { scenario, months: run.months.filter((month) => month.basis === "forecast"), runway: run.runway, consequence, exceptions: run.exceptions, sources: await resolveSources(companyId, consequence) };
}

export type SimulateDeps = { loadBase?: (companyId: string) => Promise<ForecastRunInput>; loadScenario?: (companyId: string, scenarioId: string) => Promise<ScenarioForecastView> };
type Simulated = { runway: ForecastRunway; consequence: string; exceptions: ForecastRun["exceptions"] };

/**
 * The agent's read-only what-if. `{ changes }` (flat scenario changes) runs
 * against the current base forecast; `{ scenarioId }` reports a saved
 * scenario. Nothing is written. `deps` lets tests stub the base.
 */
export async function simulateForAgent(companyId: string, input: Record<string, unknown>, deps: SimulateDeps = {}): Promise<{ error: string } | Simulated | (Simulated & { scenario: string })> {
  const loadBase = deps.loadBase ?? ((id: string) => loadForecastBase(id));
  const loadScenario = deps.loadScenario ?? ((id: string, scenarioId: string) => loadScenarioForecast(id, scenarioId));
  if (typeof input.scenarioId === "string") {
    try {
      const result = await loadScenario(companyId, input.scenarioId);
      return { scenario: result.scenario.name, runway: result.runway, consequence: describeConsequence(result.consequence, result.exceptions.length), exceptions: result.exceptions };
    } catch (error) {
      if (error instanceof ScenarioNotFound) return { error: "Scenario not found." };
      throw error;
    }
  }
  const raw = Array.isArray(input.changes) ? input.changes : [];
  if (!raw.length) return { error: 'simulate needs {"changes":[...]} with at least one change, or {"scenarioId":"..."}.' };
  const parsed = raw.map(scenarioChangeFromFlat);
  const invalid = parsed.findIndex((change) => change === null);
  if (invalid >= 0) return { error: `Change ${invalid + 1} is not a valid scenario change.` };
  const changes = parsed.filter((change): change is ScenarioChange => change !== null);
  const { run, consequence } = runSimulation(await loadBase(companyId), changes);
  return { runway: run.runway, consequence: describeConsequence(consequence, run.exceptions.length), exceptions: run.exceptions };
}
```

- [ ] **Step 4: Re-enable the tool in the agent route.** Make these edits in `apps/web/src/app/api/agent/route.ts`:
  1. Add the imports below the `@/lib/forecast-read` import:
     ```ts
     import { simulateForAgent } from "@/lib/forecast-scenarios";
     import { listScenarios } from "@/lib/scenarios";
     ```
  2. Replace the whole `case "simulate": { … }` block (the one returning the "being rebuilt" error) with:
     ```ts
         case "simulate": return simulateForAgent(context.companyId, input);
     ```
  3. In `POST`, add `scenarioList` to the `Promise.all` destructuring. Change `…, entityRows, recentConsequences] = await Promise.all([` to `…, entityRows, recentConsequences, scenarioList] = await Promise.all([`, and change the last array element `loadRecentConsequences(context.company.id, 5),` to:
     ```ts
         loadRecentConsequences(context.company.id, 5),
         listScenarios(context.company.id),
     ```
  4. In `baseInstructions`, replace
     `Actual entries are included through ${asOf}; approved forecast entries are included afterward; a named scenario is an explicit overlay.`
     with
     `Actual entries are included through ${asOf}; approved forecast entries are included afterward. A scenario is a saved, named set of hypothetical driver changes compared with the base forecast; it never changes the books, and the CFO can promote it into proposed decisions that each apply only when the CFO presses Apply.`
  5. Replace the tool line
     `- get_allocations {} and simulate {}: report their explicit availability result; never use a legacy calculation to answer.`
     with these two lines:
     ```
     - get_allocations {}: report its explicit availability result; never use a legacy calculation to answer.
     - simulate {"changes":[{"kind":"add_driver","label":"Contractor","direction":"spend","amount":6000,"cadence":"monthly","effectiveFrom":"YYYY-MM","effectiveTo":null,"category":"contractor","itemId":null}]} or {"scenarioId":"<saved scenario id>"}: answers what-if questions against the current base forecast and writes nothing. Every change carries all nine keys, with unused ones null. Kinds: add_driver (label, direction, amount in dollars, cadence, effectiveFrom, optional effectiveTo and category); change_amount (itemId of a confirmed item, amount, effectiveFrom); end_item (itemId, effectiveTo; the as-of month ${asOf} removes the item). It returns the simulated runway, one line comparing it with the base forecast, and any excluded drivers. Use it for "what if" questions before proposing a decision.
     ```
  6. Replace
     `Use the same effect shape as simulate; set effect to null for decisions with no structured change.`
     with
     `Set effect to null for decisions with no structured change.`
  7. Directly after the line that begins `Proposed decisions awaiting the CFO: ${JSON.stringify(`, add:
     ```
     Saved scenarios (simulate with their scenarioId): ${JSON.stringify(scenarioList)}
     ```
  Every replacement is inside the existing template literal. Check that none of the new text contains a backtick.

- [ ] **Step 5: Run the tests and verify they pass.** Run `pnpm --filter @finance/web test -- forecast-scenarios`. Expected: PASS for both the simulate unit test and the Task 2 DB suite. Then run `grep -n "being rebuilt" apps/web/src/app/api/agent/route.ts`. Expected: no output.

- [ ] **Step 6: Run the full verification.** Run the four commands in Global Constraints. Expected: all pass, and the lint counts are unchanged.

- [ ] **Step 7: Commit.**
```bash
git add apps/web/src/lib/forecast-scenarios.ts apps/web/src/lib/forecast-scenarios.simulate.test.ts apps/web/src/app/api/agent/route.ts
git commit -m "$(cat <<'EOF'
Re-enable the agent's simulate tool on scenario changes over the base forecast

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 5: Dashboard switcher, overlay, editor, and "Try as scenario"

**Files:**
- Create: `apps/web/src/components/scenario-editor-dialog.tsx`, `apps/web/src/components/scenario-vs-base-line.tsx`
- Modify: `apps/web/src/components/app-shell.tsx`

**Interfaces:**
- Consumes:
  - HTTP: the Task 3 routes, plus `GET /api/decisions` (existing)
  - Task 1: `ScenarioSummary`, `ScenarioDetail`, `ScenarioForecastView`, `ScenarioChange`, `parseScenarioChange`, `describeScenarioChange`
  - `describeConsequence` (`consequence-copy.ts`)
  - In app-shell: `openEvidence` (C1), `readJson`, `setNotice`, `setAgentDecisions`, `proposedItems`, `runway`, `quietButton`, `actionButton`, and `cadenceKey`
- Produces:
  - `ScenarioEditorDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; scenario: ScenarioDetail | null; items: ScenarioItemOption[]; asOfMonth: string | null; onSaved: (scenarioId: string) => void; onDeleted: (scenarioId: string) => void })`
  - `type ScenarioItemOption = { id: string; label: string; direction: "receipt" | "spend"; amount: number | null }`
  - `ScenarioVsBaseLine(props: { forecast: ScenarioForecastView; onOpenEvidence?: ((evidenceId: string) => void) | undefined })`

UI has no test harness. Verify with typecheck and lint (spec: "UI: typecheck and lint"). Do not call `setState` synchronously in an effect body: the React 19 lint rules flag it. The dialog resets its state by being mounted fresh for each opening. The scenario forecast is ignored rather than cleared when the base is selected.

- [ ] **Step 1: Create the "Scenario vs base" line.** `apps/web/src/components/scenario-vs-base-line.tsx`:
```tsx
"use client";

import { describeConsequence } from "@/lib/consequence-copy";
import type { ScenarioForecastView } from "@/lib/scenario-changes";

/**
 * "Scenario vs base: …": the selected scenario's consequence against the base forecast, computed now, with
 * the documents behind the drivers it changes (C1 source links when `onOpenEvidence` is given).
 */
export function ScenarioVsBaseLine({ forecast, onOpenEvidence }: { forecast: ScenarioForecastView; onOpenEvidence?: ((evidenceId: string) => void) | undefined }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 border-b border-rule py-3 text-[13px] text-pencil">
      <span className="text-ink-2">{forecast.scenario.name} vs base:</span>
      <span>{describeConsequence(forecast.consequence, forecast.exceptions.length)}</span>
      {onOpenEvidence && forecast.sources.map((source) => (
        <button key={source.evidenceId} type="button" className="underline underline-offset-2" onClick={() => onOpenEvidence(source.evidenceId)}>
          {source.sourceName ?? "Open source"}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create the editor dialog.** `apps/web/src/components/scenario-editor-dialog.tsx`:
```tsx
"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { categories } from "@balsa/finance-engine";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { describeScenarioChange, parseScenarioChange, type ScenarioChange, type ScenarioDetail } from "@/lib/scenario-changes";

/** A confirmed base-forecast item a change can re-price or end. */
export type ScenarioItemOption = { id: string; label: string; direction: "receipt" | "spend"; amount: number | null };

type Cadence = "once" | "monthly" | "quarterly" | "annual";
type Draft = { kind: ScenarioChange["kind"]; label: string; direction: "receipt" | "spend"; amount: string; cadence: Cadence; effectiveFrom: string; effectiveTo: string; category: string; itemId: string; endMonth: string };

const field = "h-8 rounded-md border border-rule bg-background px-2 text-[13px] text-ink";
const cadences: Cadence[] = ["monthly", "quarterly", "annual", "once"];
const emptyDraft = (asOfMonth: string | null): Draft => ({ kind: "add_driver", label: "", direction: "spend", amount: "", cadence: "monthly", effectiveFrom: "", effectiveTo: "", category: "other", itemId: "", endMonth: asOfMonth ?? "" });

function draftToCandidate(draft: Draft): unknown {
  const amount = Number(draft.amount);
  if (draft.kind === "add_driver") return { kind: "add_driver", label: draft.label, direction: draft.direction, amount, cadence: draft.cadence, effectiveFrom: draft.effectiveFrom, ...(draft.effectiveTo ? { effectiveTo: draft.effectiveTo } : {}), category: draft.category };
  if (draft.kind === "change_amount") return { kind: "change_amount", itemId: draft.itemId, amount, effectiveFrom: draft.effectiveFrom };
  return { kind: "end_item", itemId: draft.itemId, effectiveTo: draft.endMonth };
}

/**
 * Create or edit a scenario: a name, a note, and an ordered list of hypothetical changes.
 * The parent mounts it fresh for each opening, so its state starts from `scenario` (null for a new one).
 * `asOfMonth` is the base forecast's as-of month; ending an item there removes it from the forecast.
 */
export function ScenarioEditorDialog({ open, onOpenChange, scenario, items, asOfMonth, onSaved, onDeleted }: {
  open: boolean; onOpenChange: (open: boolean) => void; scenario: ScenarioDetail | null; items: ScenarioItemOption[]; asOfMonth: string | null;
  onSaved: (scenarioId: string) => void; onDeleted: (scenarioId: string) => void;
}) {
  const [name, setName] = useState(() => scenario?.name ?? "");
  const [description, setDescription] = useState(() => scenario?.description ?? "");
  const [changes, setChanges] = useState<ScenarioChange[]>(() => scenario?.changes ?? []);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(asOfMonth));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const itemLabels = new Map(items.map((item) => [item.id, item.label]));
  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  function addChange() {
    const change = parseScenarioChange(draftToCandidate(draft));
    if (!change) {
      setError(draft.kind === "add_driver" ? "Enter a label, a positive amount with at most two decimals, a start month, and an end month no earlier than the start." : "Choose an item and a month, and a positive amount when re-pricing.");
      return;
    }
    setChanges((current) => [...current, change]);
    setDraft(emptyDraft(asOfMonth));
    setError(null);
  }

  async function save() {
    if (!name.trim()) { setError("Name the scenario."); return; }
    setSaving(true);
    setError(null);
    try {
      const body = JSON.stringify({ name: name.trim(), description: description.trim() || null, changes });
      const response = scenario
        ? await fetch(`/api/scenarios/${scenario.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body })
        : await fetch("/api/scenarios", { method: "POST", headers: { "content-type": "application/json" }, body });
      const result = (await response.json().catch(() => null)) as { scenario?: { id: string }; error?: string } | null;
      if (!response.ok || !result?.scenario) throw new Error(result?.error ?? "Unable to save the scenario");
      onSaved(result.scenario.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save the scenario");
      setSaving(false);
    }
  }

  async function remove() {
    if (!scenario) return;
    setSaving(true);
    const response = await fetch(`/api/scenarios/${scenario.id}`, { method: "DELETE" });
    if (!response.ok) { setError("Unable to delete the scenario"); setSaving(false); return; }
    onDeleted(scenario.id);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] rounded-xl border-rule sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="display text-[22px] font-medium" style={{ fontVariationSettings: '"opsz" 22' }}>{scenario ? "Edit scenario" : "New scenario"}</DialogTitle>
          <DialogDescription>A scenario changes the forecast only on this dashboard view. Promote it to turn its changes into proposals you apply one by one.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="grid gap-1.5 text-[13px] text-ink-2">Name<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus /></label>
          <label className="grid gap-1.5 text-[13px] text-ink-2">Note<Input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} placeholder="What this scenario explores" /></label>
          <div className="grid gap-1">
            <div className="text-[12px] uppercase tracking-[0.12em] text-ink-2">Changes</div>
            {changes.length === 0 && <p className="text-[13px] text-pencil">No changes yet.</p>}
            {changes.map((change, index) => (
              <div key={`${change.kind}-${index}`} className="flex items-center justify-between gap-3 border-b border-rule py-1.5 text-[13px]">
                <span className="min-w-0">{describeScenarioChange(change, change.kind === "add_driver" ? undefined : itemLabels.get(change.itemId))}</span>
                <button type="button" aria-label={`Remove change ${index + 1}`} title="Remove" className="text-ink-2 hover:text-ink" onClick={() => setChanges((current) => current.filter((_, position) => position !== index))}><Trash2 className="size-3.5" /></button>
              </div>
            ))}
            {scenario && scenario.itemCount > 0 && <p className="text-[12px] text-pencil">{scenario.itemCount} scenario item{scenario.itemCount === 1 ? "" : "s"} from applied decisions also apply.</p>}
          </div>
          <div className="grid gap-2 rounded-lg border border-rule p-3">
            <select aria-label="Change type" className={field} value={draft.kind} onChange={(event) => update({ kind: event.target.value as ScenarioChange["kind"] })}>
              <option value="add_driver">Add a receipt or expense</option>
              <option value="change_amount">Change an item&apos;s amount</option>
              <option value="end_item">End or remove an item</option>
            </select>
            {draft.kind === "add_driver" ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Input aria-label="Label" placeholder="Label" value={draft.label} onChange={(event) => update({ label: event.target.value })} />
                <select aria-label="Direction" className={field} value={draft.direction} onChange={(event) => update({ direction: event.target.value === "receipt" ? "receipt" : "spend" })}>
                  <option value="spend">Expense</option>
                  <option value="receipt">Receipt</option>
                </select>
                <Input aria-label="Amount" placeholder="Amount" inputMode="decimal" value={draft.amount} onChange={(event) => update({ amount: event.target.value })} />
                <select aria-label="Cadence" className={field} value={draft.cadence} onChange={(event) => update({ cadence: event.target.value as Cadence })}>
                  {cadences.map((cadence) => <option key={cadence} value={cadence}>{cadence}</option>)}
                </select>
                <label className="grid gap-1 text-[12px] text-ink-2">From<Input type="month" value={draft.effectiveFrom} onChange={(event) => update({ effectiveFrom: event.target.value })} /></label>
                <label className="grid gap-1 text-[12px] text-ink-2">To (optional)<Input type="month" value={draft.effectiveTo} onChange={(event) => update({ effectiveTo: event.target.value })} /></label>
                <select aria-label="Category" className={field} value={draft.category} onChange={(event) => update({ category: event.target.value })}>
                  {categories.map((category) => <option key={category} value={category}>{category.replace(/_/g, " ")}</option>)}
                </select>
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <select aria-label="Item" className={field} value={draft.itemId} onChange={(event) => update({ itemId: event.target.value })}>
                  <option value="">Choose a confirmed item</option>
                  {items.map((item) => <option key={item.id} value={item.id}>{item.label}{item.amount !== null ? ` · ${item.direction === "spend" ? "−" : "+"}$${item.amount.toLocaleString("en-US")}` : ""}</option>)}
                </select>
                {draft.kind === "change_amount" ? (
                  <>
                    <Input aria-label="New amount" placeholder="New amount" inputMode="decimal" value={draft.amount} onChange={(event) => update({ amount: event.target.value })} />
                    <label className="grid gap-1 text-[12px] text-ink-2">From<Input type="month" value={draft.effectiveFrom} onChange={(event) => update({ effectiveFrom: event.target.value })} /></label>
                  </>
                ) : (
                  <label className="grid gap-1 text-[12px] text-ink-2">Last month{asOfMonth ? ` (${asOfMonth} removes it)` : ""}<Input type="month" value={draft.endMonth} onChange={(event) => update({ endMonth: event.target.value })} /></label>
                )}
              </div>
            )}
            <div><Button type="button" variant="outline" size="sm" onClick={addChange}>Add change</Button></div>
          </div>
          {error && <p className="text-[13px] text-red-ink" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          {scenario && <Button type="button" variant="ghost" className="mr-auto text-red-ink" onClick={remove} disabled={saving}>Delete scenario</Button>}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" className="rounded-full" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save scenario"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Wire app-shell: imports and module helpers.** In `apps/web/src/components/app-shell.tsx`, locate each anchor by content, not by line number:
  1. In the `lucide-react` import on line 3, add `FlaskConical` after `FileText,`.
  2. After the line `import { ForecastWhatChanged } from "@/components/forecast-what-changed";`, add:
     ```tsx
     import { ScenarioEditorDialog, type ScenarioItemOption } from "@/components/scenario-editor-dialog";
     import { ScenarioVsBaseLine } from "@/components/scenario-vs-base-line";
     import type { ScenarioForecastView, ScenarioSummary } from "@/lib/scenario-changes";
     ```
  3. Immediately before the line `function Figure({ label, value, note, pencil, negative, onClick }`, add:
     ```tsx
     /** The scenario switcher's value for the base forecast. Scenario ids are uuids, so they never collide with it. */
     const baseScenario = "base";

     function shiftMonth(month: string, count: number) {
       const [year, number] = month.split("-").map(Number);
       const date = new Date(Date.UTC(year!, number! - 1 + count, 1));
       return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
     }

     function runwayLabel(months: number | null, horizonMonths: number) {
       return months === null ? `> ${horizonMonths} mo` : `${months} mo`;
     }
     ```
  4. In the `type ProposedItem = {` declaration, replace `type ProposedItem = { id: string;` with `type ProposedItem = { id: string; scenarioId?: string | null;`. `GET /api/items` already returns `scenarioId`.

- [ ] **Step 4: Add state.** Directly after the line that declares `const [runway, setRunway] = useState<`, add:
```tsx
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(baseScenario);
  const [scenarioForecast, setScenarioForecast] = useState<ScenarioForecastView | null>(null);
  const [scenarioRefreshKey, setScenarioRefreshKey] = useState(0);
  const [scenarioEditorMode, setScenarioEditorMode] = useState<"new" | "edit" | null>(null);
  const [promotingScenario, setPromotingScenario] = useState(false);
```

- [ ] **Step 5: Load the scenario list on mount.** In the mount effect whose body is
```tsx
    fetch("/api/decisions").then((response) => response.ok ? response.json() : null).then((payload) => { if (payload?.decisions) setAgentDecisions(payload.decisions); }).catch(() => undefined);
    refreshProposedItems().catch(() => undefined);
    refreshEntities().catch(() => undefined);
```
add a fourth line after `refreshEntities().catch(() => undefined);`:
```tsx
    refreshScenarios().catch(() => undefined);
```

- [ ] **Step 6: Add the scenario fetch effect and the actions.** Find the two consecutive lines
```tsx
  useEffect(() => {
    async function loadForecast() {
```
and insert this block immediately above them:
```tsx
  // A selected scenario's forecast is computed on demand. It is refetched when the base revision moves (the
  // base changed under it) or after an edit. It is never cleared synchronously: `scenarioView` ignores a stale one.
  useEffect(() => {
    if (selectedScenarioId === baseScenario) return;
    let cancelled = false;
    fetch(`/api/scenarios/${selectedScenarioId}/forecast`)
      .then(async (response) => {
        const payload = await readJson(response);
        if (cancelled) return;
        if (response.ok) setScenarioForecast(payload as ScenarioForecastView);
        else { setNotice(payload.error ?? "Unable to load the scenario."); setSelectedScenarioId(baseScenario); }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [selectedScenarioId, runway?.revision, scenarioRefreshKey]);

  async function refreshScenarios() {
    const response = await fetch("/api/scenarios");
    if (!response.ok) return;
    const payload = await readJson(response);
    setScenarios(payload.scenarios ?? []);
  }

  async function scenarioSaved(scenarioId: string) {
    setScenarioEditorMode(null);
    await refreshScenarios();
    setSelectedScenarioId(scenarioId);
    setScenarioRefreshKey((key) => key + 1);
  }

  async function scenarioDeleted() {
    setScenarioEditorMode(null);
    setSelectedScenarioId(baseScenario);
    await refreshScenarios();
  }

  async function promoteSelectedScenario() {
    if (selectedScenarioId === baseScenario) return;
    setPromotingScenario(true);
    try {
      const response = await fetch(`/api/scenarios/${selectedScenarioId}/promote`, { method: "POST" });
      const payload = await readJson(response);
      if (!response.ok) { setNotice(payload.error ?? "Unable to promote this scenario."); return; }
      const decisionsResponse = await fetch("/api/decisions");
      if (decisionsResponse.ok) { const decisionsPayload = await readJson(decisionsResponse); if (decisionsPayload.decisions) setAgentDecisions(decisionsPayload.decisions); }
      const count: number = payload.decisionIds?.length ?? 0;
      setNotice(count ? `Added ${count} proposal${count === 1 ? "" : "s"} from the scenario. Apply them one by one under Proposed treatments.` : "This scenario has no changes to propose.");
    } finally {
      setPromotingScenario(false);
    }
  }

  async function tryDecisionAsScenario(decisionId: string) {
    const response = await fetch("/api/scenarios/from-decision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decisionId }) });
    const payload = await readJson(response);
    if (!response.ok) { setNotice(payload.error ?? "Unable to try this decision as a scenario."); return; }
    await refreshScenarios();
    setSelectedScenarioId(payload.scenario.id);
    setNotice(`Showing scenario "${payload.scenario.name}" against the base forecast.`);
  }
```

- [ ] **Step 7: Derive the scenario view and the overlay bars.** Replace this block:
```tsx
  const bars = displayedForecastRows.map((month) => {
    const actual = month.actualReceipts !== 0 || month.actualSpending !== 0;
    const net = actual ? month.actualReceipts - month.actualSpending : month.receipts - month.spending;
    return { month: month.month, endMonth: month.endMonth, actual, net };
  });
  const maxAbs = Math.max(1, ...bars.map((bar) => Math.abs(bar.net)));
```
with:
```tsx
  // Only a forecast for the scenario currently selected is shown; a stale one (from a previous selection) is ignored.
  const scenarioView = scenarioForecast && selectedScenarioId !== baseScenario && scenarioForecast.scenario.id === selectedScenarioId ? scenarioForecast : null;
  const forecastAsOfMonth = runway ? shiftMonth(runway.horizonEnd, -runway.horizonMonths) : null;
  const scenarioItemOptions: ScenarioItemOption[] = proposedItems.filter((item) => item.status === "confirmed" && !item.scenarioId).map((item) => ({ id: item.id, label: item.label, direction: item.direction, amount: item.amount }));
  // Scenario net per displayed period, summed over forecast months in range, on the same cadence keys as the base bars.
  const scenarioNetByPeriod = new Map<string, number>();
  if (scenarioView && customRangeIsValid) {
    for (const month of scenarioView.months) {
      if (month.month < periodStartMonth || month.month > periodEndMonth) continue;
      const key = cadenceKey(month.month, statementCadence);
      scenarioNetByPeriod.set(key, (scenarioNetByPeriod.get(key) ?? 0) + Number(BigInt(month.receiptsMinor) - BigInt(month.spendingMinor)) / 100);
    }
  }
  const bars = displayedForecastRows.map((month) => {
    const actual = month.actualReceipts !== 0 || month.actualSpending !== 0;
    const net = actual ? month.actualReceipts - month.actualSpending : month.receipts - month.spending;
    const scenarioNet = actual ? null : scenarioNetByPeriod.get(month.month) ?? null;
    return { month: month.month, endMonth: month.endMonth, actual, net, scenarioNet };
  });
  const maxAbs = Math.max(1, ...bars.map((bar) => Math.abs(bar.net)), ...bars.map((bar) => Math.abs(bar.scenarioNet ?? 0)));
```

- [ ] **Step 8: Add the switcher and actions next to the period controls.** In the controls `div` (`className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2 md:justify-end"`), find the opening of the period-controls fragment:
```tsx
              {forecast.length > 0 && (
                <>
                  <Select value={periodPreset} onValueChange={selectPeriodPreset}>
```
Insert this immediately above it:
```tsx
              {forecast.length > 0 && (
                <>
                  <Select value={selectedScenarioId} onValueChange={setSelectedScenarioId}>
                    <SelectTrigger size="sm" className="h-7 rounded-md border-rule px-2 text-[13px] shadow-none dark:bg-transparent" aria-label="Scenario">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-rule">
                      <SelectItem value={baseScenario}>Base forecast</SelectItem>
                      {scenarios.map((scenario) => <SelectItem key={scenario.id} value={scenario.id}>{scenario.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {selectedScenarioId !== baseScenario && <button type="button" className={quietButton} disabled={!scenarioView} onClick={() => setScenarioEditorMode("edit")}>Edit</button>}
                  {selectedScenarioId !== baseScenario && <button type="button" className={quietButton} disabled={promotingScenario} onClick={() => { promoteSelectedScenario().catch(() => undefined); }}>{promotingScenario ? "Promoting…" : "Promote to proposals"}</button>}
                  <button type="button" className={quietButton} onClick={() => setScenarioEditorMode("new")}><Plus className="size-3.5" />New scenario</button>
                </>
              )}
```

- [ ] **Step 9: Show the scenario runway.** Replace the whole Runway `<Figure … />` element: the one starting `<Figure` whose first prop is `label={selectedEntity === "consolidated" ? "Runway" : "Consolidated runway"}` and ending at its `/>`. Put this in its place (the `else` branch is the existing element, unchanged):
```tsx
            {scenarioView ? (
              <Figure
                label={`Runway · ${scenarioView.scenario.name}`}
                value={runwayLabel(scenarioView.runway.runwayMonths, scenarioView.runway.horizonMonths)}
                note={`vs base ${runwayLabel(scenarioView.consequence ? scenarioView.consequence.runwayMonths.before : scenarioView.runway.runwayMonths, scenarioView.runway.horizonMonths)}${scenarioView.runway.cashOutMonth ? ` · cash-out ${monthLabel(scenarioView.runway.cashOutMonth)}` : " · no cash-out in horizon"}`}
                pencil
                negative={scenarioView.runway.runwayMonths !== null && scenarioView.runway.runwayMonths < 6}
              />
            ) : (
              <Figure
                label={selectedEntity === "consolidated" ? "Runway" : "Consolidated runway"}
                value={runway ? (runway.runwayMonths === null ? `> ${runway.horizonMonths} mo` : `${runway.runwayMonths} mo`) : "—"}
                note={runway ? `${runway.cashOutMonth ? `Cash-out ${monthLabel(runway.cashOutMonth)}` : "No cash-out in horizon"}${BigInt(runway.trailingBurn3mMinor) > 0n ? ` · burn ${money(Number(runway.trailingBurn3mMinor) / 100)}/mo` : ""}${runway.cashOverTrailingBurn && Number(runway.cashOverTrailingBurn) !== 0 ? ` · ${runway.cashOverTrailingBurn}× burn` : ""}${runway.stale ? " · updating" : ""}${selectedEntity === "consolidated" ? "" : " · all entities"}` : "Forecast not calculated yet"}
                pencil
                negative={Boolean(runway?.runwayMonths !== null && runway?.runwayMonths !== undefined && runway.runwayMonths < 6)}
                {...(runway ? { onClick: () => openCalculationTrace("forecast") } : {})}
              />
            )}
```
Do not change the Cash, Cash in, Cash out, or Net figures (spec ruling). The scenario Runway figure has no `onClick`: the calculation trace shows the base run.

- [ ] **Step 10: Add the "vs base" line.** Directly above the line `{runway && <ForecastWhatChanged refreshKey={runway.revision} onOpenEvidence={openEvidence} />}`, add:
```tsx
          {scenarioView && <ScenarioVsBaseLine forecast={scenarioView} onOpenEvidence={openEvidence} />}
```

- [ ] **Step 11: Draw the overlay bars and the legend.**
  1. After the legend line `<span><i className="mr-1.5 inline-block size-2.5 rounded-[2px] bg-pencil-2 align-[-1px]" />Forecast</span>`, add:
     ```tsx
                     {scenarioView && <span><i className="mr-1.5 inline-block size-2.5 rounded-[2px] border-[1.5px] border-ink align-[-1px]" />{scenarioView.scenario.name}</span>}
     ```
  2. In the `<svg … aria-label={`Net cash flow by ${statementCadence}. Closed periods in ink, forecast periods in pencil.`}>` attribute, change the template to `` `Net cash flow by ${statementCadence}. Closed periods in ink, forecast periods in pencil.${scenarioView ? ` Outlined bars: ${scenarioView.scenario.name}.` : ""}` ``.
  3. Replace the whole `{bars.map((bar, index) => { … })}` expression inside the svg with:
```tsx
                {bars.map((bar, index) => {
                  const slot = 720 / bars.length;
                  const overlay = scenarioView !== null;
                  const width = overlay ? Math.min(20, slot * 0.34) : Math.min(28, slot * 0.5);
                  const center = index * slot + slot / 2;
                  const x = overlay ? center - width - 1 : center - width / 2;
                  const height = Math.max(2, (Math.abs(bar.net) / maxAbs) * 65);
                  const negative = bar.net < 0;
                  const selected = bar.endMonth === selectedMonth;
                  const scenarioHeight = bar.scenarioNet === null ? 0 : Math.max(2, (Math.abs(bar.scenarioNet) / maxAbs) * 65);
                  return (
                    <g key={bar.month} className="cursor-pointer" onClick={() => { setSelectedMonth(bar.endMonth); setRangeEnd(lastDayOfMonth(bar.endMonth)); }}>
                      <title>{`${cadenceLabel(bar.month, statementCadence)}: ${money(bar.net)} ${bar.actual ? "actual" : "forecast"}${scenarioView && bar.scenarioNet !== null ? ` · ${money(bar.scenarioNet)} in ${scenarioView.scenario.name}` : ""}`}</title>
                      <rect x={x} y={negative ? zeroY : zeroY - height} width={width} height={height} className={cn(negative ? "fill-red-ink" : bar.actual ? "fill-ink" : "fill-pencil-2")} opacity={negative && !bar.actual ? 0.35 : 1} />
                      {bar.scenarioNet !== null && <rect x={center + 1} y={bar.scenarioNet < 0 ? zeroY : zeroY - scenarioHeight} width={width} height={scenarioHeight} fill="none" strokeWidth="1.5" vectorEffect="non-scaling-stroke" className={cn(bar.scenarioNet < 0 ? "stroke-red-ink" : "stroke-ink")} />}
                      <text x={center} y="162" textAnchor="middle" fontSize="11" className={cn("font-sans", selected ? "fill-ink" : "fill-pencil")}>{statementCadence === "monthly" ? monthLabel(bar.month, shortMonthFormatter) : cadenceLabel(bar.month, statementCadence)}</text>
                    </g>
                  );
                })}
```
The scenario bars share `maxAbs` with the base bars (Step 7), so both use one scale. Only non-actual periods get an outlined bar.

- [ ] **Step 12: Add "Try as scenario" to each proposed decision.** In the proposed-decision row, directly after the button with `aria-label="Discuss proposed decision in chat"`, add:
```tsx
                        {decision.effectSummary && <button className={actionButton} type="button" aria-label="Try proposed decision as a scenario" title="Try as scenario" onClick={() => { tryDecisionAsScenario(decision.id).catch(() => undefined); }}><FlaskConical /></button>}
```
Only decisions with a structured effect get the button. The server still answers 400 for a `set_category` effect, and the notice shows the message.

- [ ] **Step 13: Mount the editor.** Directly above `<Dialog open={Boolean(editingItem)} onOpenChange={(open) => { if (!open) setEditingItem(null); }}>`, add:
```tsx
      {scenarioEditorMode && (
        <ScenarioEditorDialog
          open
          onOpenChange={(open) => { if (!open) setScenarioEditorMode(null); }}
          scenario={scenarioEditorMode === "edit" ? scenarioView?.scenario ?? null : null}
          items={scenarioItemOptions}
          asOfMonth={forecastAsOfMonth}
          onSaved={(scenarioId) => { scenarioSaved(scenarioId).catch(() => undefined); }}
          onDeleted={() => { scenarioDeleted().catch(() => undefined); }}
        />
      )}
```

- [ ] **Step 14: Verify.** Run `pnpm -r typecheck` and `pnpm --filter @finance/web lint`. Expected: typecheck passes, and the lint error and warning counts equal the baseline. If lint flags `react-hooks/set-state-in-effect` on the Step 6 effect, check that no `set…` call runs synchronously in the effect body; the ones inside `.then` are allowed. If it flags the Step 5 mount-effect line, it flags `refreshProposedItems` there too; check whether that was already part of the baseline. Then run `pnpm --filter @finance/web test` and `pnpm --filter @balsa/finance-engine test`. Expected: PASS.

- [ ] **Step 15: Smoke test by hand (recommended, not gating).** Run `pnpm --filter @finance/web dev` and open the dashboard of a company with a forecast. Then:
  1. **New scenario:** add an expense, save. The switcher selects it; Runway shows the scenario value with "vs base N mo"; the "… vs base:" line appears; outlined bars sit beside the forecast bars; Cash, Cash in, Cash out, and Net are unchanged.
  2. **Edit:** add an `end_item` at the as-of month. Runway updates after saving.
  3. **Promote to proposals:** new rows appear under "Proposed treatments".
  4. **Try as scenario** on a proposed decision: a new scenario is selected.
  5. **Base forecast:** the overlay disappears.

- [ ] **Step 16: Commit.**
```bash
git add apps/web/src/components/app-shell.tsx apps/web/src/components/scenario-editor-dialog.tsx apps/web/src/components/scenario-vs-base-line.tsx
git commit -m "$(cat <<'EOF'
Add the dashboard scenario switcher, overlay bars, editor, and try-as-scenario

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 6: Spec sync and final verification

**Files:**
- Modify: `internal/specs/2026-09-18-forecast-scenarios-design.md`

**Interfaces:** None. This task records the rulings made while planning, which the constraints require whenever behavior differs from the spec.

- [ ] **Step 1: Append the rulings to the spec.** Add this section to the end of `internal/specs/2026-09-18-forecast-scenarios-design.md`:
```markdown
## Rulings made during implementation planning

- **Change types.**
  - `add_driver.category` is one of the engine's `categories` (not any string). A missing category becomes `other`, both when applying and when promoting, so the two agree.
  - Amounts are dollars (at most two decimals), like decision effects.
- **Change targets.** `change_amount` and `end_item` may target only the company's confirmed base-forecast items (not drafts, scenario items, or another company's items). A write that breaks this is rejected with 400. At run time, a change whose item no longer exists does nothing.
- **Names.** Uniqueness is checked in the application, among active scenarios, by exact trimmed name (the same comparison the decision path uses). There is no database index, because existing rows may already repeat a name. The decision `add_item` path now files items only under an **active** scenario of that name; a deleted scenario's name starts a new one.
- **Driver lineage.**
  - A driver a scenario adds carries `scenarioId` and no `decisionId`.
  - A base driver a scenario ends or re-prices keeps its own `decisionId`.
  - A re-priced copy keeps the original's evidence, so C1 sources resolve.
- **Promotion.**
  - Promotion creates proposals for confirmed scenario items first, then for the changes in order, which is the order a scenario run applies them.
  - Questions read `Apply from scenario <name>: <line>`, with the item named for `change_amount` and `end_item`.
  - An item that cannot be expressed as an `add_item` (no positive amount or valid months) is skipped and counted in `skippedItems`.
  - The scenario is left as it is.
- **Try as scenario.**
  - The scenario name is the decision's question (at most 80 characters), with ` (2)`, ` (3)`, … added when it is taken.
  - An `add_item`'s counterparty, non-cash treatment, recognition window, and scenario name are not carried.
  - A `set_category` or effect-less decision gets 400, and a non-proposed decision gets 409.
- **API shapes.**
  - `GET /api/scenarios/[id]/forecast` returns `scenario` as `{ id, name, description, changes, itemCount }`.
  - Promote returns `{ decisionIds, skippedItems }`.
- **UI.**
  - The editor also offers "Delete scenario" (the soft delete), so `DELETE` is reachable.
  - The "vs base" runway is `consequence.runwayMonths.before` from the same computation.
  - The scenario Runway figure has no trace link.
- **Agent.** The context lists saved scenarios so that `simulate { scenarioId }` is usable. A flat change carries all nine keys, with unused ones null.
```

- [ ] **Step 2: Run the final verification.** Run all four Global Constraints commands once more:
  - `pnpm --filter @balsa/finance-engine test`
  - `pnpm --filter @finance/web test`: confirm that `forecast-scenarios`, `scenarios`, and `forecast-preview` ran, not skipped
  - `pnpm -r typecheck`
  - `pnpm --filter @finance/web lint`: at the baseline counts

- [ ] **Step 3: Commit.**
```bash
git add internal/specs/2026-09-18-forecast-scenarios-design.md
git commit -m "$(cat <<'EOF'
Record forecast scenario planning rulings in the spec

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

### Spec coverage

| Spec section | Requirement | Task |
|---|---|---|
| Idea | Scenario result is `buildForecastRun`, compared with `diffForecastRuns`; no second engine | 1 (`runSimulation`), 2 |
| S1 | `ScenarioChange` with the three kinds; `applyScenarioChanges(drivers, changes, scenarioId)` | 1 |
| S1 | Reuse `projectDecisionEffectOnDrivers` through the mapped `DecisionEffect` | 1 (`scenarioChangeToEffect`, applier) |
| S1 | Added driver ids `scenario:<scenarioId>:<index>` | 1 (`scenarioDriverId`, tests) |
| S1 ruling | Remove = `end_item` at the as-of | 1 (docs), 5 (editor "Last month (as-of removes it)"), 4 (prompt) |
| S2 | Migration: `description text`, `changes jsonb NOT NULL DEFAULT '[]'`; keep `name` and `active` | 2 |
| S2 ruling | Scenario run = base + scenario's confirmed items + changes; decision and state/mutate paths keep working | 2 (`loadScenarioForecast`, items test), 3 (active-name fix) |
| S3 | Extract `loadForecastBase(companyId, now)` from the preview; both use it | 2 (Steps 6–7, preview suite regression) |
| S3 | Company-scoped scenario load, base + items + changes, diff, C1 sources | 2 (`loadActiveScenario`, `resolveSources`, tests) |
| S3 | Returns `{ scenario, months (forecast basis), runway, consequence, exceptions, sources }`; nothing persisted | 2 (return shape, "persists nothing" test) |
| S4 | `GET /api/scenarios` with id, name, description, changeCount, itemCount | 3 |
| S4 | `POST` `{ name, description?, changes? }`; duplicate active name → 409 | 3 |
| S4 | `PATCH` replaces changes; `DELETE` soft-deactivates | 3 |
| S4 | `GET /api/scenarios/[id]/forecast` | 3 (route over the Task 2 loader) |
| S4 | `POST …/promote`: one proposed decision per change and per scenario item, question format, returns ids, nothing applied | 3 |
| S4 | `POST /api/scenarios/from-decision` | 3 |
| S4 | zod validation, company scoping, no revision bump | 3 (routes, scoping test), 2 (revision unchanged test) |
| S5 | Scenario select next to the period controls: "Base forecast" plus active scenarios | 5 (Step 8) |
| S5 | Separate `scenarioForecast` state; `applyJournalDashboard` untouched | 5 (Steps 4, 6) |
| S5 | Runway shows the scenario runway with "vs base N mo" | 5 (Step 9) |
| S5 | "Scenario vs base" line with `describeConsequence` and source links | 5 (Steps 1, 10) |
| S5 | Outlined, offset overlay bars for forecast months, shared scale, third legend entry | 5 (Steps 7, 11) |
| S5 | Edit dialog (list, add via small form incl. pick a confirmed item, remove, PATCH on save); Promote; New scenario | 5 (Steps 2, 8, 13) |
| S5 | "Try as scenario" on each proposed decision | 5 (Step 12) |
| S5 ruling | Cash, Cash in, Cash out, and Net stay base | 5 (Step 9 note; the figures are not edited) |
| S6 | Re-enable `simulate` with `{ changes }` (flat) or `{ scenarioId }`; output `{ runway, consequence, exceptions }` via `loadForecastBase` + `applyScenarioChanges`; no writes | 4 |
| S6 | System prompt update | 4 (Step 4) |
| Testing: pure | Each kind, ordering, parity with `projectDecisionEffectOnDrivers` | 1 |
| Testing: DB | add_driver scenario = equivalent decision preview | 2 |
| Testing: DB | Scenario-tagged items included | 2 |
| Testing: DB | Company scoping, another company's id → not found (404 via `scenarioErrorResponse`) | 2, 3 |
| Testing: DB | Promote → apply one by one → scenario runway | 3 |
| Testing: DB | from-decision round trip | 3 |
| Testing: agent | `simulate` handler with a stubbed base | 4 |
| Testing: UI | Typecheck and lint | 5 |

### Placeholder scan

- No "TBD", "TODO", "handle edge cases", or "similar to Task N" remains. Every created file has its full contents in the plan.
- `scenarios.ts` and `forecast-scenarios.ts` are given in full twice: once in Task 2, and once as a whole-file replacement in Tasks 3 and 4. There are no partial "append" instructions.
- App-shell edits are anchored by quoted content. The one replaced element (the Runway figure) is reproduced in full.
- The only conditional instruction is the precondition check that C1's `driverEvidenceIds` exists, with the fallback of using its actual name.

### Type consistency

- `ScenarioChange`, `ScenarioDetail`, `ScenarioSummary`, and `ScenarioForecastView` are defined once, in `scenario-changes.ts`. Server modules, routes, the agent, and client components all import them from there.
- `ScenarioDetail.description` is `string | null` in the type, the DB column, `toDetail`, and the tests.
- `loadActiveScenario`, `createScenario`, `updateScenario`, and `scenarioFromDecision` all return `ScenarioDetail`. `listScenarios` returns `ScenarioSummary[]`. `promoteScenario` returns `{ decisionIds: string[]; skippedItems: number }` in the lib, the route, the test, and the UI (`payload.decisionIds`).
- `runSimulation(base, changes, { scenarioId?, scenarioDrivers? })` is called the same way in `loadScenarioForecast`, `simulateForAgent`, and the tests. It returns `{ baseRun, run, consequence }`.
- `applyScenarioChanges(drivers, changes, scenarioId)` → `ForecastDriver[]`. Ids use `scenarioDriverId`, which the tests pin as `scenario:<id>:<index>`.
- `ConsequenceSource` (C1) is `{ evidenceId: string; sourceName: string | null }`, used by `resolveSources` and `ScenarioVsBaseLine`.
- Errors: `ScenarioNotFound` → 404, `ScenarioConflict` → 409, `ScenarioInvalid` → 400. The same class names are used in the lib, `scenario-http.ts`, the tests, and `simulateForAgent`.
- With `exactOptionalPropertyTypes`, every optional field in the parsers, the routes (`description`, `name`, `changes`), `effectToScenarioChange`, and `draftToCandidate` is built with a conditional spread.
