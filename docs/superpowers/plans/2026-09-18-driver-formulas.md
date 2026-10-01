# Driver Formulas Implementation Plan

> **COMPLETE PLAN (2026-09-18):** Tasks 1–8 and the self-review are written. Implementation has not started; execute the tasks in order.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a forecast driver take its monthly amount from a formula over a small dimensional model (named dimensions plus variables that hold dated inputs or a formula), so a change flows headcount → payroll → payroll tax → cash → runway → consequences and previews, using our own grammar and never JavaScript evaluation.

**Architecture:**
- A pure engine module, `packages/finance-engine/src/forecast-model.ts`, holds the decimal arithmetic (bigint at scale 10^6), a tokenizer and recursive-descent parser with character positions, a static checker (dimensions, names, limits, cycles), and a cube evaluator with broadcasting.
- `resolveFormulaDrivers` turns each driver's `amountFormula` into `amountByMonth` (minor units). `buildForecastRun` resolves formula drivers before projection, and `buildProjectedEntries` posts the per-month amounts. A run with no formula driver takes the old code path, so its output is byte-identical.
- The web layer stores the model in two new tables (`forecast_dimensions`, `forecast_variables`) and one new column (`economic_items.amount_formula`). It loads the model into `ForecastRunInput.model` in canonical order and exposes CRUD, a dry-run validator, decision effects, scenario changes, and a Model panel. Every model write validates the whole resulting model and then bumps the financial-state revision.

**Tech Stack:** TypeScript 6 (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), vitest 5, Drizzle ORM 0.45 on postgres-js, zod 4, Next.js 16 route handlers, React 19, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-18-driver-formulas-design.md`. It builds on and extends `docs/superpowers/specs/2026-09-18-forecast-scenarios-design.md` (F7).

**Prerequisite:** This plan assumes two changes have already landed on `feature/forecast-consequences`: the traceability change (C1, which adds `sources` to the preview result) and the scenarios feature (C2, plan `docs/superpowers/plans/2026-09-18-forecast-scenarios.md`). Where a step depends on scenario code, it names the interface from the scenarios spec:
- `apps/web/src/lib/scenario-changes.ts`: `ScenarioChange` and `applyScenarioChanges(drivers, changes, scenarioId)`
- `apps/web/src/lib/forecast-scenarios.ts`: `loadForecastBase(companyId, now)` and `loadScenarioForecast(companyId, scenarioId, now?)`
- the scenarios migration, which adds `scenarios.description` and `scenarios.changes`

If a landed signature differs, adapt the call and keep the behavior this plan describes. Before Task 4, run `ls packages/database/drizzle` and `grep -n "loadForecastBase\|applyScenarioChanges" -r apps/web/src` to confirm what landed.

## Global Constraints

- **Values.** A model value is a `bigint` at scale 10^6 (`modelScale = 1_000_000n`).
  - Decimal text matches `/^-?\d+(\.\d{1,6})?$/`. More than 6 fractional digits is invalid.
  - `*` multiplies, then rescales by dividing by 10^6, rounding **half-even**.
  - `/` computes `a·10^6 / b`, rounding **half-even**. Division by zero gives an error cell.
  - `round(x, n)` rounds **half away from zero** to `n` places, where `0 ≤ n ≤ 6`.
  - A result whose magnitude exceeds `modelValueCap = 10n ** 21n` (10^15 currency units) is an error cell.
  - An error cell is represented as `null`. Any operation that touches an error cell produces an error cell. Evaluation never throws on data.
- **Money.** Formula money is in major currency units. A driver converts to minor units once: multiply by 100 and round **half away from zero** (`decimalToMinorUnits(v) = divideHalfAwayFromZero(v, 10_000n)`).
- **Limits** (`modelLimits`):
  - A formula is at most 2,000 characters.
  - A model has at most 200 variables and at most 12 dimensions, and each dimension has at most 500 items.
  - Parser nesting depth is at most 200.
  - Cells are counted as the product of dimension sizes × months. The cap is 250,000 for every variable **and** for every intermediate expression.
  - The default month count for validation is 25 (the as-of month plus the 24-month horizon).
- **Names.** Variable, dimension, and item names match `/^[A-Za-z_][A-Za-z0-9_]*$/`. Variable names may not be `sum`, `avg`, `min`, `max`, `prev`, or `round`.
- `forecastFormulaVersion` stays `"forecast-run-2026-09-18.2"`. A run with no formula driver is byte-identical under `stableJson` to today's run, with or without a `model`. It has no `modelSummary` key. The equivalence test proves this.
- **No JavaScript evaluation.** No `eval`, no `new Function`, and no dynamic `import` of formula text. Formulas are tokenized and parsed by the grammar in Task 1.
- Money outside the model stays minor units, held as strings or as `bigint`.
- Pure modules have no `server-only` import and no DB access. Server modules start with `import "server-only"`.
- Use conditional spreads for optional properties. Never assign `undefined` (`exactOptionalPropertyTypes`).
- Company-scope every query.
- Nothing inside `runForecastJob`'s transaction may call `getDatabase()`. Every loader it calls must use the `db` it is passed.
- The same rule applies to scenario validation and decision application: executor-aware `...With(db, ...)` implementations contain the logic; public wrappers may open a transaction, but code already in a transaction must call the shared implementation. DB tests must prove these paths work with the local database's single-connection limit.
- Commit on branch `feature/forecast-consequences`, and do not push. End every commit message with a `Co-Authored-By:` trailer naming the model that implemented the task, for example `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- DB-backed tests follow `apps/web/src/lib/forecast-job.test.ts`:
  - load dotenv from the repo root
  - wrap the suite in `describe.skipIf(!process.env.DATABASE_URL)` and put `if (!process.env.DATABASE_URL) return;` first in its factory
  - use dynamic imports
  - create and delete their own company
  - run against the local dev DB, which is approved
- Migrations are handwritten SQL in the 0072 style (RLS on new tables), plus a `drizzle/meta/_journal.json` entry. Apply them with `pnpm --filter @finance/database db:migrate`. No destructive SQL.
- Lint baseline is 10 errors and 13 warnings, all pre-existing. Add none.
- If behavior ends up differing from the spec, update the spec (Task 8, final step).

Commands:
- Engine: `pnpm --filter @balsa/finance-engine test`
- Web: `pnpm --filter @finance/web test`
- Types: `pnpm -r typecheck`
- Lint: `pnpm --filter @finance/web lint`
- Migrate: `pnpm --filter @finance/database db:migrate`

---

## File Structure

**Engine (pure)**
- `packages/finance-engine/src/forecast-model.ts` (new): decimals, tokenizer, parser, validation, evaluator, `resolveFormulaDrivers`, `canonicalizeModel`, `monthRange`.
- `packages/finance-engine/src/forecast-model.test.ts` (new): arithmetic and parser tests.
- `packages/finance-engine/src/forecast-model-evaluate.test.ts` (new): evaluator, validation, and resolution tests.
- `packages/finance-engine/src/forecast-model-run.test.ts` (new): the worked headcount → payroll → tax → cash end-to-end test.
- `packages/finance-engine/src/forecast-projections.ts`: `ForecastDriver.amountFormula` and `amountByMonth`, with per-month amounts in projection.
- `packages/finance-engine/src/forecast-run.ts`: `ForecastRunInput.model` and `ForecastRun.modelSummary`, with formula resolution before projection.
- `packages/finance-engine/src/forecast-consequence.ts`: compares `amountFormula`, and `amountByMonth` over common months.
- `packages/finance-engine/src/forecast-run.reference.ts`: gains a frozen `buildProjectedEntriesReference`.
- `packages/finance-engine/src/forecast-equivalence.test.ts`: byte-identity with an empty or unused model, and projection identity.
- `packages/finance-engine/src/index.ts`: exports `./forecast-model`.

**Database**
- `packages/database/drizzle/0075_forecast_model.sql` (new): use the next free number, see Task 4.
- `packages/database/drizzle/meta/_journal.json`: new entry.
- `packages/database/src/schema.ts`: `forecastDimensions`, `forecastVariables`, and `economicItems.amountFormula`.

**Web, pure**
- `apps/web/src/lib/forecast-model-rows.ts` and `.test.ts` (new): mapping rows to the model, draft merging, `variableFromDraft`.
- `apps/web/src/lib/forecast-model-schema.ts` (new): zod schemas shared by the routes and decision effects.
- `apps/web/src/lib/forecast-drivers.ts`: carries `amountFormula`.
- `apps/web/src/lib/revision-cause.ts`: `model_changed` and `item_formula_changed`.
- `apps/web/src/lib/consequence-copy.ts`: labels for the new causes.
- `apps/web/src/lib/decision-driver-effects.ts`: `projectDecisionEffect(input, effect, decisionId)`.
- `apps/web/src/lib/scenario-changes.ts` (landed with scenarios): `set_input` and `set_formula`, applied as an input-level transform.

**Web, server**
- `apps/web/src/lib/forecast-inputs.ts`: `loadForecastModel` and `resolveDriversForWindow`, and the model in `loadForecastInputs`.
- `apps/web/src/lib/forecast-model-store.ts` (new): validated CRUD, upserts, `setItemFormula`, `validateModelDraft`, `ModelWriteError`.
- `apps/web/src/lib/forecast-model-http.ts` (new): route helpers.
- `apps/web/src/lib/forecast-model-fixture.ts` (new, test-only): `seedModelCompany`.
- `apps/web/src/lib/forecast-read.ts`: labels for variables and dimensions.
- `apps/web/src/lib/forecast-preview.ts` and `forecast-scenarios.ts` (`loadForecastBase`): reload the model, handle `amountFormula` edits, and use `projectDecisionEffect`.
- `apps/web/src/lib/forecast-plan-pin.ts` and `apps/web/src/app/api/forecast-projections/route.ts`: resolve formula drivers.
- `apps/web/src/lib/decision-effects.ts`: new effect kinds, applied through the store.
- Routes:
  - `apps/web/src/app/api/forecast/model/route.ts`
  - `apps/web/src/app/api/forecast/model/dimensions/route.ts` and `dimensions/[id]/route.ts`
  - `apps/web/src/app/api/forecast/model/variables/route.ts` and `variables/[id]/route.ts`
  - `apps/web/src/app/api/forecast/model/validate/route.ts`
- `apps/web/src/app/api/items/route.ts` and `apps/web/src/app/api/forecast/preview/route.ts`: accept `amountFormula`.
- `apps/web/src/app/api/agent/route.ts`: prompt and model context.
- DB tests (new):
  - `forecast-model-load.test.ts`
  - `forecast-model-store.test.ts`
  - `forecast-model-decisions.test.ts`
  - `forecast-scenarios-model.test.ts`

**UI**
- `apps/web/src/components/item-formula-field.tsx` (new): `ItemFormulaField` and `useModelDryRun`.
- `apps/web/src/components/forecast-model-panel.tsx` (new): the Model tab.
- `apps/web/src/components/accounting-modal.tsx`: adds the "Model" tab.
- `apps/web/src/components/app-shell.tsx`: adds the Formula field on draft item rows.
- `apps/web/src/components/forecast-consequence-line.tsx`: accepts `edits.amountFormula`.

---

### Task 1: Decimal arithmetic, tokenizer, and parser

**Files:**
- Create: `packages/finance-engine/src/forecast-model.ts`
- Create: `packages/finance-engine/src/forecast-model.test.ts`
- Modify: `packages/finance-engine/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (exported from `@balsa/finance-engine`):
  - `modelScale: bigint`, `modelValueCap: bigint`, `modelLimits`, `defaultModelMonthCount: number`, `modelFunctionNames`
  - `type ModelReducer = "sum" | "avg" | "min" | "max"`
  - `isModelIdentifier(value: string): boolean`
  - `parseDecimal(text: string): bigint | null`, `formatDecimal(value: bigint): string`
  - `divideHalfEven(numerator: bigint, denominator: bigint): bigint`, `divideHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint`
  - `multiplyDecimal(left: bigint, right: bigint): bigint`, `divideDecimal(left: bigint, right: bigint): bigint | null`, `roundDecimal(value: bigint, places: number): bigint`, `decimalToMinorUnits(value: bigint): bigint`
  - `class FormulaSyntaxError extends Error { position: number }`
  - `type FormulaToken = { type: "number" | "ident" | "op" | "end"; text: string; position: number }`, `tokenizeFormula(formula: string): FormulaToken[]`
  - `type FormulaSelector`, `type FormulaNode`, `type FormulaParseResult`, `parseFormula(formula: string): FormulaParseResult`

- [ ] **Step 1: Write the failing tests.** Create `packages/finance-engine/src/forecast-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decimalToMinorUnits, divideDecimal, divideHalfAwayFromZero, divideHalfEven, formatDecimal, isModelIdentifier, multiplyDecimal, parseDecimal, parseFormula, roundDecimal, tokenizeFormula } from "./forecast-model";

const parsed = (formula: string) => {
  const result = parseFormula(formula);
  if (!result.ok) throw new Error(`${result.error.message} at ${result.error.position}`);
  return result.node;
};
const failure = (formula: string) => {
  const result = parseFormula(formula);
  if (result.ok) throw new Error(`expected "${formula}" to fail`);
  return result.error;
};

describe("model decimals", () => {
  it("parses and formats scale-6 decimals", () => {
    expect(parseDecimal("1.5")).toBe(1_500_000n);
    expect(parseDecimal("-0.000001")).toBe(-1n);
    expect(parseDecimal("42")).toBe(42_000_000n);
    expect(parseDecimal("1.1234567")).toBeNull();
    expect(parseDecimal("1.")).toBeNull();
    expect(parseDecimal(".5")).toBeNull();
    expect(parseDecimal("1e3")).toBeNull();
    expect(formatDecimal(1_500_000n)).toBe("1.5");
    expect(formatDecimal(-1n)).toBe("-0.000001");
    expect(formatDecimal(3_000_000n)).toBe("3");
    expect(formatDecimal(0n)).toBe("0");
  });

  it("divides half-even", () => {
    expect([divideHalfEven(5n, 2n), divideHalfEven(7n, 2n), divideHalfEven(-5n, 2n), divideHalfEven(-7n, 2n), divideHalfEven(5n, -2n), divideHalfEven(1n, 3n), divideHalfEven(2n, 3n)]).toEqual([2n, 4n, -2n, -4n, -2n, 0n, 1n]);
    expect(divideDecimal(1_000_000n, 3_000_000n)).toBe(333_333n);
    expect(divideDecimal(2_000_000n, 3_000_000n)).toBe(666_667n);
    // 0.0000005 and 0.0000015 sit exactly halfway: each goes to its even neighbour.
    expect(divideDecimal(1_000_000n, 2_000_000_000_000n)).toBe(0n);
    expect(divideDecimal(3_000_000n, 2_000_000_000_000n)).toBe(2n);
    expect(divideDecimal(1_000_000n, 0n)).toBeNull();
  });

  it("rescales products half-even", () => {
    expect(multiplyDecimal(1_500_000n, 1_500_000n)).toBe(2_250_000n);
    expect(multiplyDecimal(1n, 500_000n)).toBe(0n);
    expect(multiplyDecimal(3n, 500_000n)).toBe(2n);
    expect(multiplyDecimal(-3n, 500_000n)).toBe(-2n);
  });

  it("rounds half away from zero for round() and for minor units", () => {
    expect(divideHalfAwayFromZero(5n, 2n)).toBe(3n);
    expect(divideHalfAwayFromZero(-5n, 2n)).toBe(-3n);
    expect(divideHalfAwayFromZero(4n, 3n)).toBe(1n);
    expect(roundDecimal(2_345_000n, 2)).toBe(2_350_000n);
    expect(roundDecimal(-2_345_000n, 2)).toBe(-2_350_000n);
    expect(roundDecimal(2_500_000n, 0)).toBe(3_000_000n);
    expect(roundDecimal(333_333n, 4)).toBe(333_300n);
    expect(decimalToMinorUnits(1_005_000n)).toBe(101n);
    expect(decimalToMinorUnits(-1_005_000n)).toBe(-101n);
    expect(decimalToMinorUnits(1_004_999n)).toBe(100n);
    expect(decimalToMinorUnits(12_340_000n)).toBe(1_234n);
  });

  it("recognizes model identifiers", () => {
    expect(["team_1", "_x", "Eng"].map(isModelIdentifier)).toEqual([true, true, true]);
    expect(["1x", "a-b", "", "a b"].map(isModelIdentifier)).toEqual([false, false, false, false]);
  });
});

describe("formula tokenizer", () => {
  it("tokenizes with character positions", () => {
    expect(tokenizeFormula("a[t=E]*2.5")).toEqual([
      { type: "ident", text: "a", position: 0 }, { type: "op", text: "[", position: 1 }, { type: "ident", text: "t", position: 2 },
      { type: "op", text: "=", position: 3 }, { type: "ident", text: "E", position: 4 }, { type: "op", text: "]", position: 5 },
      { type: "op", text: "*", position: 6 }, { type: "number", text: "2.5", position: 7 }, { type: "end", text: "", position: 10 },
    ]);
  });
});

describe("formula parser", () => {
  it("parses precedence, associativity, and unary minus", () => {
    expect(parsed("1 + 2 * 3")).toEqual({
      type: "binary", op: "+", position: 2,
      left: { type: "number", value: 1_000_000n, position: 0 },
      right: { type: "binary", op: "*", position: 6, left: { type: "number", value: 2_000_000n, position: 4 }, right: { type: "number", value: 3_000_000n, position: 8 } },
    });
    expect(parsed("10 - 4 - 3")).toMatchObject({ op: "-", position: 7, left: { op: "-", position: 3 } });
    expect(parsed("-a * b")).toMatchObject({ type: "binary", op: "*", left: { type: "negate", operand: { type: "ref", name: "a" } } });
    expect(parsed("2 - -3")).toMatchObject({ op: "-", right: { type: "negate", operand: { type: "number", value: 3_000_000n } } });
    expect(parsed("(1 + 2) * 3")).toMatchObject({ op: "*", left: { op: "+" } });
  });

  it("parses selectors and every function", () => {
    expect(parsed("a[team=Eng] * 2")).toEqual({
      type: "binary", op: "*", position: 12,
      left: { type: "ref", name: "a", position: 0, selectors: [{ dim: "team", item: "Eng", position: 2 }] },
      right: { type: "number", value: 2_000_000n, position: 14 },
    });
    expect(parsed("x[region=EU, team=Eng]")).toMatchObject({ selectors: [{ dim: "region", item: "EU", position: 2 }, { dim: "team", item: "Eng", position: 13 }] });
    expect(parsed("sum(payroll)")).toEqual({ type: "reduce", fn: "sum", position: 0, dims: [], arg: { type: "ref", name: "payroll", position: 4, selectors: [] } });
    expect(parsed("avg(x, team, region)")).toMatchObject({ type: "reduce", fn: "avg", dims: [{ name: "team", position: 7 }, { name: "region", position: 13 }] });
    expect(parsed("min(x, team)")).toMatchObject({ type: "reduce", fn: "min" });
    expect(parsed("max(x)")).toMatchObject({ type: "reduce", fn: "max", dims: [] });
    expect(parsed("prev(x)")).toEqual({ type: "prev", position: 0, arg: { type: "ref", name: "x", position: 5, selectors: [] } });
    expect(parsed("round(x / 3, 2)")).toMatchObject({ type: "round", places: 2, arg: { type: "binary", op: "/" } });
  });

  it.each([
    ["1 +", "Formula ended early", 3],
    ["1 + $", 'Unexpected character "$"', 4],
    ["(1 + 2", "Expected a closing )", 6],
    ["1 2", 'Unexpected "2"', 2],
    ["1 + 2)", "Unmatched )", 5],
    ["foo(1)", 'Unknown function "foo"', 0],
    ["sum", "sum needs parentheses", 0],
    ["sum()", "sum needs an argument", 4],
    ["sum(x, 1)", "Expected a dimension name", 7],
    ["prev(x, 2)", "prev takes one argument", 6],
    ["round(x)", "round needs decimal places: round(value, places)", 7],
    ["round(x, 7)", "round places must be a whole number from 0 to 6", 9],
    ["round(x, 1.5)", "round places must be a whole number from 0 to 6", 9],
    ["1.1234567", "Numbers take at most 6 decimal places", 0],
    ["a[team]", "Expected = after the dimension", 6],
    ["a[team=]", "Expected an item name", 7],
    ["a[team=Eng", "Expected , or ]", 10],
    ["+1", 'Unexpected "+"', 0],
  ] as const)("reports %s as an error at its position", (formula, message, position) => {
    expect(failure(formula)).toEqual({ message, position });
  });

  it("limits formula length and nesting", () => {
    expect(failure(`${"1+".repeat(1000)}1`)).toEqual({ message: "Formula is longer than 2000 characters", position: 2000 });
    expect(parseFormula(`${"1+".repeat(999)}1`).ok).toBe(true);
    expect(failure(`${"(".repeat(201)}1${")".repeat(201)}`)).toEqual({ message: "Formula is nested too deeply", position: 200 });
    expect(parseFormula(`${"(".repeat(199)}1${")".repeat(199)}`).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail.**
  - Run: `pnpm --filter @balsa/finance-engine test forecast-model.test`
  - Expected: FAIL with `Failed to resolve import "./forecast-model"`.

- [ ] **Step 3: Implement.** Create `packages/finance-engine/src/forecast-model.ts`:

```ts
/**
 * Driver formulas over a small dimensional model: arithmetic, tokenizer, and parser.
 * Formulas are parsed by the grammar below and evaluated over bigint decimals;
 * nothing here evaluates JavaScript.
 *
 * Grammar (recursive descent; whitespace between tokens is ignored):
 *   expr     := term (("+" | "-") term)*
 *   term     := factor (("*" | "/") factor)*
 *   factor   := number | "-" factor | "(" expr ")" | call | ref
 *   ref      := name ("[" selector ("," selector)* "]")?
 *   selector := dim "=" item                        -- filters dim to one item and removes it
 *   call     := ("sum" | "avg" | "min" | "max") "(" expr ("," dim)* ")"   -- collapses the named dims, or all when none
 *             | "prev" "(" expr ")"                 -- previous month; the first month reads itself
 *             | "round" "(" expr "," int ")"         -- half away from zero, int in 0..6
 *   number   := digit+ ("." digit{1,6})?
 *   int      := digit+
 *   name, dim, item := [A-Za-z_][A-Za-z0-9_]*
 * A name directly followed by "(" is a call; any other name is a ref.
 */

/** Model values are bigints at scale 10^6. */
export const modelScale = 1_000_000n;
/** |value| above 10^15 currency units (10^21 at scale) is an error cell. */
export const modelValueCap = 10n ** 21n;
export const modelLimits = { formulaLength: 2_000, variables: 200, dimensions: 12, itemsPerDimension: 500, cellsPerVariable: 250_000, nesting: 200 } as const;
/** The as-of month plus the 24-month horizon. */
export const defaultModelMonthCount = 25;
export type ModelReducer = "sum" | "avg" | "min" | "max";
const reducers: readonly string[] = ["sum", "avg", "min", "max"];
export const modelFunctionNames = ["sum", "avg", "min", "max", "prev", "round"] as const;
const functionNames: readonly string[] = modelFunctionNames;

const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const isModelIdentifier = (value: string) => identifierPattern.test(value);

const decimalPattern = /^(-)?(\d+)(?:\.(\d{1,6}))?$/;
/** "1.5" → 1_500_000n. More than 6 fractional digits, or anything not a plain decimal, is null. */
export function parseDecimal(text: string): bigint | null {
  const match = decimalPattern.exec(text);
  if (!match) return null;
  const magnitude = BigInt(match[2]!) * modelScale + BigInt((match[3] ?? "").padEnd(6, "0"));
  return match[1] ? -magnitude : magnitude;
}

/** 1_500_000n → "1.5"; trailing zeros are dropped. */
export function formatDecimal(value: bigint): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const fraction = (magnitude % modelScale).toString().padStart(6, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${magnitude / modelScale}${fraction ? `.${fraction}` : ""}`;
}

const abs = (value: bigint) => (value < 0n ? -value : value);
const quotientSign = (numerator: bigint, denominator: bigint) => ((numerator < 0n) !== (denominator < 0n) ? -1n : 1n);

/** numerator / denominator, rounded half to even. The denominator must not be zero. */
export function divideHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("Division by zero");
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return quotient;
  const twice = abs(remainder) * 2n;
  const whole = abs(denominator);
  return twice > whole || (twice === whole && quotient % 2n !== 0n) ? quotient + quotientSign(numerator, denominator) : quotient;
}

/** numerator / denominator, rounded half away from zero. The denominator must not be zero. */
export function divideHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("Division by zero");
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return abs(remainder) * 2n >= abs(denominator) && remainder !== 0n ? quotient + quotientSign(numerator, denominator) : quotient;
}

/** `*` for model values: the scale-12 product rescaled half-even. */
export const multiplyDecimal = (left: bigint, right: bigint) => divideHalfEven(left * right, modelScale);
/** `/` for model values, half-even at 6 digits; null for division by zero. */
export const divideDecimal = (left: bigint, right: bigint): bigint | null => (right === 0n ? null : divideHalfEven(left * modelScale, right));
/** round(value, places) half away from zero, places 0..6. */
export function roundDecimal(value: bigint, places: number): bigint {
  const factor = 10n ** BigInt(6 - places);
  return divideHalfAwayFromZero(value, factor) * factor;
}
/** A major-unit model value as minor units (×100), rounded half away from zero once. */
export const decimalToMinorUnits = (value: bigint) => divideHalfAwayFromZero(value, 10_000n);

export class FormulaSyntaxError extends Error {
  readonly position: number;
  constructor(message: string, position: number) {
    super(message);
    this.name = "FormulaSyntaxError";
    this.position = position;
  }
}

export type FormulaToken = { type: "number" | "ident" | "op" | "end"; text: string; position: number };
const numberToken = /\d+(?:\.\d+)?/y;
const identToken = /[A-Za-z_][A-Za-z0-9_]*/y;
const operators = "+-*/()[],=";

/** Split a formula into tokens with 0-based character positions; the last token is always "end". */
export function tokenizeFormula(formula: string): FormulaToken[] {
  const tokens: FormulaToken[] = [];
  let index = 0;
  while (index < formula.length) {
    const char = formula[index]!;
    if (char === " " || char === "\t" || char === "\n" || char === "\r") { index += 1; continue; }
    numberToken.lastIndex = index;
    const number = numberToken.exec(formula);
    if (number) { tokens.push({ type: "number", text: number[0], position: index }); index += number[0].length; continue; }
    identToken.lastIndex = index;
    const ident = identToken.exec(formula);
    if (ident) { tokens.push({ type: "ident", text: ident[0], position: index }); index += ident[0].length; continue; }
    if (operators.includes(char)) { tokens.push({ type: "op", text: char, position: index }); index += 1; continue; }
    throw new FormulaSyntaxError(`Unexpected character "${char}"`, index);
  }
  tokens.push({ type: "end", text: "", position: formula.length });
  return tokens;
}

export type FormulaSelector = { dim: string; item: string; position: number };
export type FormulaNode =
  | { type: "number"; value: bigint; position: number }
  | { type: "negate"; operand: FormulaNode; position: number }
  | { type: "binary"; op: "+" | "-" | "*" | "/"; left: FormulaNode; right: FormulaNode; position: number }
  | { type: "ref"; name: string; selectors: FormulaSelector[]; position: number }
  | { type: "reduce"; fn: ModelReducer; arg: FormulaNode; dims: { name: string; position: number }[]; position: number }
  | { type: "prev"; arg: FormulaNode; position: number }
  | { type: "round"; arg: FormulaNode; places: number; position: number };
export type FormulaParseResult = { ok: true; node: FormulaNode } | { ok: false; error: { message: string; position: number } };

/** Parse a formula into an AST. Syntax errors come back with their character position; nothing is evaluated. */
export function parseFormula(formula: string): FormulaParseResult {
  if (formula.length > modelLimits.formulaLength) return { ok: false, error: { message: `Formula is longer than ${modelLimits.formulaLength} characters`, position: modelLimits.formulaLength } };
  try {
    const tokens = tokenizeFormula(formula);
    let index = 0;
    let depth = 0;
    const peek = (): FormulaToken => tokens[index]!;
    const next = (): FormulaToken => { const token = tokens[index]!; if (token.type !== "end") index += 1; return token; };
    const isOp = (token: FormulaToken, ...texts: string[]) => token.type === "op" && texts.includes(token.text);
    const unexpected = (token: FormulaToken) => new FormulaSyntaxError(token.type === "end" ? "Formula ended early" : `Unexpected "${token.text}"`, token.position);
    const expectOp = (text: string, message: string) => { const token = next(); if (!isOp(token, text)) throw new FormulaSyntaxError(message, token.position); };
    const expectName = (message: string) => { const token = next(); if (token.type !== "ident") throw new FormulaSyntaxError(message, token.position); return token; };

    const expr = (): FormulaNode => {
      let node = term();
      while (isOp(peek(), "+", "-")) { const op = next(); node = { type: "binary", op: op.text as "+" | "-", left: node, right: term(), position: op.position }; }
      return node;
    };
    const term = (): FormulaNode => {
      let node = factor();
      while (isOp(peek(), "*", "/")) { const op = next(); node = { type: "binary", op: op.text as "*" | "/", left: node, right: factor(), position: op.position }; }
      return node;
    };
    const factor = (): FormulaNode => {
      const token = peek();
      depth += 1;
      try {
        if (depth > modelLimits.nesting) throw new FormulaSyntaxError("Formula is nested too deeply", token.position);
        if (token.type === "number") {
          next();
          if ((token.text.split(".")[1] ?? "").length > 6) throw new FormulaSyntaxError("Numbers take at most 6 decimal places", token.position);
          return { type: "number", value: parseDecimal(token.text)!, position: token.position };
        }
        if (isOp(token, "-")) { next(); return { type: "negate", operand: factor(), position: token.position }; }
        if (isOp(token, "(")) { next(); const inner = expr(); expectOp(")", "Expected a closing )"); return inner; }
        if (token.type === "ident") { next(); return isOp(peek(), "(") ? call(token) : reference(token); }
        throw unexpected(token);
      } finally {
        depth -= 1;
      }
    };
    const call = (name: FormulaToken): FormulaNode => {
      next(); // "("
      if (!functionNames.includes(name.text)) throw new FormulaSyntaxError(`Unknown function "${name.text}"`, name.position);
      if (isOp(peek(), ")")) throw new FormulaSyntaxError(`${name.text} needs an argument`, peek().position);
      const arg = expr();
      if (name.text === "prev") {
        if (isOp(peek(), ",")) throw new FormulaSyntaxError("prev takes one argument", peek().position);
        expectOp(")", "Expected a closing )");
        return { type: "prev", arg, position: name.position };
      }
      if (name.text === "round") {
        expectOp(",", "round needs decimal places: round(value, places)");
        const places = next();
        if (places.type !== "number" || places.text.includes(".") || Number(places.text) > 6) throw new FormulaSyntaxError("round places must be a whole number from 0 to 6", places.position);
        expectOp(")", "Expected a closing )");
        return { type: "round", arg, places: Number(places.text), position: name.position };
      }
      const dims: { name: string; position: number }[] = [];
      while (isOp(peek(), ",")) { next(); const dim = expectName("Expected a dimension name"); dims.push({ name: dim.text, position: dim.position }); }
      expectOp(")", "Expected a closing )");
      if (!reducers.includes(name.text)) throw new FormulaSyntaxError(`Unknown function "${name.text}"`, name.position);
      return { type: "reduce", fn: name.text as ModelReducer, arg, dims, position: name.position };
    };
    const reference = (name: FormulaToken): FormulaNode => {
      if (functionNames.includes(name.text)) throw new FormulaSyntaxError(`${name.text} needs parentheses`, name.position);
      const selectors: FormulaSelector[] = [];
      if (isOp(peek(), "[")) {
        next();
        for (;;) {
          const dim = expectName("Expected a dimension name");
          expectOp("=", "Expected = after the dimension");
          const item = expectName("Expected an item name");
          selectors.push({ dim: dim.text, item: item.text, position: dim.position });
          if (isOp(peek(), ",")) { next(); continue; }
          expectOp("]", "Expected , or ]");
          break;
        }
      }
      return { type: "ref", name: name.text, selectors, position: name.position };
    };

    const node = expr();
    const rest = peek();
    if (rest.type !== "end") throw new FormulaSyntaxError(isOp(rest, ")") ? "Unmatched )" : `Unexpected "${rest.text}"`, rest.position);
    return { ok: true, node };
  } catch (error) {
    if (error instanceof FormulaSyntaxError) return { ok: false, error: { message: error.message, position: error.position } };
    throw error;
  }
}
```

Then add this line to `packages/finance-engine/src/index.ts`, after `export * from "./forecast-actuals";`:

```ts
export * from "./forecast-model";
```

- [ ] **Step 4: Run the tests to confirm they pass.**
  - Run: `pnpm --filter @balsa/finance-engine test forecast-model.test`
  - Expected: PASS, with all `model decimals`, `formula tokenizer`, and `formula parser` tests green.
  - Then run: `pnpm --filter @balsa/finance-engine typecheck`
  - Expected: exits 0.

- [ ] **Step 5: Commit.**

```bash
git add packages/finance-engine/src/forecast-model.ts packages/finance-engine/src/forecast-model.test.ts packages/finance-engine/src/index.ts
git commit -m "Add model decimals and a positioned formula parser

Co-Authored-By: <implementing model> <noreply@anthropic.com>"
```

---

### Task 2: Cube evaluator, validation, and formula-driver resolution

**Files:**
- Modify: `packages/finance-engine/src/forecast-model.ts` (add imports at the top, and append the code below)
- Create: `packages/finance-engine/src/forecast-model-evaluate.test.ts`
- Modify: `packages/finance-engine/src/forecast-projections.ts`. Only the `ForecastDriver` type gains two optional fields here, because `resolveFormulaDrivers` produces `amountByMonth`. Projection behavior changes in Task 3.

**Interfaces:**
- Consumes: Task 1 exports.
- Produces:
  - `type ForecastDimension = { name: string; items: string[] }`
  - `type ForecastVariableInput = { coords: Record<string, string>; from: string; value: string }`
  - `type ForecastVariable = { name: string; kind: "money" | "number"; dims: string[]; formula?: string; inputs: ForecastVariableInput[] }`
  - `type ForecastModel = { dimensions: ForecastDimension[]; variables: ForecastVariable[] }`
  - `type CellValue = bigint | null` (null is an error cell), `type Cube = { dims: string[]; months: string[]; cells: Map<string, CellValue[]> }`. The coordinate key is the items joined by `|` in `dims` order, and `""` when there are no dims. Each row is aligned to `months`.
  - `type ModelIssue = { message: string; variable?: string; dimension?: string; driverId?: string; position?: number }`, `type ModelValidation = { errors: ModelIssue[]; warnings: ModelIssue[] }`
  - `monthRange(first: string, last: string): string[]`, `coordinateKey(items: string[]): string`, `canonicalizeModel(model: ForecastModel): ForecastModel`
  - `validateModel(model: ForecastModel, options?: { monthCount?: number; driverFormulas?: { id: string; formula: string }[] }): ModelValidation`
  - `type ModelEvaluation = { ok: true; months: string[]; cubes: Map<string, Cube> } | { ok: false; errors: ModelIssue[] }`, `evaluateModel(model: ForecastModel, months: string[]): ModelEvaluation`
  - `evaluateFormula(formula: string, model: ForecastModel, months: string[]): { ok: true; cube: Cube } | { ok: false; errors: ModelIssue[] }`
  - `type ForecastModelSummary = { variables: { name: string; kind: "money" | "number"; dims: string[]; driverIds: string[]; monthlyTotals: Record<string, string | null> }[] }`
  - `type FormulaResolution = { drivers: ForecastDriver[]; exceptions: { driverId: string; reason: string }[]; summary: ForecastModelSummary }`, `resolveFormulaDrivers(drivers: ForecastDriver[], model: ForecastModel | undefined, months: string[]): FormulaResolution`
  - `ForecastDriver` gains `amountFormula?: string` and `amountByMonth?: Record<string, string>`, where `amountByMonth` maps a month to minor units, `"-N"`, or `"error"`.

- [ ] **Step 1: Add the driver fields.** In `packages/finance-engine/src/forecast-projections.ts`, replace the `ForecastDriver` type with the following. It is the same type with two optional fields added after `amountMinor`:

```ts
export type ForecastDriver = { id: string; label: string; itemType: "agreement" | "obligation"; direction: "receipt" | "spend"; category?: string; amountMinor: string; /** A formula over the forecast model, in major units; when set, `amountMinor` is a display fallback only. */ amountFormula?: string; /** Resolved per-month minor units for a formula driver (set by resolveFormulaDrivers, never stored). */ amountByMonth?: Record<string, string>; cadence: "once" | "monthly" | "quarterly" | "annual"; effectiveFrom: string; effectiveTo?: string; scenarioId?: string; decisionId?: string; policyId?: string; /** Lineage back to the evidence and fact behind the economic item. */ evidenceId?: string; factId?: string; counterpartyEntityId?: string };
```

- [ ] **Step 2: Write the failing tests.** Create `packages/finance-engine/src/forecast-model-evaluate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canonicalizeModel, evaluateFormula, evaluateModel, formatDecimal, monthRange, resolveFormulaDrivers, validateModel, type Cube, type ForecastModel, type ForecastVariable, type ForecastVariableInput } from "./forecast-model";
import type { ForecastDriver } from "./forecast-projections";

const months = ["2026-08", "2026-09", "2026-10", "2026-11"];
const team = { name: "team", items: ["Eng", "Sales"] };
const region = { name: "region", items: ["EU", "US"] };
const tier = { name: "tier", items: ["a", "b", "c"] };
const empty: ForecastModel = { dimensions: [], variables: [] };
const byItem = (dim: string, from: string, values: Record<string, string>): ForecastVariableInput[] => Object.entries(values).map(([item, value]) => ({ coords: { [dim]: item }, from, value }));
const scalarInputs = (entries: [string, string][]): ForecastVariableInput[] => entries.map(([from, value]) => ({ coords: {}, from, value }));
const variable = (name: string, dims: string[], definition: { formula: string } | { inputs: ForecastVariableInput[] }, kind: "money" | "number" = "number"): ForecastVariable =>
  ({ name, kind, dims, ...("formula" in definition ? { formula: definition.formula, inputs: [] } : { inputs: definition.inputs }) });
const readable = (cube: Cube) => Object.fromEntries([...cube.cells].map(([key, row]) => [key, row.map((value) => (value === null ? null : formatDecimal(value)))]));
const firstMonth = (cube: Cube) => Object.fromEntries(Object.entries(readable(cube)).map(([key, row]) => [key, row[0]]));
const cube = (model: ForecastModel, name: string) => {
  const result = evaluateModel(model, months);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.cubes.get(name)!;
};
const formula = (model: ForecastModel, text: string) => {
  const result = evaluateFormula(text, model, months);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.cube;
};
const scalar = (text: string) => readable(formula(empty, text))[""]![0];

const factorInputs: ForecastVariableInput[] = ([["EU", "a", "1"], ["EU", "b", "2"], ["EU", "c", "3"], ["US", "a", "4"], ["US", "b", "5"], ["US", "c", "6"]] as const).map(([r, t, value]) => ({ coords: { region: r, tier: t }, from: "2026-08", value }));
const cubeModel: ForecastModel = {
  dimensions: [team, region, tier],
  variables: [
    variable("base", ["team"], { inputs: byItem("team", "2026-08", { Eng: "10", Sales: "20" }) }),
    variable("factor", ["region", "tier"], { inputs: factorInputs }),
    variable("product", ["tier", "team", "region"], { formula: "base * factor" }),
  ],
};

describe("model evaluation", () => {
  it("evaluates arithmetic with precedence and half-even division", () => {
    expect(scalar("1 + 2 * 3")).toBe("7");
    expect(scalar("(1 + 2) * 3")).toBe("9");
    expect(scalar("10 - 4 - 3")).toBe("3");
    expect(scalar("12 / 3 / 2")).toBe("2");
    expect(scalar("-2 * 3")).toBe("-6");
    expect(scalar("2 - -3")).toBe("5");
    expect(scalar("1 / 3")).toBe("0.333333");
    expect(scalar("2 / 3")).toBe("0.666667");
  });

  it("broadcasts across three dimensions", () => {
    const product = cube(cubeModel, "product");
    expect(product.dims).toEqual(["region", "team", "tier"]);
    expect(product.cells.size).toBe(12);
    expect(readable(product)["US|Sales|c"]).toEqual(["120", "120", "120", "120"]);
    expect(readable(product)["EU|Eng|a"]).toEqual(["10", "10", "10", "10"]);
    expect(firstMonth(formula(cubeModel, "base * 2 + factor"))["US|Eng|b"]).toBe("25");
  });

  it("reduces some or all dimensions and selects items", () => {
    expect(firstMonth(formula(cubeModel, "sum(product, tier)"))).toEqual({ "EU|Eng": "60", "EU|Sales": "120", "US|Eng": "150", "US|Sales": "300" });
    expect(firstMonth(formula(cubeModel, "sum(product)"))).toEqual({ "": "630" });
    expect(firstMonth(formula(cubeModel, "avg(product, region, tier)"))).toEqual({ Eng: "35", Sales: "70" });
    expect(firstMonth(formula(cubeModel, "min(product, team)"))).toEqual({ "EU|a": "10", "EU|b": "20", "EU|c": "30", "US|a": "40", "US|b": "50", "US|c": "60" });
    expect(firstMonth(formula(cubeModel, "max(product)"))).toEqual({ "": "120" });
    expect(firstMonth(formula(cubeModel, "product[team=Eng, tier=c]"))).toEqual({ EU: "30", US: "60" });
    expect(firstMonth(formula(cubeModel, "sum(product[team=Sales], region)"))).toEqual({ a: "100", b: "140", c: "180" });
  });

  it("reads inputs as step functions and fills empty cells with 0", () => {
    const model: ForecastModel = { dimensions: [team], variables: [variable("headcount", ["team"], { inputs: [
      { coords: { team: "Eng" }, from: "2026-11", value: "5" },
      { coords: { team: "Eng" }, from: "2026-01", value: "2" },
      { coords: { team: "Eng" }, from: "2026-09", value: "3" },
    ] })] };
    expect(readable(cube(model, "headcount"))).toEqual({ Eng: ["2", "3", "3", "5"], Sales: ["0", "0", "0", "0"] });
    expect(validateModel(model)).toEqual({ errors: [], warnings: [{ variable: "headcount", message: '"headcount" has no inputs for team=Sales; those cells are 0' }] });
  });

  it("reads prev from the previous month, and the first month from itself", () => {
    const model: ForecastModel = { dimensions: [], variables: [variable("x", [], { inputs: scalarInputs([["2026-08", "1"], ["2026-10", "4"]]) }), variable("lagged", [], { formula: "prev(x) * 2" })] };
    expect(readable(cube(model, "x"))).toEqual({ "": ["1", "1", "4", "4"] });
    expect(readable(cube(model, "lagged"))).toEqual({ "": ["2", "2", "2", "8"] });
  });

  it("rounds half away from zero to the given places", () => {
    expect(scalar("round(2.345, 2)")).toBe("2.35");
    expect(scalar("round(-2.345, 2)")).toBe("-2.35");
    expect(scalar("round(2.5, 0)")).toBe("3");
    expect(scalar("round(1 / 3, 4)")).toBe("0.3333");
  });

  it("marks division by zero and overflow as error cells without throwing", () => {
    const model: ForecastModel = { dimensions: [], variables: [
      variable("x", [], { inputs: scalarInputs([["2026-08", "1"], ["2026-10", "4"]]) }),
      variable("y", [], { inputs: scalarInputs([["2026-09", "2"]]) }),
      variable("ratio", [], { formula: "x / y" }),
      variable("total", [], { formula: "ratio + 1" }),
    ] };
    expect(readable(cube(model, "ratio"))).toEqual({ "": [null, "0.5", "2", "2"] });
    expect(readable(cube(model, "total"))).toEqual({ "": [null, "1.5", "3", "3"] });
    const zeros: ForecastModel = { dimensions: [team], variables: [variable("z", ["team"], { inputs: byItem("team", "2026-08", { Eng: "0", Sales: "1" }) })] };
    expect(readable(formula(zeros, "sum(1 / z)"))).toEqual({ "": [null, null, null, null] });
    expect(readable(formula(empty, "1000000000000000 * 1000"))).toEqual({ "": [null, null, null, null] });
    expect(scalar("1000000000000000")).toBe("1000000000000000");
  });

  it("requires consecutive evaluation months", () => {
    expect(monthRange("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(() => evaluateModel(empty, ["2026-08", "2026-10"])).toThrow("Model months must be consecutive YYYY-MM months");
  });
});

describe("model validation", () => {
  it("detects cycles", () => {
    const model: ForecastModel = { dimensions: [], variables: [variable("a", [], { formula: "b + 1" }), variable("b", [], { formula: "a * 2" }), variable("c", [], { formula: "c + 1" })] };
    const { errors } = validateModel(model);
    expect(errors).toEqual([{ variable: "a", message: "Cycle: a → b → a" }, { variable: "c", message: "Cycle: c → c" }]);
    expect(evaluateModel(model, months)).toEqual({ ok: false, errors });
  });

  it("reports unknown names, dimensions, items, and shape errors with positions", () => {
    const model: ForecastModel = { dimensions: [team], variables: [
      variable("headcount", ["team"], { inputs: byItem("team", "2026-08", { Eng: "3", Sales: "2" }) }),
      variable("a", [], { formula: "sum(headcount) + nope" }),
      variable("b", [], { formula: "headcount[region=EU]" }),
      variable("c", [], { formula: "headcount[team=Ops]" }),
      variable("d", [], { formula: "headcount" }),
      variable("e", ["team"], { formula: "sum(headcount, region)" }),
    ] };
    expect(validateModel(model).errors).toEqual([
      { variable: "a", position: 17, message: 'Unknown variable "nope"' },
      { variable: "b", position: 10, message: '"headcount" has no dimension "region"' },
      { variable: "c", position: 10, message: '"Ops" is not an item of team' },
      { variable: "d", position: 0, message: 'The formula for "d" produces dimensions [team] but the variable declares []' },
      { variable: "e", position: 15, message: 'sum cannot collapse "region": the expression has no such dimension' },
    ]);
  });

  it("rejects bad names, duplicates, mixed definitions, and bad inputs", () => {
    const model: ForecastModel = {
      dimensions: [team, { name: "team", items: ["X"] }, { name: "bad-name", items: ["a", "a", "1x"] }],
      variables: [
        variable("sum", [], { inputs: [] }),
        { name: "mixed", kind: "number", dims: [], formula: "1", inputs: scalarInputs([["2026-08", "1"]]) },
        variable("mixed", [], { inputs: [] }),
        variable("inputs", ["team"], { inputs: [
          { coords: {}, from: "2026-08", value: "1" },
          { coords: { team: "Ops" }, from: "2026-08", value: "1" },
          { coords: { team: "Eng" }, from: "2026-13", value: "1" },
          { coords: { team: "Eng" }, from: "2026-08", value: "1.1234567" },
          { coords: { team: "Eng" }, from: "2026-08", value: "1" },
          { coords: { team: "Eng" }, from: "2026-08", value: "2" },
        ] }),
        variable("ghost", ["unknown"], { inputs: [] }),
      ],
    };
    const naming = "must start with a letter or underscore and use only letters, digits, and underscores";
    expect(validateModel(model).errors.map((issue) => issue.message)).toEqual([
      'Dimension "team" is defined twice',
      `Dimension name "bad-name" ${naming}`,
      'Item "a" appears twice in bad-name',
      `Item "1x" in bad-name ${naming}`,
      '"sum" is a function name and cannot name a variable',
      'Variable "mixed" is defined twice',
      'Variable "ghost" uses unknown dimension "unknown"',
      'Variable "mixed" has both a formula and inputs; keep one',
      'An input for "inputs" must name exactly its dimensions [team]',
      'An input for "inputs" uses team=Ops, which is not an item of team',
      'An input for "inputs" has an invalid month "2026-13"',
      'An input for "inputs" has an invalid value "1.1234567"',
      '"inputs" has two inputs for team=Eng from 2026-08',
    ]);
  });

  it("enforces model limits", () => {
    const many = (count: number, prefix: string) => Array.from({ length: count }, (_, index) => `${prefix}${index}`);
    expect(validateModel({ dimensions: many(13, "d").map((name) => ({ name, items: ["a"] })), variables: [] }).errors).toContainEqual({ message: "A model has at most 12 dimensions" });
    expect(validateModel({ dimensions: [], variables: many(201, "v").map((name) => variable(name, [], { inputs: scalarInputs([["2026-08", "1"]]) })) }).errors).toContainEqual({ message: "A model has at most 200 variables" });
    expect(validateModel({ dimensions: [{ name: "big", items: many(501, "i") }], variables: [] }).errors).toContainEqual({ dimension: "big", message: 'Dimension "big" has more than 500 items' });
    const grid = (size: number) => ({ dimensions: [{ name: "p", items: many(size, "p") }, { name: "q", items: many(size, "q") }], variables: [variable("grid", ["p", "q"], { inputs: [] })] });
    expect(validateModel(grid(500)).errors).toContainEqual({ variable: "grid", message: 'Variable "grid" has 6250000 cells (dimension items × months); the limit is 250000' });
    // 100 × 100 items × 25 months = 250,000 cells: exactly at the limit.
    expect(validateModel(grid(100)).errors).toEqual([]);
    // An intermediate over the limit is rejected even when the result is a single cell per month.
    const cross: ForecastModel = { dimensions: [{ name: "p", items: many(200, "p") }, { name: "q", items: many(200, "q") }], variables: [variable("x", ["p"], { inputs: [] }), variable("y", ["q"], { inputs: [] }), variable("z", [], { formula: "sum(x * y)" })] };
    expect(validateModel(cross).errors).toContainEqual({ variable: "z", position: 6, message: "This expression spans 1000000 cells; the limit is 250000" });
    expect(validateModel({ dimensions: [], variables: [variable("long", [], { formula: `${"1+".repeat(1000)}1` })] }).errors).toEqual([{ variable: "long", position: 2000, message: "Formula is longer than 2000 characters" }]);
  });

  it("validates driver formulas against the model", () => {
    const model: ForecastModel = { dimensions: [team], variables: [variable("payroll", ["team"], { inputs: byItem("team", "2026-08", { Eng: "1", Sales: "1" }) })] };
    expect(validateModel(model, { driverFormulas: [{ id: "ok", formula: "sum(payroll)" }, { id: "wide", formula: "payroll" }, { id: "bad", formula: "sum(nope)" }] }).errors).toEqual([
      { driverId: "wide", message: "The formula still has dimensions team; use sum(...) to collapse team" },
      { driverId: "bad", position: 4, message: 'Unknown variable "nope"' },
    ]);
  });

  it("canonicalizes the model for hashing", () => {
    const model = canonicalizeModel({ dimensions: [team, region], variables: [
      { name: "z", kind: "number", dims: ["team", "region"], inputs: [{ coords: { team: "Eng", region: "US" }, from: "2026-09", value: "1" }, { coords: { region: "EU", team: "Eng" }, from: "2026-08", value: "2" }] },
      { name: "a", kind: "money", dims: [], formula: "1", inputs: [] },
    ] });
    expect(model.dimensions.map((dimension) => dimension.name)).toEqual(["region", "team"]);
    expect(model.variables.map((entry) => entry.name)).toEqual(["a", "z"]);
    expect(model.variables[1]).toEqual({ name: "z", kind: "number", dims: ["region", "team"], inputs: [{ coords: { region: "EU", team: "Eng" }, from: "2026-08", value: "2" }, { coords: { region: "US", team: "Eng" }, from: "2026-09", value: "1" }] });
    expect(Object.keys(model.variables[1]!.inputs[1]!.coords)).toEqual(["region", "team"]);
  });
});

describe("resolveFormulaDrivers", () => {
  const payrollModel: ForecastModel = { dimensions: [team], variables: [
    variable("headcount", ["team"], { inputs: byItem("team", "2026-08", { Eng: "3", Sales: "2" }) }),
    variable("salary", ["team"], { inputs: byItem("team", "2026-08", { Eng: "10000", Sales: "8000" }) }, "money"),
    variable("payroll", ["team"], { formula: "headcount * salary" }, "money"),
    variable("tax", ["team"], { formula: "payroll * 0.0765" }, "money"),
    variable("unused", [], { inputs: scalarInputs([["2026-08", "1"]]) }),
  ] };
  const driver = (id: string, amountFormula?: string): ForecastDriver => ({ id, label: id, itemType: "obligation", direction: "spend", amountMinor: "", cadence: "monthly", effectiveFrom: "2026-09", ...(amountFormula !== undefined ? { amountFormula } : {}) });

  it("resolves a formula driver into monthly minor units and summarizes what it uses", () => {
    const result = resolveFormulaDrivers([driver("fixed"), driver("payroll", "sum(payroll) + sum(tax)")], payrollModel, months);
    expect(result.exceptions).toEqual([]);
    expect(result.drivers[0]).toEqual(driver("fixed"));
    expect(result.drivers[1]!.amountByMonth).toEqual({ "2026-08": "4951900", "2026-09": "4951900", "2026-10": "4951900", "2026-11": "4951900" });
    expect(result.summary.variables.map((entry) => [entry.name, entry.monthlyTotals["2026-09"], entry.driverIds])).toEqual([
      ["headcount", "5", ["payroll"]], ["payroll", "46000", ["payroll"]], ["salary", "18000", ["payroll"]], ["tax", "3519", ["payroll"]],
    ]);
  });

  it("returns the drivers untouched when none has a formula", () => {
    const drivers = [driver("fixed")];
    const result = resolveFormulaDrivers(drivers, payrollModel, months);
    expect(result.drivers).toBe(drivers);
    expect(result.summary).toEqual({ variables: [] });
  });

  it("turns a formula that keeps dimensions into an exception", () => {
    expect(resolveFormulaDrivers([driver("p", "payroll")], payrollModel, months).exceptions).toEqual([{ driverId: "p", reason: "The formula still has dimensions team; use sum(...) to collapse team" }]);
  });

  it("reports an invalid formula or an invalid model as exceptions, and evaluates a constant without a model", () => {
    expect(resolveFormulaDrivers([driver("p", "sum(nope)")], payrollModel, months).exceptions).toEqual([{ driverId: "p", reason: 'Formula is invalid at character 5: Unknown variable "nope"' }]);
    const broken: ForecastModel = { ...payrollModel, variables: [...payrollModel.variables, variable("loop", [], { formula: "loop" })] };
    expect(resolveFormulaDrivers([driver("p", "sum(payroll)")], broken, months).exceptions).toEqual([{ driverId: "p", reason: "The forecast model is invalid: Cycle: loop → loop" }]);
    expect(resolveFormulaDrivers([driver("p", "1000")], undefined, months).drivers[0]!.amountByMonth).toEqual({ "2026-08": "100000", "2026-09": "100000", "2026-10": "100000", "2026-11": "100000" });
  });

  it("marks errored months and keeps negative amounts for projection to reject", () => {
    const model: ForecastModel = { dimensions: [], variables: [variable("y", [], { inputs: scalarInputs([["2026-09", "2"]]) })] };
    expect(resolveFormulaDrivers([driver("p", "100 / y")], model, months).drivers[0]!.amountByMonth).toEqual({ "2026-08": "error", "2026-09": "5000", "2026-10": "5000", "2026-11": "5000" });
    expect(resolveFormulaDrivers([driver("n", "0 - 12.345")], model, months).drivers[0]!.amountByMonth!["2026-09"]).toBe("-1235");
  });
});
```

- [ ] **Step 3: Run the tests to confirm they fail.**
  - Run: `pnpm --filter @balsa/finance-engine test forecast-model-evaluate`
  - Expected: FAIL with `SyntaxError: The requested module './forecast-model' does not provide an export named 'canonicalizeModel'` (or the vitest equivalent, "is not a function").

- [ ] **Step 4: Implement.** At the top of `packages/finance-engine/src/forecast-model.ts`, directly after the header comment, add:

```ts
import type { ForecastDriver } from "./forecast-projections";
import { addMonths, isValidMonth } from "./periods";
import { stableJson } from "./stable-json";
```

Then append the following to the end of the file:

```ts
export type ForecastDimension = { name: string; items: string[] };
/** One step of an input variable: `value` applies to `coords` from `from` until the next entry for the same coords. */
export type ForecastVariableInput = { coords: Record<string, string>; from: string; value: string };
/** A variable holds either a formula or dated inputs; `dims` are dimension names (month is implicit). */
export type ForecastVariable = { name: string; kind: "money" | "number"; dims: string[]; formula?: string; inputs: ForecastVariableInput[] };
export type ForecastModel = { dimensions: ForecastDimension[]; variables: ForecastVariable[] };
/** null is an error cell (division by zero or past the value cap). */
export type CellValue = bigint | null;
/** A variable's value over its dimensions (sorted) and months: coordinate key → one value per month. */
export type Cube = { dims: string[]; months: string[]; cells: Map<string, CellValue[]> };
export type ModelIssue = { message: string; variable?: string; dimension?: string; driverId?: string; position?: number };
export type ModelValidation = { errors: ModelIssue[]; warnings: ModelIssue[] };
export type ForecastModelSummary = { variables: { name: string; kind: "money" | "number"; dims: string[]; driverIds: string[]; monthlyTotals: Record<string, string | null> }[] };
export type FormulaResolution = { drivers: ForecastDriver[]; exceptions: { driverId: string; reason: string }[]; summary: ForecastModelSummary };
export type ModelEvaluation = { ok: true; months: string[]; cubes: Map<string, Cube> } | { ok: false; errors: ModelIssue[] };

const compareText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
export const coordinateKey = (items: string[]) => items.join("|");
const splitKey = (key: string, size: number) => (size === 0 ? [] : key.split("|"));
const describeCoordinate = (dims: string[], items: string[]) => dims.map((dim, index) => `${dim}=${items[index]}`).join(", ");
const naming = "must start with a letter or underscore and use only letters, digits, and underscores";

/** Consecutive months from `first` through `last`, inclusive. */
export function monthRange(first: string, last: string): string[] {
  const months: string[] = [];
  for (let month = first; month <= last; month = addMonths(month, 1)) months.push(month);
  return months;
}

function assertMonths(months: string[]) {
  if (!months.length || months.some((month, index) => !isValidMonth(month) || (index > 0 && addMonths(months[index - 1]!, 1) !== month))) throw new Error("Model months must be consecutive YYYY-MM months");
}

/** Sorted dimensions, variables, dims, inputs, and coordinate keys, so equal models hash equally. */
export function canonicalizeModel(model: ForecastModel): ForecastModel {
  const inputKey = (input: ForecastVariableInput) => `${stableJson(input.coords)}@${input.from}`;
  return {
    dimensions: model.dimensions.map((dimension) => ({ name: dimension.name, items: [...dimension.items] })).sort((left, right) => compareText(left.name, right.name)),
    variables: model.variables.map((variable) => ({
      name: variable.name, kind: variable.kind, dims: [...variable.dims].sort(compareText),
      ...(variable.formula !== undefined ? { formula: variable.formula } : {}),
      inputs: variable.inputs
        .map((input) => ({ coords: Object.fromEntries(Object.entries(input.coords).sort(([left], [right]) => compareText(left, right))), from: input.from, value: input.value }))
        .sort((left, right) => compareText(inputKey(left), inputKey(right))),
    })).sort((left, right) => compareText(left.name, right.name)),
  };
}

type Scope = { variables: Map<string, string[]>; dimensions: Map<string, string[]>; monthCount: number };
type FormulaIssue = { message: string; position: number };

const cellCount = (dims: string[], scope: Scope) => dims.reduce((count, dim) => count * (scope.dimensions.get(dim)?.length ?? 1), scope.monthCount);
const collapseMessage = (dims: string[]) => `The formula still has dimensions ${dims.join(", ")}; use sum(...) to collapse ${dims.join(", ")}`;

/** The dimensions an expression produces, or null after recording why it is invalid. */
function inferDims(node: FormulaNode, scope: Scope, issues: FormulaIssue[], references: Set<string>): string[] | null {
  const dims = ((): string[] | null => {
    switch (node.type) {
      case "number": return [];
      case "negate": return inferDims(node.operand, scope, issues, references);
      case "prev": case "round": return inferDims(node.arg, scope, issues, references);
      case "binary": {
        const left = inferDims(node.left, scope, issues, references);
        const right = inferDims(node.right, scope, issues, references);
        return left && right ? [...new Set([...left, ...right])].sort(compareText) : null;
      }
      case "ref": {
        references.add(node.name);
        const declared = scope.variables.get(node.name);
        if (!declared) { issues.push({ message: `Unknown variable "${node.name}"`, position: node.position }); return null; }
        const selected = new Set<string>();
        let valid = true;
        for (const selector of node.selectors) {
          if (!declared.includes(selector.dim)) { issues.push({ message: `"${node.name}" has no dimension "${selector.dim}"`, position: selector.position }); valid = false; continue; }
          if (selected.has(selector.dim)) { issues.push({ message: `Dimension "${selector.dim}" is selected twice`, position: selector.position }); valid = false; continue; }
          selected.add(selector.dim);
          if (!(scope.dimensions.get(selector.dim) ?? []).includes(selector.item)) { issues.push({ message: `"${selector.item}" is not an item of ${selector.dim}`, position: selector.position }); valid = false; }
        }
        return valid ? declared.filter((dim) => !selected.has(dim)) : null;
      }
      case "reduce": {
        const inner = inferDims(node.arg, scope, issues, references);
        if (!inner) return null;
        const named = new Set<string>();
        let valid = true;
        for (const dim of node.dims) {
          if (!inner.includes(dim.name)) { issues.push({ message: `${node.fn} cannot collapse "${dim.name}": the expression has no such dimension`, position: dim.position }); valid = false; }
          else if (named.has(dim.name)) { issues.push({ message: `Dimension "${dim.name}" is listed twice`, position: dim.position }); valid = false; }
          named.add(dim.name);
        }
        if (!valid) return null;
        return node.dims.length ? inner.filter((dim) => !named.has(dim)) : [];
      }
    }
  })();
  if (dims && cellCount(dims, scope) > modelLimits.cellsPerVariable) {
    issues.push({ message: `This expression spans ${cellCount(dims, scope)} cells; the limit is ${modelLimits.cellsPerVariable}`, position: node.position });
    return null;
  }
  return dims;
}

function checkFormula(formula: string, scope: Scope): { node: FormulaNode | null; dims: string[]; issues: FormulaIssue[]; references: string[] } {
  const parsed = parseFormula(formula);
  if (!parsed.ok) return { node: null, dims: [], issues: [parsed.error], references: [] };
  const issues: FormulaIssue[] = [];
  const references = new Set<string>();
  const dims = inferDims(parsed.node, scope, issues, references);
  return { node: parsed.node, dims: dims ?? [], issues, references: [...references].sort(compareText) };
}

function coordinates(dims: string[], dimensions: Map<string, string[]>): string[][] {
  let result: string[][] = [[]];
  for (const dim of dims) {
    const items = dimensions.get(dim) ?? [];
    result = result.flatMap((prefix) => items.map((item) => [...prefix, item]));
  }
  return result;
}

function validateInputs(variable: ForecastVariable, dims: string[], dimensions: Map<string, string[]>, errors: ModelIssue[], warnings: ModelIssue[]) {
  const at = { variable: variable.name };
  const seen = new Set<string>();
  const covered = new Set<string>();
  for (const entry of variable.inputs) {
    if (Object.keys(entry.coords).sort(compareText).join(",") !== dims.join(",")) { errors.push({ ...at, message: `An input for "${variable.name}" must name exactly its dimensions [${dims.join(", ")}]` }); continue; }
    const bad = dims.find((dim) => !(dimensions.get(dim) ?? []).includes(entry.coords[dim]!));
    if (bad) { errors.push({ ...at, message: `An input for "${variable.name}" uses ${bad}=${entry.coords[bad]}, which is not an item of ${bad}` }); continue; }
    if (!isValidMonth(entry.from)) { errors.push({ ...at, message: `An input for "${variable.name}" has an invalid month "${entry.from}"` }); continue; }
    const value = parseDecimal(entry.value);
    if (value === null || value > modelValueCap || value < -modelValueCap) { errors.push({ ...at, message: `An input for "${variable.name}" has an invalid value "${entry.value}"` }); continue; }
    const items = dims.map((dim) => entry.coords[dim]!);
    const key = coordinateKey(items);
    if (seen.has(`${key}@${entry.from}`)) { errors.push({ ...at, message: `"${variable.name}" has two inputs for ${describeCoordinate(dims, items)} from ${entry.from}` }); continue; }
    seen.add(`${key}@${entry.from}`);
    covered.add(key);
  }
  if (!variable.inputs.length) { warnings.push({ ...at, message: `"${variable.name}" has no inputs yet; its cells are 0` }); return; }
  if (dims.some((dim) => !dimensions.has(dim))) return;
  const missing = coordinates(dims, dimensions).filter((items) => !covered.has(coordinateKey(items)));
  if (missing.length) {
    const shown = missing.slice(0, 5).map((items) => describeCoordinate(dims, items)).join("; ");
    warnings.push({ ...at, message: `"${variable.name}" has no inputs for ${shown}${missing.length > 5 ? ` and ${missing.length - 5} more` : ""}; those cells are 0` });
  }
}

type Analysis = { errors: ModelIssue[]; warnings: ModelIssue[]; order: string[]; parsed: Map<string, FormulaNode>; references: Map<string, string[]>; scope: Scope };

/** Every static check on a model, plus the evaluation order (references first). */
function analyzeModel(model: ForecastModel, monthCount: number): Analysis {
  const errors: ModelIssue[] = [];
  const warnings: ModelIssue[] = [];
  if (model.dimensions.length > modelLimits.dimensions) errors.push({ message: `A model has at most ${modelLimits.dimensions} dimensions` });
  if (model.variables.length > modelLimits.variables) errors.push({ message: `A model has at most ${modelLimits.variables} variables` });

  const dimensions = new Map<string, string[]>();
  for (const dimension of model.dimensions) {
    const at = { dimension: dimension.name };
    if (!isModelIdentifier(dimension.name)) errors.push({ ...at, message: `Dimension name "${dimension.name}" ${naming}` });
    else if (dimensions.has(dimension.name)) errors.push({ ...at, message: `Dimension "${dimension.name}" is defined twice` });
    if (!dimension.items.length) errors.push({ ...at, message: `Dimension "${dimension.name}" needs at least one item` });
    if (dimension.items.length > modelLimits.itemsPerDimension) errors.push({ ...at, message: `Dimension "${dimension.name}" has more than ${modelLimits.itemsPerDimension} items` });
    const seen = new Set<string>();
    for (const item of dimension.items) {
      if (!isModelIdentifier(item)) errors.push({ ...at, message: `Item "${item}" in ${dimension.name} ${naming}` });
      else if (seen.has(item)) errors.push({ ...at, message: `Item "${item}" appears twice in ${dimension.name}` });
      seen.add(item);
    }
    if (!dimensions.has(dimension.name)) dimensions.set(dimension.name, dimension.items);
  }

  const scope: Scope = { variables: new Map(), dimensions, monthCount };
  const byName = new Map<string, ForecastVariable>();
  for (const variable of model.variables) {
    const at = { variable: variable.name };
    if (!isModelIdentifier(variable.name)) errors.push({ ...at, message: `Variable name "${variable.name}" ${naming}` });
    else if ((modelFunctionNames as readonly string[]).includes(variable.name)) errors.push({ ...at, message: `"${variable.name}" is a function name and cannot name a variable` });
    else if (byName.has(variable.name)) errors.push({ ...at, message: `Variable "${variable.name}" is defined twice` });
    if (variable.kind !== "money" && variable.kind !== "number") errors.push({ ...at, message: `Variable "${variable.name}" must be money or number` });
    const dims = [...new Set(variable.dims)].sort(compareText);
    if (dims.length !== variable.dims.length) errors.push({ ...at, message: `Variable "${variable.name}" lists a dimension twice` });
    for (const dim of dims) if (!dimensions.has(dim)) errors.push({ ...at, message: `Variable "${variable.name}" uses unknown dimension "${dim}"` });
    if (dims.every((dim) => dimensions.has(dim)) && cellCount(dims, scope) > modelLimits.cellsPerVariable) errors.push({ ...at, message: `Variable "${variable.name}" has ${cellCount(dims, scope)} cells (dimension items × months); the limit is ${modelLimits.cellsPerVariable}` });
    if (!byName.has(variable.name)) { byName.set(variable.name, variable); scope.variables.set(variable.name, dims); }
  }

  const parsed = new Map<string, FormulaNode>();
  const references = new Map<string, string[]>();
  for (const variable of byName.values()) {
    const at = { variable: variable.name };
    const dims = scope.variables.get(variable.name)!;
    if (variable.formula === undefined) { validateInputs(variable, dims, dimensions, errors, warnings); continue; }
    if (variable.inputs.length) errors.push({ ...at, message: `Variable "${variable.name}" has both a formula and inputs; keep one` });
    const check = checkFormula(variable.formula, scope);
    errors.push(...check.issues.map((issue) => ({ ...at, position: issue.position, message: issue.message })));
    if (!check.node) continue;
    references.set(variable.name, check.references);
    parsed.set(variable.name, check.node);
    if (!check.issues.length && check.dims.join(",") !== dims.join(",")) errors.push({ ...at, position: 0, message: `The formula for "${variable.name}" produces dimensions [${check.dims.join(", ")}] but the variable declares [${dims.join(", ")}]` });
  }

  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const reported = new Set<string>();
  const visit = (name: string, path: string[]) => {
    const current = state.get(name);
    if (current === "done") return;
    if (current === "visiting") {
      const cycle = [...path.slice(path.indexOf(name)), name];
      const key = [...new Set(cycle)].sort(compareText).join(",");
      if (!reported.has(key)) { reported.add(key); errors.push({ variable: name, message: `Cycle: ${cycle.join(" → ")}` }); }
      return;
    }
    state.set(name, "visiting");
    for (const reference of references.get(name) ?? []) if (byName.has(reference)) visit(reference, [...path, name]);
    state.set(name, "done");
    order.push(name);
  };
  for (const name of [...byName.keys()].sort(compareText)) visit(name, []);
  return { errors, warnings, order, parsed, references, scope };
}

/**
 * The dry run: every error (with its position, when it has one) and warning for a model,
 * plus errors for driver formulas that are invalid or still carry dimensions.
 */
export function validateModel(model: ForecastModel, options: { monthCount?: number; driverFormulas?: { id: string; formula: string }[] } = {}): ModelValidation {
  const analysis = analyzeModel(model, options.monthCount ?? defaultModelMonthCount);
  const errors = [...analysis.errors];
  for (const driver of options.driverFormulas ?? []) {
    const check = checkFormula(driver.formula, analysis.scope);
    if (check.issues.length) errors.push(...check.issues.map((issue) => ({ driverId: driver.id, position: issue.position, message: issue.message })));
    else if (check.dims.length) errors.push({ driverId: driver.id, message: collapseMessage(check.dims) });
  }
  return { errors, warnings: analysis.warnings };
}

type EvalContext = { months: string[]; dimensions: Map<string, string[]>; cubes: Map<string, Cube> };
const capped = (value: bigint): CellValue => (value > modelValueCap || value < -modelValueCap ? null : value);
const mapRows = (cube: Cube, map: (row: CellValue[]) => CellValue[]): Cube => ({ dims: cube.dims, months: cube.months, cells: new Map([...cube.cells].map(([key, row]) => [key, map(row)])) });

function applyOperator(op: "+" | "-" | "*" | "/", left: CellValue, right: CellValue): CellValue {
  if (left === null || right === null) return null;
  if (op === "+") return capped(left + right);
  if (op === "-") return capped(left - right);
  if (op === "*") return capped(multiplyDecimal(left, right));
  const quotient = divideDecimal(left, right);
  return quotient === null ? null : capped(quotient);
}

/** A binary operation broadcast over the sorted union of both operands' dimensions; month always aligns. */
function combine(left: Cube, right: Cube, op: "+" | "-" | "*" | "/", context: EvalContext): Cube {
  const dims = [...new Set([...left.dims, ...right.dims])].sort(compareText);
  const leftAt = left.dims.map((dim) => dims.indexOf(dim));
  const rightAt = right.dims.map((dim) => dims.indexOf(dim));
  const cells = new Map<string, CellValue[]>();
  for (const items of coordinates(dims, context.dimensions)) {
    const leftRow = left.cells.get(coordinateKey(leftAt.map((index) => items[index]!)))!;
    const rightRow = right.cells.get(coordinateKey(rightAt.map((index) => items[index]!)))!;
    cells.set(coordinateKey(items), leftRow.map((value, index) => applyOperator(op, value, rightRow[index]!)));
  }
  return { dims, months: context.months, cells };
}

function select(cube: Cube, selectors: FormulaSelector[]): Cube {
  if (!selectors.length) return cube;
  const fixed = new Map(selectors.map((selector) => [selector.dim, selector.item]));
  const kept = cube.dims.flatMap((dim, index) => (fixed.has(dim) ? [] : [index]));
  const cells = new Map<string, CellValue[]>();
  for (const [key, row] of cube.cells) {
    const items = splitKey(key, cube.dims.length);
    if (cube.dims.every((dim, index) => !fixed.has(dim) || fixed.get(dim) === items[index])) cells.set(coordinateKey(kept.map((index) => items[index]!)), row);
  }
  return { dims: kept.map((index) => cube.dims[index]!), months: cube.months, cells };
}

function aggregate(fn: ModelReducer, values: CellValue[]): CellValue {
  if (values.some((value) => value === null)) return null;
  const numbers = values as bigint[];
  if (fn === "min") return numbers.reduce((left, right) => (right < left ? right : left));
  if (fn === "max") return numbers.reduce((left, right) => (right > left ? right : left));
  const total = numbers.reduce((left, right) => left + right, 0n);
  return capped(fn === "sum" ? total : divideHalfEven(total, BigInt(numbers.length)));
}

/** Collapse the named dimensions, or every dimension when none is named. */
function reduce(cube: Cube, fn: ModelReducer, named: string[]): Cube {
  const removed = new Set(named.length ? named : cube.dims);
  const kept = cube.dims.flatMap((dim, index) => (removed.has(dim) ? [] : [index]));
  const groups = new Map<string, CellValue[][]>();
  for (const [key, row] of cube.cells) {
    const items = splitKey(key, cube.dims.length);
    const target = coordinateKey(kept.map((index) => items[index]!));
    const group = groups.get(target);
    if (group) group.push(row); else groups.set(target, [row]);
  }
  const cells = new Map<string, CellValue[]>();
  for (const [key, rows] of groups) cells.set(key, cube.months.map((_, index) => aggregate(fn, rows.map((row) => row[index]!))));
  return { dims: kept.map((index) => cube.dims[index]!), months: cube.months, cells };
}

function evaluateNode(node: FormulaNode, context: EvalContext): Cube {
  switch (node.type) {
    case "number": return { dims: [], months: context.months, cells: new Map([["", context.months.map(() => capped(node.value))]]) };
    case "negate": return mapRows(evaluateNode(node.operand, context), (row) => row.map((value) => (value === null ? null : -value)));
    case "binary": return combine(evaluateNode(node.left, context), evaluateNode(node.right, context), node.op, context);
    case "ref": return select(context.cubes.get(node.name)!, node.selectors);
    case "reduce": return reduce(evaluateNode(node.arg, context), node.fn, node.dims.map((dim) => dim.name));
    case "prev": return mapRows(evaluateNode(node.arg, context), (row) => row.map((_, index) => row[index === 0 ? 0 : index - 1]!));
    case "round": return mapRows(evaluateNode(node.arg, context), (row) => row.map((value) => (value === null ? null : capped(roundDecimal(value, node.places)))));
  }
}

/** Step functions: each entry applies from its month until the next entry for the same coordinates; no entry is 0. */
function inputCube(variable: ForecastVariable, context: EvalContext): Cube {
  const dims = [...variable.dims].sort(compareText);
  const steps = new Map<string, { from: string; value: bigint }[]>();
  for (const entry of variable.inputs) {
    const key = coordinateKey(dims.map((dim) => entry.coords[dim]!));
    const list = steps.get(key) ?? [];
    list.push({ from: entry.from, value: parseDecimal(entry.value)! });
    steps.set(key, list);
  }
  const cells = new Map<string, CellValue[]>();
  for (const items of coordinates(dims, context.dimensions)) {
    const key = coordinateKey(items);
    const entries = (steps.get(key) ?? []).sort((left, right) => compareText(left.from, right.from));
    cells.set(key, context.months.map((month) => {
      let value = 0n;
      for (const entry of entries) { if (entry.from > month) break; value = entry.value; }
      return value;
    }));
  }
  return { dims, months: context.months, cells };
}

function computeCubes(model: ForecastModel, months: string[], analysis: Analysis): EvalContext {
  const context: EvalContext = { months, dimensions: analysis.scope.dimensions, cubes: new Map() };
  const byName = new Map(model.variables.map((variable) => [variable.name, variable]));
  for (const name of analysis.order) {
    const node = analysis.parsed.get(name);
    context.cubes.set(name, node ? evaluateNode(node, context) : inputCube(byName.get(name)!, context));
  }
  return context;
}

/** Evaluate every variable over `months` (consecutive; the first is the as-of month, the base for `prev`). */
export function evaluateModel(model: ForecastModel, months: string[]): ModelEvaluation {
  assertMonths(months);
  const analysis = analyzeModel(model, months.length);
  if (analysis.errors.length) return { ok: false, errors: analysis.errors };
  return { ok: true, months, cubes: computeCubes(model, months, analysis).cubes };
}

/** Evaluate one formula (for example an item's) against a model; dimensions are kept. */
export function evaluateFormula(formula: string, model: ForecastModel, months: string[]): { ok: true; cube: Cube } | { ok: false; errors: ModelIssue[] } {
  assertMonths(months);
  const analysis = analyzeModel(model, months.length);
  if (analysis.errors.length) return { ok: false, errors: analysis.errors };
  const check = checkFormula(formula, analysis.scope);
  if (!check.node || check.issues.length) return { ok: false, errors: check.issues.map((issue) => ({ position: issue.position, message: issue.message })) };
  return { ok: true, cube: evaluateNode(check.node, computeCubes(model, months, analysis)) };
}

function transitiveReferences(direct: string[], references: Map<string, string[]>): string[] {
  const seen = new Set<string>();
  const queue = [...direct];
  while (queue.length) {
    const name = queue.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    queue.push(...(references.get(name) ?? []));
  }
  return [...seen];
}

/**
 * Give every driver with an `amountFormula` its `amountByMonth`: the formula's value in each month,
 * as minor units (major × 100, half away from zero), "error" for an errored cell, or a negative
 * number that projection rejects. A formula must collapse to month alone. Drivers without a formula
 * are returned as the same array when none has one.
 */
export function resolveFormulaDrivers(drivers: ForecastDriver[], model: ForecastModel | undefined, months: string[]): FormulaResolution {
  assertMonths(months);
  const formulaDrivers = drivers.filter((driver) => driver.amountFormula !== undefined);
  if (!formulaDrivers.length) return { drivers, exceptions: [], summary: { variables: [] } };
  const effective = model ?? { dimensions: [], variables: [] };
  const analysis = analyzeModel(effective, months.length);
  if (analysis.errors.length) {
    const more = analysis.errors.length - 1;
    const reason = `The forecast model is invalid: ${analysis.errors[0]!.message}${more ? ` (and ${more} more)` : ""}`;
    return { drivers, exceptions: formulaDrivers.map((driver) => ({ driverId: driver.id, reason })), summary: { variables: [] } };
  }
  const context = computeCubes(effective, months, analysis);
  const exceptions: { driverId: string; reason: string }[] = [];
  const usedBy = new Map<string, Set<string>>();
  const resolved = drivers.map((driver): ForecastDriver => {
    if (driver.amountFormula === undefined) return driver;
    const check = checkFormula(driver.amountFormula, analysis.scope);
    if (!check.node || check.issues.length) {
      const issue = check.issues[0]!;
      exceptions.push({ driverId: driver.id, reason: `Formula is invalid at character ${issue.position + 1}: ${issue.message}` });
      return driver;
    }
    if (check.dims.length) { exceptions.push({ driverId: driver.id, reason: collapseMessage(check.dims) }); return driver; }
    const row = evaluateNode(check.node, context).cells.get("")!;
    for (const name of transitiveReferences(check.references, analysis.references)) usedBy.set(name, (usedBy.get(name) ?? new Set<string>()).add(driver.id));
    return { ...driver, amountByMonth: Object.fromEntries(months.map((month, index) => { const value = row[index]!; return [month, value === null ? "error" : decimalToMinorUnits(value).toString()]; })) };
  });
  const byName = new Map(effective.variables.map((variable) => [variable.name, variable]));
  const variables = [...usedBy.keys()].sort(compareText).map((name) => {
    const cube = context.cubes.get(name)!;
    const monthlyTotals = Object.fromEntries(months.map((month, index) => {
      let total: bigint | null = 0n;
      for (const row of cube.cells.values()) { const value = row[index]!; total = total === null || value === null ? null : total + value; }
      return [month, total === null ? null : formatDecimal(total)];
    }));
    return { name, kind: byName.get(name)!.kind, dims: [...cube.dims], driverIds: [...usedBy.get(name)!].sort(compareText), monthlyTotals };
  });
  return { drivers: resolved, exceptions, summary: { variables } };
}
```

- [ ] **Step 5: Run the tests to confirm they pass.**
  - Run: `pnpm --filter @balsa/finance-engine test forecast-model`
  - Expected: PASS for both `forecast-model.test.ts` and `forecast-model-evaluate.test.ts`.
  - Then run: `pnpm --filter @balsa/finance-engine test && pnpm --filter @balsa/finance-engine typecheck`
  - Expected: all engine tests pass, and typecheck exits 0.

- [ ] **Step 6: Commit.**

```bash
git add packages/finance-engine/src/forecast-model.ts packages/finance-engine/src/forecast-model-evaluate.test.ts packages/finance-engine/src/forecast-projections.ts
git commit -m "Evaluate model cubes with broadcasting, validate models, and resolve formula drivers

Co-Authored-By: <implementing model> <noreply@anthropic.com>"
```

---

### Task 3: Engine integration (projection, run, consequence, equivalence, worked example)

**Files:**
- Modify: `packages/finance-engine/src/forecast-projections.ts` (`buildProjectedEntries`)
- Modify: `packages/finance-engine/src/forecast-run.ts`
- Modify: `packages/finance-engine/src/forecast-consequence.ts`
- Modify: `packages/finance-engine/src/forecast-run.reference.ts`
- Modify: `packages/finance-engine/src/forecast-projections.test.ts`, `forecast-consequence.test.ts`, `forecast-equivalence.test.ts`
- Create: `packages/finance-engine/src/forecast-model-run.test.ts`

**Interfaces:**
- Consumes: `resolveFormulaDrivers`, `monthRange`, `ForecastModel`, `ForecastModelSummary` (Task 2).
- Produces:
  - `ForecastRunInput` gains `model?: ForecastModel`.
  - `ForecastRun` gains `modelSummary?: ForecastModelSummary`. It is present only when some driver has an `amountFormula`.
  - `buildProjectedEntries(drivers, templates, horizon, scenarioId?)` keeps its signature. For a driver with `amountByMonth`, it emits `amountByMonth[month]` per month, skips `"0"` or missing months, and raises the exception `Formula amount for YYYY-MM is negative.` or `... is invalid.` with no entries for that driver. For a driver with `amountFormula` but no `amountByMonth`, it raises `Formula driver was not resolved against the forecast model.`. The idempotency version uses the month's amount.
  - `ForecastDriverRef` gains `amountFormula`. `diffForecastRuns` reports the field `"amountFormula"` when the formula changed, and `"amountByMonth"` when a month that both runs project has a different amount.
  - `buildProjectedEntriesReference` (test-only, in `forecast-run.reference.ts`).

- [ ] **Step 1: Write the failing projection tests.** Append to `packages/finance-engine/src/forecast-projections.test.ts`. Also change its import line to `import { buildProjectedEntries, type ForecastDriver } from "./forecast-projections";`:

```ts
describe("formula drivers", () => {
  const template = { id: "spend", itemType: "obligation" as const, direction: "spend" as const, debitAccountId: "payroll", creditAccountId: "cash" };
  const formulaDriver = (amountByMonth: Record<string, string>, cadence: ForecastDriver["cadence"] = "monthly"): ForecastDriver => ({ id: "f", label: "Payroll", itemType: "obligation", direction: "spend", amountMinor: "", amountFormula: "sum(payroll)", amountByMonth, cadence, effectiveFrom: "2026-09" });

  it("posts each month's formula amount and skips zero or missing months", () => {
    const output = buildProjectedEntries([formulaDriver({ "2026-09": "100", "2026-10": "0", "2026-11": "250" })], [template], { start: "2026-09", end: "2026-12" });
    expect(output.exceptions).toEqual([]);
    expect(output.entries.map((entry) => [entry.period, entry.lines[0]!.debitMinor, entry.lines[1]!.creditMinor])).toEqual([["2026-09", "100", "100"], ["2026-11", "250", "250"]]);
    expect(output.entries[0]!.idempotencyKey).toBe("projection:f:base:2026-09:spend:payroll:cash:100");
  });

  it("lets the cadence choose the months", () => {
    const output = buildProjectedEntries([formulaDriver({ "2026-09": "1", "2026-10": "2", "2026-11": "3", "2026-12": "4" }, "quarterly")], [template], { start: "2026-09", end: "2026-12" });
    expect(output.entries.map((entry) => [entry.period, entry.lines[0]!.debitMinor])).toEqual([["2026-09", "1"], ["2026-12", "4"]]);
  });

  it("turns a negative or invalid month into an exception with no entries", () => {
    expect(buildProjectedEntries([formulaDriver({ "2026-09": "100", "2026-10": "-5" })], [template], { start: "2026-09", end: "2026-10" })).toEqual({ entries: [], exceptions: [{ driverId: "f", reason: "Formula amount for 2026-10 is negative." }] });
    expect(buildProjectedEntries([formulaDriver({ "2026-09": "error" })], [template], { start: "2026-09", end: "2026-10" })).toEqual({ entries: [], exceptions: [{ driverId: "f", reason: "Formula amount for 2026-09 is invalid." }] });
  });

  it("refuses a formula driver that was never resolved", () => {
    const { amountByMonth: _unused, ...unresolved } = formulaDriver({});
    void _unused;
    expect(buildProjectedEntries([unresolved], [template], { start: "2026-09", end: "2026-10" }).exceptions).toEqual([{ driverId: "f", reason: "Formula driver was not resolved against the forecast model." }]);
  });
});
```

- [ ] **Step 2: Write the failing worked example.** Create `packages/finance-engine/src/forecast-model-run.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { summarizeActualCash } from "./forecast-actuals";
import { diffForecastRuns } from "./forecast-consequence";
import type { ForecastModel, ForecastVariableInput } from "./forecast-model";
import { buildForecastRun, type ForecastAccount, type ForecastRunInput } from "./forecast-run";
import type { PostedJournalLine } from "./ledger";

const accounts: ForecastAccount[] = [
  { accountId: "cash", accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" },
  { accountId: "equity", accountCode: "3000", accountName: "Owner capital", accountType: "equity", normalBalance: "credit" },
  { accountId: "payroll", accountCode: "6000", accountName: "Payroll", accountType: "expense", normalBalance: "debit" },
];
const account = (id: string) => accounts.find((candidate) => candidate.accountId === id)!;
const posted = (id: string, accountId: string, debitMinor: string, creditMinor: string, period: string): PostedJournalLine => ({ ...account(accountId), id, entryId: id.split(":")[0]!, basis: "actual", currency: "USD", debitMinor, creditMinor, period });
// $1,000,000 of capital in May and nothing else: cash at the August as-of is 100,000,000 minor units.
const history = [posted("capital:0", "cash", "100000000", "0", "2026-05"), posted("capital:1", "equity", "0", "100000000", "2026-05")];
const templates: ForecastRunInput["templates"] = [{ id: "spend", itemType: "obligation", direction: "spend", debitAccountId: "payroll", creditAccountId: "cash" }];
const model = (engineers: ForecastVariableInput[]): ForecastModel => ({
  dimensions: [{ name: "team", items: ["Eng", "Sales"] }],
  variables: [
    { name: "headcount", kind: "number", dims: ["team"], inputs: [...engineers, { coords: { team: "Sales" }, from: "2026-08", value: "2" }] },
    { name: "payroll", kind: "money", dims: ["team"], formula: "headcount * salary", inputs: [] },
    { name: "salary", kind: "money", dims: ["team"], inputs: [{ coords: { team: "Eng" }, from: "2026-08", value: "10000" }, { coords: { team: "Sales" }, from: "2026-08", value: "8000" }] },
    { name: "tax", kind: "money", dims: ["team"], formula: "payroll * 0.0765", inputs: [] },
  ],
});
const payrollDriver: ForecastRunInput["drivers"][number] = { id: "payroll-item", label: "Payroll", itemType: "obligation", direction: "spend", amountMinor: "", amountFormula: "sum(payroll) + sum(tax)", cadence: "monthly", effectiveFrom: "2026-09" };
const run = (engineers: ForecastVariableInput[]) => buildForecastRun({ actuals: summarizeActualCash(history, "USD", "2026-08"), drivers: [payrollDriver], templates, accounts, currency: "USD", asOfMonth: "2026-08", horizonMonths: 24, minimumCashMinor: "0", model: model(engineers) });
const threeEngineers: ForecastVariableInput[] = [{ coords: { team: "Eng" }, from: "2026-08", value: "3" }];

describe("headcount → payroll → payroll tax → cash", () => {
  it("projects the formula driver's monthly cash, runway, and trace", () => {
    const before = run(threeEngineers);
    // 3 × 10,000 + 2 × 8,000 = 46,000 payroll; 7.65% tax = 3,519; 49,519 a month = 4,951,900 minor units.
    expect(before.exceptions).toEqual([]);
    expect(before.months.find((month) => month.month === "2026-09")).toMatchObject({ spendingMinor: "4951900", endingCashMinor: "95048100" });
    // 100,000,000 − 4,951,900·n < 0 first at n = 21 (2028-05): twenty full months funded.
    expect(before.runway).toMatchObject({ cashOutMonth: "2028-05", runwayMonths: 20 });
    expect(before.drivers[0]!.amountByMonth!["2026-09"]).toBe("4951900");
    expect(before.modelSummary!.variables.map((variable) => [variable.name, variable.monthlyTotals["2026-09"]])).toEqual([["headcount", "5"], ["payroll", "46000"], ["salary", "18000"], ["tax", "3519"]]);
  });

  it("moves cash, runway, and the consequence when Eng headcount rises from January", () => {
    const before = run(threeEngineers);
    const after = run([...threeEngineers, { coords: { team: "Eng" }, from: "2027-01", value: "4" }]);
    // From January: 40,000 + 16,000 payroll and 3,060 + 1,224 tax = 60,284 a month.
    expect(after.months.find((month) => month.month === "2027-01")!.spendingMinor).toBe("6028400");
    // 80,192,400 left after December; 13 more months fit, the 14th (2028-02) does not.
    expect(after.runway).toMatchObject({ cashOutMonth: "2028-02", runwayMonths: 17 });
    const consequence = diffForecastRuns(before, after)!;
    expect(consequence.runwayMonths).toEqual({ before: 20, after: 17 });
    expect(consequence.cashOutMonth).toEqual({ before: "2028-05", after: "2028-02" });
    expect(consequence.horizonEndCash).toEqual({ month: "2028-08", beforeMinor: "-18845600", afterMinor: "-40375600", deltaMinor: "-21530000" });
    expect(consequence.projectedSpending.deltaMinor).toBe("21530000");
    expect(consequence.drivers.changed.map((change) => change.fields)).toEqual([["amountByMonth"]]);
  });
});
```

- [ ] **Step 3: Write the failing consequence test.** Append inside the `describe("diffForecastRuns", …)` block of `packages/finance-engine/src/forecast-consequence.test.ts`:

```ts
  it("compares formula amounts only over months both runs project, and names formula changes", () => {
    const before = forecast(input([payroll]));
    const after = forecast({ ...input([payroll]), minimumCashMinor: "200000" });
    const formula = (amountByMonth: Record<string, string>, amountFormula = "sum(payroll)") => [{ ...payroll, amountFormula, amountByMonth }];
    const rolled = diffForecastRuns({ ...before, drivers: formula({ "2026-08": "1", "2026-09": "5" }) }, { ...after, drivers: formula({ "2026-09": "5", "2026-10": "7" }) })!;
    expect(rolled.drivers.changed).toEqual([]);
    const moved = diffForecastRuns({ ...before, drivers: formula({ "2026-09": "5" }) }, { ...after, drivers: formula({ "2026-09": "6" }) })!;
    expect(moved.drivers.changed[0]!.fields).toEqual(["amountByMonth"]);
    const reformulated = diffForecastRuns({ ...before, drivers: formula({ "2026-09": "5" }) }, { ...after, drivers: formula({ "2026-09": "5" }, "sum(payroll) * 2") })!;
    expect(reformulated.drivers.changed[0]!.fields).toEqual(["amountFormula"]);
    expect(reformulated.drivers.changed[0]!.after.amountFormula).toBe("sum(payroll) * 2");
  });
```

- [ ] **Step 4: Write the failing equivalence tests.** In `packages/finance-engine/src/forecast-equivalence.test.ts`, change the imports to:

```ts
import { buildForecastRun, type ForecastAccount } from "./forecast-run";
import { buildForecastRunReference, buildProjectedEntriesReference } from "./forecast-run.reference";
import { summarizeActualCash } from "./forecast-actuals";
import * as statements from "./statements";
import { stableJson } from "./stable-json";
import { addMonths } from "./periods";
import { buildProjectedEntries, type ForecastDriver, type ForecastEntryTemplate } from "./forecast-projections";
import type { ForecastModel } from "./forecast-model";
import type { EntryBasis, PostedJournalLine } from "./ledger";
```

Then add these two tests inside the existing `describe`, after the 250-ledger test:

```ts
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
```

- [ ] **Step 5: Run the tests to confirm they fail.**
  - Run: `pnpm --filter @balsa/finance-engine test`
  - Expected: FAIL. The equivalence file fails with `does not provide an export named 'buildProjectedEntriesReference'`. The projection "formula drivers" tests fail, for example `expected [ …entries for 2026-10… ] to deeply equal`. `forecast-model-run.test.ts` fails because runway is 0 instead of 20, since the unresolved driver is rejected by the old amount check. The consequence test fails with `expected [] to deeply equal [ 'amountByMonth' ]`.

- [ ] **Step 6: Freeze the reference projection.** In `packages/finance-engine/src/forecast-run.reference.ts`:
  1. Replace the import line `import { buildProjectedEntries, type ForecastDriver, type ForecastEntryTemplate } from "./forecast-projections";` with `import type { ForecastDriver, ForecastEntryTemplate, ProjectedEntry } from "./forecast-projections";`.
  2. In `buildForecastRunReference`, replace `const projection = buildProjectedEntries(drivers, templates, horizon);` with `const projection = buildProjectedEntriesReference(drivers, templates, horizon);`.
  3. Append this verbatim copy of today's projection. It is renamed, and its local `addMonths` becomes `projectionAddMonths` so it does not clash with the `./periods` import:

```ts
const step: Record<ForecastDriver["cadence"], number> = { once: 0, monthly: 1, quarterly: 3, annual: 12 };
const validMonth = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const projectionAddMonths = (month: string, increment: number) => { const [year, number] = month.split("-").map(Number); const date = new Date(Date.UTC(year!, number! - 1 + increment, 1)); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; };
const projectionKey = (driver: ForecastDriver, scenarioId: string | undefined, month: string) => `projection:${driver.id}:${scenarioId ?? "base"}:${month}`;
const projectionVersion = (driver: ForecastDriver, template: ForecastEntryTemplate) => `${template.id}:${template.debitAccountId}:${template.creditAccountId}:${driver.amountMinor}`;

/** Slice-1 fixed-amount projection, frozen before formula drivers existed. The equivalence oracle only. */
export function buildProjectedEntriesReference(drivers: ForecastDriver[], templates: ForecastEntryTemplate[], horizon: { start: string; end: string }, scenarioId?: string): { entries: ProjectedEntry[]; exceptions: { driverId: string; reason: string }[] } {
  const entries: ProjectedEntry[] = []; const exceptions: { driverId: string; reason: string }[] = [];
  for (const driver of drivers) {
    if (!validMonth(driver.effectiveFrom) || !validMonth(horizon.start) || !validMonth(horizon.end) || !/^\d+$/.test(driver.amountMinor)) { exceptions.push({ driverId: driver.id, reason: "Driver needs a valid monthly schedule and minor-unit amount." }); continue; }
    const matches = templates.filter((template) => template.itemType === driver.itemType && template.direction === driver.direction && (!template.category || template.category === driver.category));
    if (matches.length !== 1) { exceptions.push({ driverId: driver.id, reason: matches.length ? "Driver matches multiple forecast-entry templates." : "Driver has no approved forecast-entry template." }); continue; }
    const template = matches[0]!; const last = driver.effectiveTo && driver.effectiveTo < horizon.end ? driver.effectiveTo : horizon.end;
    for (let month = driver.effectiveFrom; month <= last; month = projectionAddMonths(month, step[driver.cadence])) {
      if (month < horizon.start) { if (driver.cadence === "once") break; continue; }
      const key = projectionKey(driver, scenarioId, month);
      entries.push({ idempotencyKey: `${key}:${projectionVersion(driver, template)}`, projectionKey: key, period: month, postingDate: `${month}-01`, memo: `Projected: ${driver.label}`, basis: scenarioId ? "scenario" : "forecast", ...(scenarioId ? { scenarioId } : {}), sourceDriverId: driver.id, templateId: template.id, lines: [{ accountId: template.debitAccountId, debitMinor: driver.amountMinor, creditMinor: "0" }, { accountId: template.creditAccountId, debitMinor: "0", creditMinor: driver.amountMinor }] });
      if (driver.cadence === "once") break;
    }
  }
  return { entries, exceptions };
}
```

- [ ] **Step 7: Implement formula projection.** In `packages/finance-engine/src/forecast-projections.ts`, replace `projectionVersion` and `buildProjectedEntries` with:

```ts
/** A changed amount or posting template is a new immutable projection version. */
const projectionVersion = (template: ForecastEntryTemplate, amountMinor: string) => `${template.id}:${template.debitAccountId}:${template.creditAccountId}:${amountMinor}`;

/**
 * Expand approved forecast drivers into balanced projected entry drafts.
 * A formula driver (resolved `amountByMonth`) posts each emitted month's own amount:
 * a missing or zero month is skipped, and a negative or non-integer month makes the
 * whole driver an exception. The cadence still chooses which months emit.
 */
export function buildProjectedEntries(drivers: ForecastDriver[], templates: ForecastEntryTemplate[], horizon: { start: string; end: string }, scenarioId?: string): { entries: ProjectedEntry[]; exceptions: { driverId: string; reason: string }[] } {
  const entries: ProjectedEntry[] = []; const exceptions: { driverId: string; reason: string }[] = [];
  for (const driver of drivers) {
    const monthly = driver.amountByMonth;
    if (!validMonth(driver.effectiveFrom) || !validMonth(horizon.start) || !validMonth(horizon.end) || (monthly === undefined && driver.amountFormula === undefined && !/^\d+$/.test(driver.amountMinor))) { exceptions.push({ driverId: driver.id, reason: "Driver needs a valid monthly schedule and minor-unit amount." }); continue; }
    if (monthly === undefined && driver.amountFormula !== undefined) { exceptions.push({ driverId: driver.id, reason: "Formula driver was not resolved against the forecast model." }); continue; }
    const matches = templates.filter((template) => template.itemType === driver.itemType && template.direction === driver.direction && (!template.category || template.category === driver.category));
    if (matches.length !== 1) { exceptions.push({ driverId: driver.id, reason: matches.length ? "Driver matches multiple forecast-entry templates." : "Driver has no approved forecast-entry template." }); continue; }
    const template = matches[0]!; const last = driver.effectiveTo && driver.effectiveTo < horizon.end ? driver.effectiveTo : horizon.end;
    const driverEntries: ProjectedEntry[] = []; let invalid: string | null = null;
    for (let month = driver.effectiveFrom; month <= last; month = addMonths(month, step[driver.cadence])) {
      if (month < horizon.start) { if (driver.cadence === "once") break; continue; }
      const amount = monthly ? monthly[month] : driver.amountMinor;
      if (monthly) {
        if (amount === undefined || amount === "0") { if (driver.cadence === "once") break; continue; }
        if (!/^-?\d+$/.test(amount)) { invalid = `Formula amount for ${month} is invalid.`; break; }
        if (amount.startsWith("-")) { invalid = `Formula amount for ${month} is negative.`; break; }
      }
      const key = projectionKey(driver, scenarioId, month);
      driverEntries.push({ idempotencyKey: `${key}:${projectionVersion(template, amount!)}`, projectionKey: key, period: month, postingDate: `${month}-01`, memo: `Projected: ${driver.label}`, basis: scenarioId ? "scenario" : "forecast", ...(scenarioId ? { scenarioId } : {}), sourceDriverId: driver.id, templateId: template.id, lines: [{ accountId: template.debitAccountId, debitMinor: amount!, creditMinor: "0" }, { accountId: template.creditAccountId, debitMinor: "0", creditMinor: amount! }] });
      if (driver.cadence === "once") break;
    }
    if (invalid) { exceptions.push({ driverId: driver.id, reason: invalid }); continue; }
    entries.push(...driverEntries);
  }
  return { entries, exceptions };
}
```

- [ ] **Step 8: Resolve formulas in the run.** In `packages/finance-engine/src/forecast-run.ts`:
  1. Add the import `import { monthRange, resolveFormulaDrivers, type ForecastModel, type ForecastModelSummary } from "./forecast-model";`.
  2. Change the two types to:

```ts
export type ForecastRunInput = { actuals: ActualCashSummary; drivers: ForecastDriver[]; templates: ForecastEntryTemplate[]; accounts: ForecastAccount[]; currency: string; asOfMonth: string; horizonMonths: number; minimumCashMinor: string; /** Dimensions and variables that formula drivers read; omitted when the company has none. */ model?: ForecastModel };
export type ForecastRun = { formulaVersion: string; asOfMonth: string; horizon: { start: string; end: string }; currency: string; months: ForecastMonth[]; nodes: ForecastNode[]; projectedLines: PostedJournalLine[]; drivers: ForecastDriver[]; exceptions: { driverId: string; reason: string }[]; runway: ForecastRunway; verificationStatus: "verified" | "exception"; /** The model variables formula drivers used, with monthly totals; only when a driver has a formula. */ modelSummary?: ForecastModelSummary };
```

  3. In `buildForecastRun`, replace these three lines:

```ts
  const drivers = [...input.drivers].sort((left, right) => left.id.localeCompare(right.id));
  const templates = [...input.templates].sort((left, right) => left.id.localeCompare(right.id));
  const accountById = new Map(input.accounts.map((account) => [account.accountId, account]));
  const projection = buildProjectedEntries(drivers, templates, horizon);
  const exceptions = [...projection.exceptions];
```

  with:

```ts
  const sortedDrivers = [...input.drivers].sort((left, right) => left.id.localeCompare(right.id));
  // Formula drivers take monthly amounts from the model over [as-of, horizon end]; the as-of month is
  // the base for prev. A run without a formula driver takes exactly the fixed-amount path.
  const resolution = sortedDrivers.some((driver) => driver.amountFormula !== undefined) ? resolveFormulaDrivers(sortedDrivers, input.model, monthRange(input.asOfMonth, horizon.end)) : null;
  const drivers = resolution ? resolution.drivers : sortedDrivers;
  const unresolved = new Set((resolution?.exceptions ?? []).map((exception) => exception.driverId));
  const templates = [...input.templates].sort((left, right) => left.id.localeCompare(right.id));
  const accountById = new Map(input.accounts.map((account) => [account.accountId, account]));
  const projection = buildProjectedEntries(unresolved.size ? drivers.filter((driver) => !unresolved.has(driver.id)) : drivers, templates, horizon);
  const exceptions = [...(resolution?.exceptions ?? []), ...projection.exceptions];
```

  4. In the returned object, add `...(resolution ? { modelSummary: resolution.summary } : {}),` after `drivers, exceptions,` and leave everything else as it is.

- [ ] **Step 9: Compare formula fields in consequences.** In `packages/finance-engine/src/forecast-consequence.ts`, replace the `ForecastDriverRef` type, `comparedFields`, `ref`, and the `changed:` computation:

```ts
export type ForecastDriverRef = Pick<ForecastDriver, "id" | "label" | "direction" | "category" | "amountMinor" | "amountFormula" | "cadence" | "effectiveFrom" | "effectiveTo" | "evidenceId" | "decisionId">;
```

```ts
const comparedFields = ["label", "direction", "category", "amountMinor", "amountFormula", "cadence", "effectiveFrom", "effectiveTo"] as const;
```

```ts
const ref = (driver: ForecastDriver): ForecastDriverRef => ({ id: driver.id, label: driver.label, direction: driver.direction, amountMinor: driver.amountMinor, cadence: driver.cadence, effectiveFrom: driver.effectiveFrom, ...(driver.category ? { category: driver.category } : {}), ...(driver.amountFormula !== undefined ? { amountFormula: driver.amountFormula } : {}), ...(driver.effectiveTo ? { effectiveTo: driver.effectiveTo } : {}), ...(driver.evidenceId ? { evidenceId: driver.evidenceId } : {}), ...(driver.decisionId ? { decisionId: driver.decisionId } : {}) });
/** A formula amount moved in a month both runs project. Months that rolled into or out of the window are not a change. */
const formulaAmountsMoved = (before: ForecastDriver, after: ForecastDriver) => {
  if ((before.amountByMonth === undefined) !== (after.amountByMonth === undefined)) return true;
  const prior = before.amountByMonth ?? {}; const next = after.amountByMonth ?? {};
  return Object.keys(next).some((month) => month in prior && prior[month] !== next[month]);
};
```

and inside `diffForecastRuns`:

```ts
    changed: next.drivers.flatMap((driver) => {
      const prior = beforeDrivers.get(driver.id);
      const fields: string[] = prior ? [...comparedFields.filter((field) => prior[field] !== driver[field]), ...(formulaAmountsMoved(prior, driver) ? ["amountByMonth"] : [])] : [];
      return prior && fields.length ? [{ before: ref(prior), after: ref(driver), fields }] : [];
    }),
```

- [ ] **Step 10: Run the tests to confirm they pass.**
  - Run: `pnpm --filter @balsa/finance-engine test`
  - Expected: PASS for every file, including the original 250-seed equivalence test, the two new equivalence tests, the four projection formula tests, the worked example, and the consequence test.
  - Then run: `pnpm -r typecheck`
  - Expected: exits 0. The web app compiles unchanged, because the new fields are optional.

- [ ] **Step 11: Commit.**

```bash
git add packages/finance-engine/src
git commit -m "Project formula drivers per month and prove fixed-driver runs are unchanged

Co-Authored-By: <implementing model> <noreply@anthropic.com>"
```

---

### Task 4: Storage, loading, and revision causes

**Files:**
- Create: `packages/database/drizzle/0075_forecast_model.sql`
- Modify: `packages/database/drizzle/meta/_journal.json`, `packages/database/src/schema.ts`
- Create: `apps/web/src/lib/forecast-model-rows.ts`, `apps/web/src/lib/forecast-model-rows.test.ts`
- Create: `apps/web/src/lib/forecast-model-load.test.ts` (DB)
- Modify:
  - `apps/web/src/lib/forecast-drivers.ts` and `forecast-drivers.test.ts`
  - `apps/web/src/lib/forecast-inputs.ts`
  - `apps/web/src/lib/revision-cause.ts`
  - `apps/web/src/lib/consequence-copy.ts` and `consequence-copy.test.ts`
  - `apps/web/src/lib/forecast-read.ts`
  - the preview/scenario base loader: `loadForecastBase` in `apps/web/src/lib/forecast-scenarios.ts` (or `forecast-preview.ts`, wherever the scenarios work put it), falling back to `loadPreviewBaseInput` in `forecast-preview.ts` if the refactor did not land
  - `apps/web/src/lib/forecast-plan-pin.ts`
  - `apps/web/src/app/api/forecast-projections/route.ts`

**Interfaces:**
- Consumes: `canonicalizeModel`, `resolveFormulaDrivers`, `monthRange`, `ForecastModel`, `ForecastVariableInput` (Tasks 2–3).
- Produces:
  - Tables `forecastDimensions` and `forecastVariables`, and the column `economicItems.amountFormula`. In the table types, `items`, `dims`, and `inputs` are `jsonb` columns typed via `$type`, and `kind` is `"money" | "number"`.
  - Table `decisionEffectApplications`, reserved for Task 6: one durable company-scoped application marker per decision, with effect kind, bounded result JSON, and applied timestamp.
  - `forecast-model-rows.ts` (pure):
    - `type ModelDimensionRow = { name: string; items: string[] }` and `type ModelVariableRow = { name: string; kind: "money" | "number"; dims: string[]; formula: string | null; inputs: ForecastVariableInput[] }`
    - `type DimensionDraft = { name: string; items: string[] }` and `type VariableDraft = ModelVariableRow`
    - `type ModelDraft = { dimensions?: (DimensionDraft & { replaces?: string })[]; variables?: (VariableDraft & { replaces?: string })[] }`
    - `emptyModel(): ForecastModel`, `variableFromDraft(draft: VariableDraft): ForecastVariable`, `rowsToModel(dimensions, variables): ForecastModel | undefined`
    - `withDimension(model, draft, replaces?)`, `withoutDimension(model, name)`, `withVariable(model, draft, replaces?)`, `withoutVariable(model, name)`, `mergeModelDraft(model, draft)`. Each returns a canonical `ForecastModel`.
  - `forecast-inputs.ts`:
    - `loadForecastModel(companyId: string, db?: DbExecutor): Promise<ForecastModel | undefined>`
    - `resolveDriversForWindow(drivers: ForecastDriver[], model: ForecastModel | undefined, window: { start: string; end: string }): { drivers: ForecastDriver[]; exceptions: { driverId: string; reason: string }[] }`
    - `loadForecastInputs` includes `model` only when the company has one.
  - `EconomicItemDriverRow.amountFormula?: string | null`. `economicItemToDriver` sets `amountFormula` when it is non-empty.
  - `RevisionCauseKind` adds `"model_changed" | "item_formula_changed"`. The subject types are `"forecast_dimension" | "forecast_variable"` for `model_changed` and `"economic_item"` for `item_formula_changed`.
  - `describeCause` produces `"Changed the model: <name>"`, `"Changed the model"`, `"Set a formula on <label>"`, or `"Set a formula on an item"`.

- [ ] **Step 1: Pick the migration number.** Run `ls packages/database/drizzle | tail -3` and `tail -12 packages/database/drizzle/meta/_journal.json`.
  - The scenarios feature normally takes `0074`, so this migration is `0075_forecast_model`.
  - If the latest file is a different number, use the next free number, and use that tag everywhere below.
  - Set the journal `when` to the latest `when` + 1. With scenarios at `1789300000037`, that is `1789300000038`.

- [ ] **Step 2: Write the migration.** Create `packages/database/drizzle/0075_forecast_model.sql`:

```sql
CREATE TABLE IF NOT EXISTS "forecast_dimensions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "items" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "active" char(1) DEFAULT 'Y' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forecast_dimensions_company_index" ON "forecast_dimensions" ("company_id", "active");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "forecast_dimensions_active_name_unique" ON "forecast_dimensions" ("company_id", "name") WHERE active = 'Y';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "forecast_variables" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "kind" text NOT NULL,
  "dims" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "formula" text,
  "inputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "decision_id" uuid REFERENCES "decisions"("id") ON DELETE set null,
  "active" char(1) DEFAULT 'Y' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "forecast_variables_kind_check" CHECK ("kind" IN ('money', 'number')),
  CONSTRAINT "forecast_variables_formula_or_inputs_check" CHECK ("formula" IS NULL OR "inputs" = '[]'::jsonb)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forecast_variables_company_index" ON "forecast_variables" ("company_id", "active");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "forecast_variables_active_name_unique" ON "forecast_variables" ("company_id", "name") WHERE active = 'Y';
--> statement-breakpoint
ALTER TABLE "economic_items" ADD COLUMN IF NOT EXISTS "amount_formula" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "decision_effect_applications" (
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "decision_id" uuid NOT NULL REFERENCES "decisions"("id") ON DELETE cascade,
  "effect_kind" text NOT NULL,
  "result" jsonb NOT NULL,
  "applied_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "decision_effect_applications_pk" PRIMARY KEY ("company_id", "decision_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decision_effect_applications_company_index" ON "decision_effect_applications" ("company_id", "applied_at");
--> statement-breakpoint
ALTER TABLE "decision_effect_applications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "decision_effect_applications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "decision_effect_applications_company_scope" ON "decision_effect_applications" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "forecast_dimensions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "forecast_dimensions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "forecast_dimensions_company_scope" ON "forecast_dimensions" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "forecast_variables" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "forecast_variables" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "forecast_variables_company_scope" ON "forecast_variables" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
```

Append this entry to the `entries` array in `packages/database/drizzle/meta/_journal.json`. Use the index and `when` from Step 1:

```json
    {
      "idx": 75,
      "version": "7",
      "when": 1789300000038,
      "tag": "0075_forecast_model",
      "breakpoints": true
    }
```

- [ ] **Step 3: Add the schema.** In `packages/database/src/schema.ts`:
  1. Directly after the `forecastEntryTemplates` table, add:

```ts
/** A named list of items that forecast model variables break down by (for example team: Eng, Sales). */
export const forecastDimensions = pgTable("forecast_dimensions", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(), items: jsonb("items").$type<string[]>().default([]).notNull(), active: char("active", { length: 1 }).default("Y").notNull(), ...timestamps,
}, (table) => [index("forecast_dimensions_company_index").on(table.companyId, table.active), uniqueIndex("forecast_dimensions_active_name_unique").on(table.companyId, table.name).where(sql`active = 'Y'`)]);

/** A forecast model variable: dated step inputs or a formula (never both), over zero or more dimensions. */
export const forecastVariables = pgTable("forecast_variables", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(), kind: text("kind").$type<"money" | "number">().notNull(), dims: jsonb("dims").$type<string[]>().default([]).notNull(),
  formula: text("formula"), inputs: jsonb("inputs").$type<{ coords: Record<string, string>; from: string; value: string }[]>().default([]).notNull(),
  decisionId: uuid("decision_id").references(() => decisions.id, { onDelete: "set null" }), active: char("active", { length: 1 }).default("Y").notNull(), ...timestamps,
}, (table) => [index("forecast_variables_company_index").on(table.companyId, table.active), uniqueIndex("forecast_variables_active_name_unique").on(table.companyId, table.name).where(sql`active = 'Y'`)]);
```

  2. In `economicItems`, directly after `amount: text("amount"),`, add:

```ts
    /** A driver formula over the forecast model, in major units. When set, `amount` is the display fallback only. */
    amountFormula: text("amount_formula"),
```

  3. Add `decisionEffectApplications` with the columns, composite primary key, company index, and `$type<Record<string, unknown>>()` result matching the migration. Task 6 will begin writing the marker; defining it here keeps migration `0075` immutable after Task 4 applies it.

- [ ] **Step 4: Apply the migration.**
  - Run: `pnpm --filter @finance/database db:migrate`
  - Expected: `Database migrations complete`.

- [ ] **Step 5: Write the failing pure tests.** Create `apps/web/src/lib/forecast-model-rows.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mergeModelDraft, rowsToModel, variableFromDraft, withDimension, withoutDimension, withoutVariable, withVariable } from "./forecast-model-rows";

const team = { name: "team", items: ["Eng", "Sales"] };
const headcount = { name: "headcount", kind: "number" as const, dims: ["team"], formula: null, inputs: [{ coords: { team: "Eng" }, from: "2026-09", value: "3" }] };
const payroll = { name: "payroll", kind: "money" as const, dims: ["team"], formula: "headcount * salary", inputs: [] };

describe("forecast model rows", () => {
  it("maps no rows to no model, so a company without one keeps its input hash", () => {
    expect(rowsToModel([], [])).toBeUndefined();
  });

  it("maps rows canonically: names sorted, formula only when set", () => {
    const model = rowsToModel([{ name: "region", items: ["US", "EU"] }, team], [payroll, headcount])!;
    expect(model.dimensions.map((dimension) => dimension.name)).toEqual(["region", "team"]);
    expect(model.dimensions[0]!.items).toEqual(["US", "EU"]);
    expect(model.variables).toEqual([
      { name: "headcount", kind: "number", dims: ["team"], inputs: [{ coords: { team: "Eng" }, from: "2026-09", value: "3" }] },
      { name: "payroll", kind: "money", dims: ["team"], formula: "headcount * salary", inputs: [] },
    ]);
    expect(variableFromDraft(headcount)).not.toHaveProperty("formula");
  });

  it("adds, replaces, renames, and removes by name", () => {
    const model = rowsToModel([team], [headcount])!;
    expect(withVariable(model, payroll).variables.map((variable) => variable.name)).toEqual(["headcount", "payroll"]);
    expect(withVariable(model, { ...headcount, name: "heads" }, "headcount").variables.map((variable) => variable.name)).toEqual(["heads"]);
    expect(withoutVariable(model, "headcount").variables).toEqual([]);
    expect(withDimension(model, { name: "team", items: ["Eng"] }).dimensions).toEqual([{ name: "team", items: ["Eng"] }]);
    expect(withoutDimension(model, "team").dimensions).toEqual([]);
    expect(mergeModelDraft(model, { dimensions: [{ name: "region", items: ["EU"] }], variables: [{ ...payroll, name: "cost", replaces: "missing" }] }).variables.map((variable) => variable.name)).toEqual(["cost", "headcount"]);
  });
});
```

Append to `apps/web/src/lib/forecast-drivers.test.ts`, inside its `describe`:

```ts
  it("carries a non-empty amount formula", () => {
    expect(economicItemToDriver({ ...item, amountFormula: "sum(payroll)" }).amountFormula).toBe("sum(payroll)");
    expect(economicItemToDriver({ ...item, amountFormula: null })).not.toHaveProperty("amountFormula");
    expect(economicItemToDriver(item)).not.toHaveProperty("amountFormula");
  });
```

Append to `apps/web/src/lib/consequence-copy.test.ts`, inside the `describeCause` describe block (or in a new `describe("describeCause for the model", …)` block if the file's structure differs):

```ts
  it("names model and formula changes", () => {
    expect(describeCause({ kind: "model_changed", subjectLabel: "payroll" })).toBe("Changed the model: payroll");
    expect(describeCause({ kind: "model_changed", subjectLabel: null })).toBe("Changed the model");
    expect(describeCause({ kind: "item_formula_changed", subjectLabel: "Payroll" })).toBe("Set a formula on Payroll");
    expect(describeCause({ kind: "item_formula_changed", subjectLabel: null })).toBe("Set a formula on an item");
  });
```

- [ ] **Step 6: Run the tests to confirm they fail.**
  - Run: `pnpm --filter @finance/web test forecast-model-rows forecast-drivers consequence-copy`
  - Expected: FAIL. `forecast-model-rows` fails with `Failed to resolve import "./forecast-model-rows"`. The formula test in `forecast-drivers` fails with `expected undefined to be 'sum(payroll)'`. `consequence-copy` fails with `expected 'Changed payroll' to be 'Changed the model: payroll'`.

- [ ] **Step 7: Implement the pure pieces.** Create `apps/web/src/lib/forecast-model-rows.ts`:

```ts
import { canonicalizeModel, type ForecastModel, type ForecastVariable, type ForecastVariableInput } from "@balsa/finance-engine";

export type ModelDimensionRow = { name: string; items: string[] };
export type ModelVariableRow = { name: string; kind: "money" | "number"; dims: string[]; formula: string | null; inputs: ForecastVariableInput[] };
export type DimensionDraft = ModelDimensionRow;
export type VariableDraft = ModelVariableRow;
/** A dry-run or write draft: each entry replaces the saved one named `replaces` (or its own name), so renames work. */
export type ModelDraft = { dimensions?: (DimensionDraft & { replaces?: string })[]; variables?: (VariableDraft & { replaces?: string })[] };

export const emptyModel = (): ForecastModel => ({ dimensions: [], variables: [] });

export function variableFromDraft(draft: VariableDraft): ForecastVariable {
  return { name: draft.name, kind: draft.kind, dims: [...draft.dims], ...(draft.formula !== null ? { formula: draft.formula } : {}), inputs: draft.inputs.map((input) => ({ coords: { ...input.coords }, from: input.from, value: input.value })) };
}

/** Active rows as the engine's canonical model, or undefined when there are none (the input then omits `model`). */
export function rowsToModel(dimensions: ModelDimensionRow[], variables: ModelVariableRow[]): ForecastModel | undefined {
  if (!dimensions.length && !variables.length) return undefined;
  return canonicalizeModel({ dimensions: dimensions.map((row) => ({ name: row.name, items: [...row.items] })), variables: variables.map(variableFromDraft) });
}

export const withDimension = (model: ForecastModel, draft: DimensionDraft, replaces?: string): ForecastModel =>
  canonicalizeModel({ dimensions: [...model.dimensions.filter((dimension) => dimension.name !== (replaces ?? draft.name)), { name: draft.name, items: [...draft.items] }], variables: model.variables });
export const withoutDimension = (model: ForecastModel, name: string): ForecastModel => canonicalizeModel({ dimensions: model.dimensions.filter((dimension) => dimension.name !== name), variables: model.variables });
export const withVariable = (model: ForecastModel, draft: VariableDraft, replaces?: string): ForecastModel =>
  canonicalizeModel({ dimensions: model.dimensions, variables: [...model.variables.filter((variable) => variable.name !== (replaces ?? draft.name)), variableFromDraft(draft)] });
export const withoutVariable = (model: ForecastModel, name: string): ForecastModel => canonicalizeModel({ dimensions: model.dimensions, variables: model.variables.filter((variable) => variable.name !== name) });

export function mergeModelDraft(model: ForecastModel, draft: ModelDraft): ForecastModel {
  let next = model;
  for (const { replaces, ...dimension } of draft.dimensions ?? []) next = withDimension(next, dimension, replaces);
  for (const { replaces, ...variable } of draft.variables ?? []) next = withVariable(next, variable, replaces);
  return next;
}
```

In `apps/web/src/lib/forecast-drivers.ts`:
  1. Add `amountFormula?: string | null;` to `EconomicItemDriverRow`, after `amount: string | null;`.
  2. In `economicItemToDriver`, add `...(item.amountFormula ? { amountFormula: item.amountFormula } : {}),` directly after `amountMinor: amountToMinor(item.amount),`.

In `apps/web/src/lib/revision-cause.ts`, extend the union's last line:

```ts
  | "period_rolled" | "model_changed" | "item_formula_changed";
```

In `apps/web/src/lib/consequence-copy.ts`, make three changes:
  1. Add these two entries to the `verbs` record: `model_changed: ["Changed", "the model"], item_formula_changed: ["Set a formula on", "an item"],`.
  2. At the top of `describeCause`, after the `period_rolled` line, add:

```ts
  const single = cause.subjectLabel ?? cause.subjectLabels?.[0] ?? null;
  if (cause.kind === "model_changed") return single ? `Changed the model: ${single}` : "Changed the model";
  if (cause.kind === "item_formula_changed") return `Set a formula on ${single ?? "an item"}`;
```

  3. Leave the rest of the function unchanged.

- [ ] **Step 8: Run the pure tests.**
  - Run: `pnpm --filter @finance/web test forecast-model-rows forecast-drivers consequence-copy`
  - Expected: PASS.

- [ ] **Step 9: Write the failing DB test.** Create `apps/web/src/lib/forecast-model-load.test.ts`:

```ts
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: fileURLToPath(new URL("../../../../.env.local", import.meta.url)) });
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!process.env.DATABASE_URL)("forecast model loading", async () => {
  if (!process.env.DATABASE_URL) return; // skipped suites still run their factory
  const { closeDatabase, companies, economicItems, forecastDimensions, forecastVariables, getDatabase } = await import("@finance/database");
  const { addMonths } = await import("@balsa/finance-engine");
  const { forecastAsOfMonth, loadForecastInputs, loadForecastModel, resolveDriversForWindow } = await import("./forecast-inputs");
  const db = getDatabase();
  let companyId = ""; let otherId = "";

  beforeAll(async () => {
    const [company, other] = await db.insert(companies).values([{ name: `Model load ${Date.now()}` }, { name: `Model load other ${Date.now()}` }]).returning({ id: companies.id });
    companyId = company!.id; otherId = other!.id;
  });

  afterAll(async () => {
    for (const id of [companyId, otherId]) if (id) await db.delete(companies).where(eq(companies.id, id));
    await closeDatabase();
  });

  it("omits the model when the company has none", async () => {
    expect("model" in (await loadForecastInputs(companyId))).toBe(false);
  });

  it("loads active rows canonically and scoped to the company", async () => {
    await db.insert(forecastDimensions).values([{ companyId, name: "team", items: ["Eng", "Sales"] }, { companyId, name: "old", items: ["x"], active: "N" }]);
    await db.insert(forecastVariables).values([
      { companyId, name: "salary", kind: "money", dims: ["team"], inputs: [{ coords: { team: "Sales" }, from: "2026-01", value: "8000" }, { coords: { team: "Eng" }, from: "2026-01", value: "10000" }] },
      { companyId, name: "headcount", kind: "number", dims: ["team"], inputs: [] },
    ]);
    const input = await loadForecastInputs(companyId);
    expect(input.model).toEqual({
      dimensions: [{ name: "team", items: ["Eng", "Sales"] }],
      variables: [
        { name: "headcount", kind: "number", dims: ["team"], inputs: [] },
        { name: "salary", kind: "money", dims: ["team"], inputs: [{ coords: { team: "Eng" }, from: "2026-01", value: "10000" }, { coords: { team: "Sales" }, from: "2026-01", value: "8000" }] },
      ],
    });
    expect(await loadForecastModel(otherId)).toBeUndefined();
  });

  it("carries an item's formula and resolves it for a projection window", async () => {
    const firstMonth = addMonths(await forecastAsOfMonth(companyId, new Date()), 1);
    const [item] = await db.insert(economicItems).values({ companyId, type: "obligation", direction: "spend", label: "Salaries", amountFormula: "sum(salary)", cadence: "monthly", effectiveFrom: firstMonth, status: "confirmed" }).returning({ id: economicItems.id });
    const input = await loadForecastInputs(companyId);
    expect(input.drivers.find((driver) => driver.id === item!.id)).toMatchObject({ amountFormula: "sum(salary)" });
    const window = resolveDriversForWindow(input.drivers, input.model, { start: firstMonth, end: firstMonth });
    expect(window.exceptions).toEqual([]);
    expect(window.drivers.find((driver) => driver.id === item!.id)!.amountByMonth![firstMonth]).toBe("1800000");
  });
});
```

- [ ] **Step 10: Run the DB test to confirm it fails.**
  - Run: `pnpm --filter @finance/web test forecast-model-load`
  - Expected: FAIL with `loadForecastModel is not a function` (or `resolveDriversForWindow is not a function`).

- [ ] **Step 11: Implement loading.** In `apps/web/src/lib/forecast-inputs.ts`:
  1. Replace the imports with:

```ts
import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { chartAccounts, companies, economicItems, forecastDimensions, forecastEntryTemplates, forecastVariables, getDatabase, journalPeriodClosures } from "@finance/database";
import { addMonths, isValidMonth, monthRange, resolveFormulaDrivers, summarizeActualCash, type ForecastDriver, type ForecastModel, type ForecastRunInput } from "@balsa/finance-engine";
import type { DbExecutor } from "@/lib/db-executor";
import { chartAccountToForecastAccount, economicItemToDriver, forecastAsOfFromClosure, templateRowToTemplate } from "@/lib/forecast-drivers";
import { rowsToModel } from "@/lib/forecast-model-rows";
import { loadPostedJournalLines } from "@/lib/journal-ledger";
```

  2. Add these functions after `loadForecastAccounts`:

```ts
/** The company's active forecast model in canonical order, or undefined when it has none. */
export async function loadForecastModel(companyId: string, db: DbExecutor = getDatabase()): Promise<ForecastModel | undefined> {
  const [dimensions, variables] = await Promise.all([
    db.select({ name: forecastDimensions.name, items: forecastDimensions.items }).from(forecastDimensions).where(and(eq(forecastDimensions.companyId, companyId), eq(forecastDimensions.active, "Y"))),
    db.select({ name: forecastVariables.name, kind: forecastVariables.kind, dims: forecastVariables.dims, formula: forecastVariables.formula, inputs: forecastVariables.inputs }).from(forecastVariables).where(and(eq(forecastVariables.companyId, companyId), eq(forecastVariables.active, "Y"))),
  ]);
  return rowsToModel(dimensions, variables);
}

/**
 * Formula drivers resolved for a projection window outside the forecast run (plan pinning and the
 * projection preview). The window starts the month before `start`, so `prev` at `start` reads a real
 * month. Drivers whose formula fails are left out and reported as exceptions.
 */
export function resolveDriversForWindow(drivers: ForecastDriver[], model: ForecastModel | undefined, window: { start: string; end: string }) {
  if (!isValidMonth(window.start) || !isValidMonth(window.end) || window.start > window.end) return { drivers, exceptions: [] as { driverId: string; reason: string }[] };
  const resolution = resolveFormulaDrivers(drivers, model, monthRange(addMonths(window.start, -1), window.end));
  const failed = new Set(resolution.exceptions.map((exception) => exception.driverId));
  return { drivers: resolution.drivers.filter((driver) => !failed.has(driver.id)), exceptions: resolution.exceptions };
}
```

  3. In `loadForecastInputs`, load the model in the same `Promise.all` and include it only when it is present:

```ts
  const [{ drivers, templates }, actualLines, accounts, model] = await Promise.all([
    loadForecastDrivers(companyId, {}, db),
    loadPostedJournalLines(companyId, asOfMonth, db),
    loadForecastAccounts(companyId, db),
    loadForecastModel(companyId, db),
  ]);
  return { actuals: summarizeActualCash(actualLines, company.baseCurrency, asOfMonth), drivers: drivers.sort((left, right) => compareIds(left.id, right.id)), templates: templates.sort((left, right) => compareIds(left.id, right.id)), accounts, currency: company.baseCurrency, asOfMonth, horizonMonths: forecastHorizonMonths, minimumCashMinor: company.minimumCashMinor, ...(model ? { model } : {}) };
```

- [ ] **Step 12: Reload the model in the preview and scenario base.** Find the base loader with `grep -n "parsed as ForecastRunInput" -r apps/web/src/lib`. It is `loadForecastBase` after the scenarios work, or `loadPreviewBaseInput` before it. In its stored-input reuse branch, replace the `Promise.all` and the `return` with the code below, and add `loadForecastModel` to that file's `@/lib/forecast-inputs` import:

```ts
      const [{ drivers, templates }, accounts, model] = await Promise.all([loadForecastDrivers(companyId, {}, db), loadForecastAccounts(companyId, db), loadForecastModel(companyId, db)]);
      // The model is reloaded with drivers and templates; a stored model is dropped so a deleted one cannot linger.
      const { model: _storedModel, ...stored } = parsed as ForecastRunInput;
      void _storedModel;
      return { ...stored, drivers: drivers.sort((left, right) => compareIds(left.id, right.id)), templates: templates.sort((left, right) => compareIds(left.id, right.id)), accounts, ...(model ? { model } : {}) };
```

- [ ] **Step 13: Resolve formulas for plan pinning and the projection preview.**
  1. In `apps/web/src/lib/forecast-plan-pin.ts`:
     - Change the import to `import { loadForecastDrivers, loadForecastModel, resolveDriversForWindow } from "@/lib/forecast-inputs";`.
     - Replace the `loadForecastDrivers` and `buildProjectedEntries` lines with:

```ts
  const { drivers: loaded, templates } = await loadForecastDrivers(companyId, input.scenarioId ? { scenarioId: input.scenarioId } : {});
  const formulas = resolveDriversForWindow(loaded, await loadForecastModel(companyId), { start: input.start, end: input.end });
  const projection = buildProjectedEntries(formulas.drivers, templates, { start: input.start, end: input.end }, input.scenarioId);
```

     - In the final `return`, replace `exceptions: projection.exceptions` with `exceptions: [...formulas.exceptions, ...projection.exceptions]`.
  2. In `apps/web/src/app/api/forecast-projections/route.ts`:
     - Change the import to `import { loadForecastDrivers, loadForecastModel, resolveDriversForWindow } from "@/lib/forecast-inputs";`.
     - Replace the last three lines of `GET` with:

```ts
  const { drivers: loaded, templates } = await loadForecastDrivers(context.company.id, scenarioId ? { scenarioId } : {});
  const formulas = resolveDriversForWindow(loaded, await loadForecastModel(context.company.id), { start: start!, end: end! });
  const projection = buildProjectedEntries(formulas.drivers, templates, { start: start!, end: end! }, scenarioId);
  return NextResponse.json({ horizon: { start, end }, scenarioId: scenarioId ?? null, entries: projection.entries, exceptions: [...formulas.exceptions, ...projection.exceptions] });
```

- [ ] **Step 14: Label model causes in consequences.** In `apps/web/src/lib/forecast-read.ts`, in `loadRecentConsequences`:
  1. Add `forecastDimensions, forecastVariables` to the `@finance/database` import.
  2. Extend the `Promise.all` that loads `items, documents, answers` with two more lookups, and fold them into `labels`:

```ts
  const [items, documents, answers, variables, dimensions] = await Promise.all([
    /* the three existing lookups, unchanged */
    ids("forecast_variable").length ? db.select({ id: forecastVariables.id, label: forecastVariables.name }).from(forecastVariables).where(and(eq(forecastVariables.companyId, companyId), inArray(forecastVariables.id, ids("forecast_variable")))) : [],
    ids("forecast_dimension").length ? db.select({ id: forecastDimensions.id, label: forecastDimensions.name }).from(forecastDimensions).where(and(eq(forecastDimensions.companyId, companyId), inArray(forecastDimensions.id, ids("forecast_dimension")))) : [],
  ]);
  const labels = new Map([...items, ...documents, ...answers, ...variables, ...dimensions].map((row) => [row.id, row.label]));
```

Keep the three existing lookups exactly as they are, in their current positions. Only the destructured names, the two new array entries, and the `labels` line change. Deactivated rows still resolve, so a deleted variable keeps its name in history.

- [ ] **Step 15: Run the tests.**
  - Run: `pnpm --filter @finance/web test forecast-model-load forecast-model-rows forecast-drivers consequence-copy forecast-preview forecast-job`
  - Expected: PASS. The DB suites run, they do not skip.
  - Then run: `pnpm --filter @balsa/finance-engine test && pnpm --filter @finance/web test && pnpm -r typecheck && pnpm --filter @finance/web lint`
  - Expected: all tests pass, typecheck exits 0, and lint reports 10 errors and 13 warnings (the baseline).

- [ ] **Step 16: Commit.**

```bash
git add packages/database apps/web/src/lib apps/web/src/app/api/forecast-projections
git commit -m "Store and load the forecast model, carry item formulas, and name model causes

Co-Authored-By: <implementing model> <noreply@anthropic.com>"
```

---

### Task 5: Model API, dry run, and item formulas

**Files:**
- Create:
  - `apps/web/src/lib/forecast-model-schema.ts` (pure)
  - `apps/web/src/lib/forecast-model-store.ts` (server)
  - `apps/web/src/lib/forecast-model-http.ts` (server)
  - `apps/web/src/lib/forecast-model-fixture.ts` (test-only)
  - `apps/web/src/lib/forecast-model-store.test.ts` (DB)
  - `apps/web/src/lib/test-database.ts` (test-only; creates an isolated Drizzle/postgres-js client with a configurable `max`, used to prove the one-connection path)
- Create routes:
  - `apps/web/src/app/api/forecast/model/route.ts`
  - `apps/web/src/app/api/forecast/model/dimensions/route.ts` and `dimensions/[id]/route.ts`
  - `apps/web/src/app/api/forecast/model/variables/route.ts` and `variables/[id]/route.ts`
  - `apps/web/src/app/api/forecast/model/validate/route.ts`
- Modify:
  - `apps/web/src/app/api/items/route.ts`
  - `apps/web/src/app/api/forecast/preview/route.ts`
  - `apps/web/src/lib/forecast-preview.ts`

**Interfaces:**
- Consumes:
  - `loadForecastModel`, `forecastAsOfMonth`, `forecastHorizonMonths`
  - the draft helpers in `forecast-model-rows.ts`
  - `validateModel`, `evaluateModel`, `evaluateFormula`, `formatDecimal`, `monthRange`, `addMonths`
  - `refreshCurrentCalculationRun`
- Produces:
  - `forecast-model-schema.ts`:
    - `modelNameSchema`, `modelMonthSchema`, `modelFormulaSchema`, `variableInputSchema`
    - `dimensionDraftSchema` and `dimensionPatchSchema`
    - `variableDraftSchema`, with output `{ name; kind; dims: string[]; formula: string | null; inputs: { coords: Record<string, string>; from: string; value: string }[] }`
    - `variablePatchSchema`
    - `modelDraftSchema`, which parses `{ dimensions?, variables?, itemFormula? }`
  - `forecast-model-store.ts`:
    - `class ModelWriteError extends Error { status: 404 | 409 | 422; issues: ModelIssue[] }`
    - Executor-aware shared implementations `createDimensionWith(db, ...)`, `updateDimensionWith(db, ...)`, `deactivateDimensionWith(db, ...)`, `createVariableWith(db, ...)`, `updateVariableWith(db, ...)`, `deactivateVariableWith(db, ...)`, `upsertVariableByNameWith(db, ...)`, `upsertDimensionByNameWith(db, ...)`, and `setItemFormulaWith(db, ...)`. These contain all reads, whole-model validation, and writes and never call `getDatabase()`.
    - Public convenience wrappers with the original names/signatures open exactly one transaction and delegate to the corresponding `...With` implementation. `createVariable`/`upsertVariableByName`/`setItemFormula` continue to accept decision lineage as described below.
    - `type ModelDryRun = { errors: ModelIssue[]; warnings: ModelIssue[]; sample: Record<string, { dims: string[]; rows: { coords: Record<string, string>; values: Record<string, string | null> }[] }>; itemSample: Record<string, string | null> | null }`
    - `validateModelDraft(companyId, draft: ModelDraft & { itemFormula?: string }, now?: Date): Promise<ModelDryRun>`
  - `forecast-model-http.ts`: `uuidParam`, `invalidBody(details)`, `modelErrorResponse(error)`, and `commitModelWrite(companyId, cause, mutate)`. `commitModelWrite` opens one transaction, calls `mutate(tx)`, and calls a new executor-aware `enqueueCalculationRefreshWith(tx, companyId, cause, { rebuildJournalGraphs: false })` before commit; after commit the route calls `processEnqueuedCalculationRefresh(receipt)`. Mutation, revision increment, cause row, and outbox enqueue are therefore atomic, while calculation processing is post-commit.
  - HTTP:
    - `GET /api/forecast/model` returns `{ dimensions: { id, name, items }[], variables: { id, name, kind, dims, formula, inputs, decisionId }[] }`.
    - `POST /api/forecast/model/dimensions` returns 201 `{ dimension, calculationRun }`. `PATCH` returns `{ dimension, calculationRun }`. `DELETE /api/forecast/model/dimensions/[id]` returns `{ dimension, deactivated: true, calculationRun }`.
    - The variables endpoints mirror the dimensions endpoints.
    - `POST /api/forecast/model/validate` returns a `ModelDryRun`.
    - Every write returns 400 for a malformed body, 404 when not found or owned by another company, 409 for a duplicate name, and 422 `{ error, errors }` when the resulting model is invalid.
    - `PATCH /api/items` accepts `changes.amountFormula: string | null`, for one id at a time. The revision cause is `item_formula_changed` unless a `status` is also sent.
    - `POST /api/forecast/preview` accepts `confirm_item.edits.amountFormula: string | null`.
  - `seedModelCompany(name)` (test-only) returns `{ companyId, asOfMonth, firstMonth, dimensionId, variableIds: { headcount, salary, payroll, tax }, seedItemId, payrollItemId, byTeam(eng, sales) }`. The seeded forecast has a $1,000,000 receipt in the first month and a Payroll item with the formula `sum(payroll) + sum(tax)` at $49,519 a month, so runway is 20 months.

- [ ] **Step 1: Write the shared schemas.** Create `apps/web/src/lib/forecast-model-schema.ts`:

```ts
import { z } from "zod";

/** Shape only: naming rules, references, and limits are checked by validateModel so they come back as positioned errors. */
export const modelNameSchema = z.string().trim().min(1).max(64);
export const modelMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const modelFormulaSchema = z.string().trim().min(1).max(2000);
export const variableKindSchema = z.enum(["money", "number"]);
export const variableInputSchema = z.object({ coords: z.record(z.string(), z.string()), from: modelMonthSchema, value: z.string().trim().regex(/^-?\d+(\.\d{1,6})?$/, "Use a decimal with at most 6 places") });

export const dimensionDraftSchema = z.object({ name: modelNameSchema, items: z.array(modelNameSchema).max(500) });
export const dimensionPatchSchema = z.object({ name: modelNameSchema.optional(), items: z.array(modelNameSchema).max(500).optional() });

export const variableDraftSchema = z.object({
  name: modelNameSchema,
  kind: variableKindSchema,
  dims: z.array(modelNameSchema).max(12).default([]),
  formula: modelFormulaSchema.nullable().default(null),
  inputs: z.array(variableInputSchema).max(10_000).default([]),
});
export const variablePatchSchema = z.object({
  name: modelNameSchema.optional(),
  kind: variableKindSchema.optional(),
  dims: z.array(modelNameSchema).max(12).optional(),
  formula: modelFormulaSchema.nullable().optional(),
  inputs: z.array(variableInputSchema).max(10_000).optional(),
});

/** A dry-run draft: entries replace the saved one named `replaces` (or their own name); `itemFormula` is checked as a driver formula. */
export const modelDraftSchema = z.object({
  dimensions: z.array(dimensionDraftSchema.extend({ replaces: modelNameSchema.optional() })).max(12).optional(),
  variables: z.array(variableDraftSchema.extend({ replaces: modelNameSchema.optional() })).max(200).optional(),
  itemFormula: z.string().trim().max(4000).optional(),
});
```

- [ ] **Step 2: Write the test fixture.** Create `apps/web/src/lib/forecast-model-fixture.ts`:

```ts
/**
 * Test-only. A company whose Payroll item takes its amount from the model:
 * headcount[team] × salary[team] → payroll, payroll × 0.0765 → tax, item formula sum(payroll) + sum(tax).
 * Eng 3 × $10,000 and Sales 2 × $8,000 give $49,519 a month against a $1,000,000 receipt in the
 * first forecast month, so the seeded base runway is 20 months. Imports lazily so DB-less runs never connect.
 */
export async function seedModelCompany(name: string) {
  const { chartAccounts, companies, economicItems, forecastEntryTemplates, getDatabase } = await import("@finance/database");
  const { addMonths } = await import("@balsa/finance-engine");
  const { forecastAsOfMonth } = await import("./forecast-inputs");
  const { createDimension, createVariable } = await import("./forecast-model-store");
  const { refreshCurrentCalculationRun } = await import("./refresh-calculation-run");
  const db = getDatabase();
  const [company] = await db.insert(companies).values({ name: `${name} ${Date.now()}` }).returning({ id: companies.id });
  const companyId = company!.id;
  const [cash, payroll, revenue] = await db.insert(chartAccounts).values([
    { companyId, code: "1000", name: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" },
    { companyId, code: "6000", name: "Payroll", accountType: "expense", normalBalance: "debit" },
    { companyId, code: "4000", name: "Revenue", accountType: "revenue", normalBalance: "credit" },
  ]).returning({ id: chartAccounts.id });
  await db.insert(forecastEntryTemplates).values([
    { companyId, name: "Spend", itemType: "obligation", direction: "spend", debitAccountId: payroll!.id, creditAccountId: cash!.id },
    { companyId, name: "Receipts", itemType: "agreement", direction: "receipt", debitAccountId: cash!.id, creditAccountId: revenue!.id },
  ]);
  const asOfMonth = await forecastAsOfMonth(companyId, new Date());
  const firstMonth = addMonths(asOfMonth, 1);
  const byTeam = (eng: string, sales: string) => [{ coords: { team: "Eng" }, from: firstMonth, value: eng }, { coords: { team: "Sales" }, from: firstMonth, value: sales }];
  const team = await createDimension(companyId, { name: "team", items: ["Eng", "Sales"] });
  const headcount = await createVariable(companyId, { name: "headcount", kind: "number", dims: ["team"], formula: null, inputs: byTeam("3", "2") });
  const salary = await createVariable(companyId, { name: "salary", kind: "money", dims: ["team"], formula: null, inputs: byTeam("10000", "8000") });
  const payrollVariable = await createVariable(companyId, { name: "payroll", kind: "money", dims: ["team"], formula: "headcount * salary", inputs: [] });
  const tax = await createVariable(companyId, { name: "tax", kind: "money", dims: ["team"], formula: "payroll * 0.0765", inputs: [] });
  const [seed, payrollItem] = await db.insert(economicItems).values([
    { companyId, type: "agreement", direction: "receipt", label: "Seed round", amount: "1000000", cadence: "once", effectiveFrom: firstMonth, status: "confirmed" },
    { companyId, type: "obligation", direction: "spend", label: "Payroll", amountFormula: "sum(payroll) + sum(tax)", cadence: "monthly", effectiveFrom: firstMonth, category: "salary", status: "confirmed" },
  ]).returning({ id: economicItems.id });
  await refreshCurrentCalculationRun(companyId, { cause: { kind: "entity_changed", subjectType: "company", subjectId: companyId, actorUserId: null, via: "worker" } });
  return { companyId, asOfMonth, firstMonth, dimensionId: team.id, variableIds: { headcount: headcount.id, salary: salary.id, payroll: payrollVariable.id, tax: tax.id }, seedItemId: seed!.id, payrollItemId: payrollItem!.id, byTeam };
}
```

- [ ] **Step 2a: Add the bounded-pool test helper.** Create `apps/web/src/lib/test-database.ts`. It is test-only and must not import the application singleton:

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@finance/database/schema";

/** An isolated test executor whose pool size is explicit; callers must close it in `finally`. */
export function createTestDatabase(url: string, options: { max: number }) {
  const client = postgres(url, { max: options.max, onnotice: () => undefined });
  const db = drizzle(client, { schema });
  return Object.assign(db, { end: () => client.end() });
}

export type TestDatabase = ReturnType<typeof createTestDatabase>;
```

  If `@finance/database/schema` is not currently exported, add that package export pointing to `src/schema.ts`; do not import through a private filesystem path. This helper exists only to prove that executor-aware implementations never try to acquire a second pooled connection.

- [ ] **Step 3: Write the failing DB test.** Create `apps/web/src/lib/forecast-model-store.test.ts`:

```ts
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ForecastConsequence } from "@balsa/finance-engine";

config({ path: fileURLToPath(new URL("../../../../.env.local", import.meta.url)) });
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!process.env.DATABASE_URL)("forecast model store", async () => {
  if (!process.env.DATABASE_URL) return; // skipped suites still run their factory
  const { calculationOutbox, closeDatabase, companies, financialStateRevisions, forecastVariables, getDatabase } = await import("@finance/database");
  const { addMonths } = await import("@balsa/finance-engine");
  const { seedModelCompany } = await import("./forecast-model-fixture");
  const store = await import("./forecast-model-store");
  const { loadForecastInputs, loadForecastModel } = await import("./forecast-inputs");
  const { loadLatestForecast, loadRecentConsequences } = await import("./forecast-read");
  const { refreshCurrentCalculationRun } = await import("./refresh-calculation-run");
  const { describeCause } = await import("./consequence-copy");
  const { commitModelWrite } = await import("./forecast-model-http");
  const { createTestDatabase } = await import("./test-database");
  const db = getDatabase();
  let seeded!: Awaited<ReturnType<typeof seedModelCompany>>;
  let otherCompanyId = "";
  const revision = async () => (await db.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, seeded.companyId)))[0]!.revision;
  const activeVariables = async () => (await db.select({ id: forecastVariables.id }).from(forecastVariables).where(and(eq(forecastVariables.companyId, seeded.companyId), eq(forecastVariables.active, "Y")))).length;

  beforeAll(async () => {
    seeded = await seedModelCompany("Model store");
    const [other] = await db.insert(companies).values({ name: `Model store other ${Date.now()}` }).returning({ id: companies.id });
    otherCompanyId = other!.id;
  });

  afterAll(async () => {
    for (const id of [seeded?.companyId, otherCompanyId]) if (id) await db.delete(companies).where(eq(companies.id, id));
    await closeDatabase();
  });

  it("loads the model canonically and runs the formula driver through the stored forecast", async () => {
    const input = await loadForecastInputs(seeded.companyId);
    expect(input.model!.variables.map((variable) => variable.name)).toEqual(["headcount", "payroll", "salary", "tax"]);
    expect(input.drivers.find((driver) => driver.id === seeded.payrollItemId)).toMatchObject({ amountFormula: "sum(payroll) + sum(tax)" });
    const latest = (await loadLatestForecast(seeded.companyId))!;
    expect(latest.run.exceptions).toEqual([]);
    expect(latest.run.runway.runwayMonths).toBe(20);
    expect(latest.run.modelSummary!.variables.map((variable) => variable.name)).toEqual(["headcount", "payroll", "salary", "tax"]);
  });

  it("rejects an invalid resulting model with 422 and writes nothing", async () => {
    const before = await activeVariables();
    await expect(store.createVariable(seeded.companyId, { name: "bonus", kind: "money", dims: [], formula: "sum(nope)", inputs: [] })).rejects.toMatchObject({ status: 422, issues: [{ variable: "bonus", position: 4, message: 'Unknown variable "nope"' }] });
    await expect(store.updateVariable(seeded.companyId, seeded.variableIds.payroll, { formula: "tax" })).rejects.toMatchObject({ status: 422 });
    // The item formula reads tax, and the variables read team: neither can be removed.
    await expect(store.deactivateVariable(seeded.companyId, seeded.variableIds.tax)).rejects.toMatchObject({ status: 422 });
    await expect(store.deactivateDimension(seeded.companyId, seeded.dimensionId)).rejects.toMatchObject({ status: 422 });
    expect(await activeVariables()).toBe(before);
  });

  it("commits the mutation, revision cause, and outbox atomically, then preserves the write when calculation fails", async () => {
    const before = await revision();
    const failed = await commitModelWrite(seeded.companyId, { kind: "model_changed", subjectType: "forecast_variable", actorUserId: null, via: "ui" }, async (tx) => {
      const row = await store.createVariableWith(tx, seeded.companyId, { name: "atomic_bonus", kind: "money", dims: [], formula: null, inputs: [{ coords: {}, from: seeded.firstMonth, value: "1" }] });
      return { value: row, subjectId: row.id };
    }, { process: async (receipt) => ({ financialStateRevision: receipt.financialStateRevision, status: "failed" as const, forecastJobId: receipt.forecastJobId, forecastStatus: "failed", error: "injected calculation failure" }) });
    expect(failed.calculationRun).toMatchObject({ status: "failed", error: "injected calculation failure" });
    expect(await revision()).toBe(String(BigInt(before) + 1n));
    expect((await loadForecastModel(seeded.companyId))!.variables.some((variable) => variable.name === "atomic_bonus")).toBe(true);
    const causes = await db.select().from(financialStateRevisions).where(and(eq(financialStateRevisions.companyId, seeded.companyId), eq(financialStateRevisions.revision, failed.calculationRun.financialStateRevision)));
    const jobs = await db.select().from(calculationOutbox).where(and(eq(calculationOutbox.companyId, seeded.companyId), eq(calculationOutbox.financialStateRevision, failed.calculationRun.financialStateRevision)));
    expect(causes).toHaveLength(1);
    expect(jobs.filter((job) => job.period === "forecast")).toHaveLength(1);

    const beforeRollback = await revision();
    await expect(commitModelWrite(seeded.companyId, { kind: "model_changed", subjectType: "forecast_variable", actorUserId: null, via: "ui" }, async (tx) => {
      const row = await store.createVariableWith(tx, seeded.companyId, { name: "must_rollback", kind: "number", dims: [], formula: null, inputs: [] });
      return { value: row, subjectId: row.id };
    }, { enqueue: async () => { throw new Error("injected enqueue failure"); } })).rejects.toThrow("injected enqueue failure");
    expect(await revision()).toBe(beforeRollback);
    expect((await loadForecastModel(seeded.companyId))!.variables.some((variable) => variable.name === "must_rollback")).toBe(false);
  });

  it("uses one database connection for an executor-aware store write and atomic enqueue", { timeout: 3_000 }, async () => {
    const single = createTestDatabase(process.env.DATABASE_URL!, { max: 1 });
    const bounded = <T>(work: Promise<T>) => Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("single-connection path timed out")), 2_000))]);
    try {
      await bounded(commitModelWrite(seeded.companyId, { kind: "model_changed", subjectType: "forecast_variable", actorUserId: null, via: "ui" }, async (tx) => {
        const row = await store.upsertVariableByNameWith(tx, seeded.companyId, { name: "headcount", kind: "number", dims: ["team"], formula: null, inputs: seeded.byTeam("4", "2") }, crypto.randomUUID());
        return { value: row, subjectId: row.id };
      }, { database: single, process: async (receipt) => ({ financialStateRevision: receipt.financialStateRevision, status: "not_queued" as const, forecastJobId: receipt.forecastJobId, forecastStatus: "not_queued" }) }));
    } finally { await single.end(); }
  });

  it("rejects a duplicate active name with 409", async () => {
    await expect(store.createDimension(seeded.companyId, { name: "team", items: ["X"] })).rejects.toMatchObject({ status: 409 });
    await expect(store.createVariable(seeded.companyId, { name: "salary", kind: "money", dims: [], formula: null, inputs: [] })).rejects.toMatchObject({ status: 409 });
  });

  it("validates an item formula against the model", async () => {
    await expect(store.setItemFormula(seeded.companyId, seeded.payrollItemId, "payroll")).rejects.toMatchObject({ status: 422, issues: [{ driverId: seeded.payrollItemId, message: "The formula still has dimensions team; use sum(...) to collapse team" }] });
  });

  it("dry-runs a draft with samples and writes nothing", async () => {
    const before = await revision();
    const months = [seeded.firstMonth, addMonths(seeded.firstMonth, 1), addMonths(seeded.firstMonth, 2)];
    const values = (value: string) => Object.fromEntries(months.map((month) => [month, value]));
    const result = await store.validateModelDraft(seeded.companyId, { variables: [{ name: "salary", kind: "money", dims: ["team"], formula: null, inputs: seeded.byTeam("12000", "8000") }], itemFormula: "sum(payroll)" });
    expect(result.errors).toEqual([]);
    expect(result.sample.salary).toEqual({ dims: ["team"], rows: [{ coords: { team: "Eng" }, values: values("12000") }, { coords: { team: "Sales" }, values: values("8000") }] });
    expect(result.itemSample).toEqual(values("52000"));
    expect((await store.validateModelDraft(seeded.companyId, { itemFormula: "payroll" })).errors).toEqual([{ driverId: "draft", message: "The formula still has dimensions team; use sum(...) to collapse team" }]);
    expect(await revision()).toBe(before);
  });

  it("bumps the revision and records a consequence for a model write", async () => {
    const before = await revision();
    const salary = await store.updateVariable(seeded.companyId, seeded.variableIds.salary, { inputs: seeded.byTeam("12000", "8000") });
    const result = await refreshCurrentCalculationRun(seeded.companyId, { cause: { kind: "model_changed", subjectType: "forecast_variable", subjectId: salary.id, actorUserId: null, via: "ui" }, rebuildJournalGraphs: false });
    expect(BigInt(result.financialStateRevision)).toBe(BigInt(before) + 1n);
    const [cause] = await db.select().from(financialStateRevisions).where(and(eq(financialStateRevisions.companyId, seeded.companyId), eq(financialStateRevisions.revision, result.financialStateRevision)));
    expect(cause).toMatchObject({ kind: "model_changed", subjectType: "forecast_variable", subjectId: salary.id });
    const [consequence] = await loadRecentConsequences(seeded.companyId, 1);
    expect(consequence!.revision).toBe(result.financialStateRevision);
    // Eng salary +2,000 × 3 heads = +6,000 payroll and +459 tax: 645,900 minor units in each of 24 months.
    expect((consequence!.delta as ForecastConsequence).projectedSpending.deltaMinor).toBe("15501600");
    expect(describeCause(consequence!.causes[0]!)).toBe("Changed the model: salary");
  });

  it("scopes every write and read to the company", async () => {
    await expect(store.updateVariable(otherCompanyId, seeded.variableIds.salary, { inputs: [] })).rejects.toMatchObject({ status: 404 });
    await expect(store.deactivateDimension(otherCompanyId, seeded.dimensionId)).rejects.toMatchObject({ status: 404 });
    await expect(store.setItemFormula(otherCompanyId, seeded.payrollItemId, "1")).rejects.toMatchObject({ status: 404 });
    expect(await loadForecastModel(otherCompanyId)).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run the test to confirm it fails.**
  - Run: `pnpm --filter @finance/web test forecast-model-store`
  - Expected: FAIL with `Failed to resolve import "./forecast-model-store"`.

- [ ] **Step 5: Implement the executor-aware store.** Create `apps/web/src/lib/forecast-model-store.ts`. Implement every validation/write body as an exported `...With(db: DbExecutor, companyId, ...)` function. `...With` must lock the company row through `db`, use that same executor for `currentState`, and perform every query through `db`; it must never call `getDatabase()` or start a transaction. For each UI/test convenience API shown without `With`, add a thin wrapper of the form `return getDatabase().transaction((tx) => createDimensionWith(tx, companyId, draft))`. Apply this consistently to dimension CRUD/upsert, variable CRUD/upsert, and item formula writes. `validateModelDraftWith(db, ...)` is the shared read-only implementation; `validateModelDraft(...)` delegates with `getDatabase()` only when no transaction already exists.

  The following signatures are normative:

```ts
createDimensionWith(db: DbTransaction, companyId: string, draft: DimensionDraft)
updateDimensionWith(db: DbTransaction, companyId: string, id: string, patch: Partial<DimensionDraft>)
deactivateDimensionWith(db: DbTransaction, companyId: string, id: string)
upsertDimensionByNameWith(db: DbTransaction, companyId: string, draft: DimensionDraft)
createVariableWith(db: DbTransaction, companyId: string, draft: VariableDraft, options?: { decisionId?: string })
updateVariableWith(db: DbTransaction, companyId: string, id: string, patch: Partial<VariableDraft>)
deactivateVariableWith(db: DbTransaction, companyId: string, id: string)
upsertVariableByNameWith(db: DbTransaction, companyId: string, draft: VariableDraft, decisionId: string)
setItemFormulaWith(db: DbTransaction, companyId: string, itemId: string, formula: string | null, options?: { decisionId?: string })
validateModelDraftWith(db: DbExecutor, companyId: string, draft: ModelDraft & { itemFormula?: string }, now?: Date)
```

  Implement the shared bodies directly from the validation/write logic established by the DB tests: lock the company row, load the current model and item formulas through the supplied executor, validate the complete prospective model, then perform the company-scoped write. Public wrappers are one-line transactions around those bodies. Keep `ModelWriteError`, `ModelDryRun`, and the dry-run sampling behavior specified above; there is no second store implementation and no nested transaction.

- [ ] **Step 6: Implement atomic HTTP writes and post-commit processing.** First split `refreshCurrentCalculationRun` into `enqueueCalculationRefreshWith(tx, companyId, options)`, which increments the revision, inserts its cause, and enqueues outbox rows using only `tx`, plus `processEnqueuedCalculationRefresh(receipt, now?)`, which processes jobs only after the caller's transaction commits. Keep `refreshCurrentCalculationRun` as a compatibility wrapper that runs the enqueue transaction and then processes its receipt.

  Create `forecast-model-http.ts` with `commitModelWrite(companyId, cause, mutate, deps?)`: one `(deps?.database ?? getDatabase()).transaction` calls `mutate(tx)` and `(deps?.enqueue ?? enqueueCalculationRefreshWith)(tx, ...)`, returns `{ value, receipt }`, and only then calls `(deps?.process ?? processEnqueuedCalculationRefresh)(receipt)`. The optional dependency object is test-only and defaults to production functions. A calculation failure returns a durable failed status from the outbox and must not roll back or invite a duplicate model mutation. Do not retain a non-atomic mutation-then-refresh helper.

  Every POST/PATCH/DELETE route below must therefore have this shape (substitute the matching `...With` function and cause subject):

```ts
const { value: dimension, calculationRun } = await commitModelWrite(
  context.company.id,
  { kind: "model_changed", subjectType: "forecast_dimension", actorUserId: context.user.id, via: "ui" },
  async (tx) => {
    const row = await createDimensionWith(tx, context.company.id, parsed.data);
    return { value: row, subjectId: row.id };
  },
);
```

  `commitModelWrite` fills the cause's `subjectId` from the mutation result before enqueueing. Item Formula changes use the same helper with `setItemFormulaWith` and `item_formula_changed`; the ordinary item PATCH must not also execute its legacy refresh path for that request. Every route block below uses this atomic pattern.

  Create `apps/web/src/lib/forecast-model-http.ts`:

```ts
import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDatabase } from "@finance/database";
import { ModelWriteError } from "@/lib/forecast-model-store";
import { enqueueCalculationRefreshWith, processEnqueuedCalculationRefresh } from "@/lib/refresh-calculation-run";
import type { DbTransaction } from "@/lib/db-executor";
import type { RevisionCause } from "@/lib/revision-cause";

export const uuidParam = z.string().uuid();
export const invalidBody = (details: unknown) => NextResponse.json({ error: "Invalid model request", details }, { status: 400 });

/** A refused model write as its HTTP status, with the positioned errors for 422. Anything else is rethrown. */
export function modelErrorResponse(error: unknown) {
  if (error instanceof ModelWriteError) return NextResponse.json({ error: error.message, errors: error.issues }, { status: error.status });
  throw error;
}

/** Commit the model mutation, revision cause, and outbox enqueue together; run the job only after commit. */
export async function commitModelWrite<T>(companyId: string, cause: Omit<RevisionCause, "subjectId">, mutate: (tx: DbTransaction) => Promise<{ value: T; subjectId: string }>, deps: { database?: Pick<ReturnType<typeof getDatabase>, "transaction">; enqueue?: typeof enqueueCalculationRefreshWith; process?: typeof processEnqueuedCalculationRefresh } = {}) {
  const committed = await (deps.database ?? getDatabase()).transaction(async (tx) => {
    const mutation = await mutate(tx);
    const receipt = await (deps.enqueue ?? enqueueCalculationRefreshWith)(tx, companyId, { cause: { ...cause, subjectId: mutation.subjectId }, rebuildJournalGraphs: false });
    return { value: mutation.value, receipt };
  });
  return { value: committed.value, calculationRun: await (deps.process ?? processEnqueuedCalculationRefresh)(committed.receipt) };
}
```

Create `apps/web/src/app/api/forecast/model/route.ts`:

```ts
import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { forecastDimensions, forecastVariables, getDatabase } from "@finance/database";
import { auth, requireCompanyAccess } from "@/lib/auth";

/** The company's active forecast model: dimensions and variables, by name. */
export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const db = getDatabase();
  const [dimensions, variables] = await Promise.all([
    db.select({ id: forecastDimensions.id, name: forecastDimensions.name, items: forecastDimensions.items }).from(forecastDimensions).where(and(eq(forecastDimensions.companyId, context.company.id), eq(forecastDimensions.active, "Y"))).orderBy(asc(forecastDimensions.name)),
    db.select({ id: forecastVariables.id, name: forecastVariables.name, kind: forecastVariables.kind, dims: forecastVariables.dims, formula: forecastVariables.formula, inputs: forecastVariables.inputs, decisionId: forecastVariables.decisionId }).from(forecastVariables).where(and(eq(forecastVariables.companyId, context.company.id), eq(forecastVariables.active, "Y"))).orderBy(asc(forecastVariables.name)),
  ]);
  return NextResponse.json({ dimensions, variables });
}
```

Create `apps/web/src/app/api/forecast/model/dimensions/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { commitModelWrite, invalidBody, modelErrorResponse } from "@/lib/forecast-model-http";
import { dimensionDraftSchema } from "@/lib/forecast-model-schema";
import { createDimensionWith } from "@/lib/forecast-model-store";

/** Add a dimension. The whole resulting model is validated first, and the write is a forecast revision. */
export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = dimensionDraftSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error.flatten());
  try {
    const { value: dimension, calculationRun } = await commitModelWrite(context.company.id, { kind: "model_changed", subjectType: "forecast_dimension", actorUserId: context.user.id, via: "ui" }, async (tx) => {
      const row = await createDimensionWith(tx, context.company.id, parsed.data);
      return { value: row, subjectId: row.id };
    });
    return NextResponse.json({ dimension, calculationRun }, { status: 201 });
  } catch (error) {
    return modelErrorResponse(error);
  }
}
```

Create `apps/web/src/app/api/forecast/model/dimensions/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { commitModelWrite, invalidBody, modelErrorResponse, uuidParam } from "@/lib/forecast-model-http";
import { dimensionPatchSchema } from "@/lib/forecast-model-schema";
import { deactivateDimensionWith, updateDimensionWith } from "@/lib/forecast-model-store";

const notFound = () => NextResponse.json({ error: "Dimension not found" }, { status: 404 });

/** Rename a dimension or change its items; variables and formulas that no longer fit make it a 422. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const { id } = await params;
  if (!uuidParam.safeParse(id).success) return notFound();
  const parsed = dimensionPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error.flatten());
  const { name, items } = parsed.data;
  try {
    const { value: dimension, calculationRun } = await commitModelWrite(context.company.id, { kind: "model_changed", subjectType: "forecast_dimension", actorUserId: context.user.id, via: "ui" }, async (tx) => {
      const row = await updateDimensionWith(tx, context.company.id, id, { ...(name !== undefined ? { name } : {}), ...(items !== undefined ? { items } : {}) });
      return { value: row, subjectId: row.id };
    });
    return NextResponse.json({ dimension, calculationRun });
  } catch (error) {
    return modelErrorResponse(error);
  }
}

/** Deactivate a dimension no variable uses. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const { id } = await params;
  if (!uuidParam.safeParse(id).success) return notFound();
  try {
    const { value: dimension, calculationRun } = await commitModelWrite(context.company.id, { kind: "model_changed", subjectType: "forecast_dimension", actorUserId: context.user.id, via: "ui" }, async (tx) => {
      const row = await deactivateDimensionWith(tx, context.company.id, id);
      return { value: row, subjectId: row.id };
    });
    return NextResponse.json({ dimension, deactivated: true, calculationRun });
  } catch (error) {
    return modelErrorResponse(error);
  }
}
```

Create `apps/web/src/app/api/forecast/model/variables/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { commitModelWrite, invalidBody, modelErrorResponse } from "@/lib/forecast-model-http";
import { variableDraftSchema } from "@/lib/forecast-model-schema";
import { createVariableWith } from "@/lib/forecast-model-store";

/** Add a variable: dated inputs or a formula. The whole resulting model is validated first. */
export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = variableDraftSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error.flatten());
  try {
    const { value: variable, calculationRun } = await commitModelWrite(context.company.id, { kind: "model_changed", subjectType: "forecast_variable", actorUserId: context.user.id, via: "ui" }, async (tx) => {
      const row = await createVariableWith(tx, context.company.id, parsed.data);
      return { value: row, subjectId: row.id };
    });
    return NextResponse.json({ variable, calculationRun }, { status: 201 });
  } catch (error) {
    return modelErrorResponse(error);
  }
}
```

Create `apps/web/src/app/api/forecast/model/variables/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { commitModelWrite, invalidBody, modelErrorResponse, uuidParam } from "@/lib/forecast-model-http";
import { variablePatchSchema } from "@/lib/forecast-model-schema";
import { deactivateVariableWith, updateVariableWith } from "@/lib/forecast-model-store";

const notFound = () => NextResponse.json({ error: "Variable not found" }, { status: 404 });

/** Edit a variable; switching to a formula must send `inputs: []` with it. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const { id } = await params;
  if (!uuidParam.safeParse(id).success) return notFound();
  const parsed = variablePatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error.flatten());
  const { name, kind, dims, formula, inputs } = parsed.data;
  try {
    const { value: variable, calculationRun } = await commitModelWrite(context.company.id, { kind: "model_changed", subjectType: "forecast_variable", actorUserId: context.user.id, via: "ui" }, async (tx) => {
      const row = await updateVariableWith(tx, context.company.id, id, { ...(name !== undefined ? { name } : {}), ...(kind !== undefined ? { kind } : {}), ...(dims !== undefined ? { dims } : {}), ...(formula !== undefined ? { formula } : {}), ...(inputs !== undefined ? { inputs } : {}) });
      return { value: row, subjectId: row.id };
    });
    return NextResponse.json({ variable, calculationRun });
  } catch (error) {
    return modelErrorResponse(error);
  }
}

/** Deactivate a variable nothing reads. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const { id } = await params;
  if (!uuidParam.safeParse(id).success) return notFound();
  try {
    const { value: variable, calculationRun } = await commitModelWrite(context.company.id, { kind: "model_changed", subjectType: "forecast_variable", actorUserId: context.user.id, via: "ui" }, async (tx) => {
      const row = await deactivateVariableWith(tx, context.company.id, id);
      return { value: row, subjectId: row.id };
    });
    return NextResponse.json({ variable, deactivated: true, calculationRun });
  } catch (error) {
    return modelErrorResponse(error);
  }
}
```

Create `apps/web/src/app/api/forecast/model/validate/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { invalidBody } from "@/lib/forecast-model-http";
import { modelDraftSchema } from "@/lib/forecast-model-schema";
import { validateModelDraft } from "@/lib/forecast-model-store";

/** The dry run: errors, warnings, and the first three forecast months for each drafted variable. Writes nothing. */
export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = modelDraftSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error.flatten());
  const draft = parsed.data;
  return NextResponse.json(await validateModelDraft(context.company.id, {
    ...(draft.dimensions ? { dimensions: draft.dimensions.map(({ replaces, ...dimension }) => ({ ...dimension, ...(replaces ? { replaces } : {}) })) } : {}),
    ...(draft.variables ? { variables: draft.variables.map(({ replaces, ...variable }) => ({ ...variable, ...(replaces ? { replaces } : {}) })) } : {}),
    ...(draft.itemFormula !== undefined ? { itemFormula: draft.itemFormula } : {}),
  }));
}
```

- [ ] **Step 7: Accept item formulas.** In `apps/web/src/app/api/items/route.ts`:
  1. Add the imports:

```ts
import { commitModelWrite, modelErrorResponse } from "@/lib/forecast-model-http";
import { setItemFormulaWith } from "@/lib/forecast-model-store";
```

  2. Add `amountFormula: z.string().trim().max(2000).nullable().optional(),` to the `changes` object schema.
  3. In `PATCH`, directly after `const changes = body.data.changes ?? {};`, add:

```ts
  // A formula is checked against the model and saved first; "" clears it like null.
  const formula = changes.amountFormula === undefined ? undefined : changes.amountFormula || null;
  if (formula !== undefined) {
    if (body.data.ids.length !== 1) return NextResponse.json({ error: "Set a formula on one item at a time" }, { status: 400 });
    try {
      const committed = await commitModelWrite(context.company.id, { kind: "item_formula_changed", subjectType: "economic_item", actorUserId: context.user.id, via: "ui" }, async (tx) => {
        const row = await setItemFormulaWith(tx, context.company.id, body.data.ids[0]!, formula);
        return { value: row, subjectId: row.id };
      });
      return NextResponse.json({ item: committed.value, calculationRun: committed.calculationRun });
    } catch (error) { return modelErrorResponse(error); }
  }
```

  4. The formula branch returns immediately from the atomic helper above. For requests without `amountFormula`, keep the existing `refreshCurrentCalculationRun` call and its original status/edit cause expression. Do not run it for a formula request and do not combine formula with other item changes in one request; return 400 if `amountFormula` is accompanied by other changes or `status`.

```ts
kind: body.data.status === "confirmed" ? "item_confirmed" : body.data.status === "rejected" ? "item_rejected" : "item_edited"
```

- [ ] **Step 8: Preview formula edits.**
  1. In `apps/web/src/app/api/forecast/preview/route.ts`:
     - Add `amountFormula: z.string().trim().min(1).max(2000).nullable().optional()` to the `confirm_item` `edits` object.
     - In `toChange`, add `...(edits.amountFormula !== undefined ? { amountFormula: edits.amountFormula } : {}),` to the rebuilt `edits`.
  2. In `apps/web/src/lib/forecast-preview.ts`:
     - Add `amountFormula?: string | null` to the `confirm_item` `edits` type of `ForecastPreviewChange`.
     - In the `economicItemToDriver({ ...item, … })` call, add `...(edits.amountFormula !== undefined ? { amountFormula: edits.amountFormula } : {})` to the spread list.

- [ ] **Step 9: Run the tests.** The suite must include the atomic enqueue/post-commit failure test and the single-connection executor test above. Use dependency injection for job processing; do not corrupt the database or monkey-patch global connection state.
  - Run: `pnpm --filter @finance/web test forecast-model-store`
  - Expected: PASS for all seven tests, running against the DB.
  - Then run: `pnpm --filter @finance/web test && pnpm -r typecheck && pnpm --filter @finance/web lint`
  - Expected: all tests pass, typecheck exits 0, and lint stays at the 10 errors and 13 warnings baseline.

- [ ] **Step 10: Commit.**

```bash
git add apps/web/src/lib apps/web/src/app/api/forecast apps/web/src/app/api/items
git commit -m "Add the forecast model API with whole-model validation, a dry run, and item formulas

Co-Authored-By: <implementing model> <noreply@anthropic.com>"
```

---

### Task 6: Decision effects, preview parity, and agent grammar

**Files:**
- Modify:
  - `apps/web/src/lib/decision-effects.ts`
  - `apps/web/src/lib/decision-driver-effects.ts`
  - `apps/web/src/lib/decision-driver-effects.test.ts`
  - `apps/web/src/lib/forecast-preview.ts`
  - `apps/web/src/app/api/agent/route.ts`
  - `apps/web/src/app/api/decisions/route.ts`
  - any direct caller still importing `projectDecisionEffectOnDrivers`
- Create: `apps/web/src/lib/forecast-model-decisions.test.ts` (DB)

**Interfaces:**
- Consumes: `ForecastRunInput`, `VariableDraft`, `DimensionDraft`, `variableDraftSchema`, `dimensionDraftSchema`, `modelFormulaSchema`, `upsertVariableByName`, `upsertDimensionByName`, `setItemFormula`, and the Task 5 model fixture.
- Produces:
  - Three new `DecisionEffect` variants:
    - `{ kind: "set_variable"; variable: { name; kind; dims; formula; inputs } }`
    - `{ kind: "set_dimension"; dimension: { name; items } }`
    - `{ kind: "set_item_formula"; itemId; amountFormula }`
  - Matching nullable fields in `FlatEffect`, `flatEffectJsonSchema`, `effectFromFlat`, storage parsing, descriptions, and application.
  - `projectDecisionEffect(input: ForecastRunInput, effect: DecisionEffect, decisionId: string): ForecastRunInput` as the one pure projection path for driver and model effects.
  - Preview/application parity for all three new effects.

**Rulings:**
- `set_variable` and `set_dimension` replace the active row with the same name; they do not create duplicate active names. `set_item_formula` targets an item id and replaces its formula.
- An applied model effect writes through the Task 5 store functions, so whole-model validation, company scope, `decisionId`, and error wording are shared with the HTTP API. Do not reproduce validation in `decision-effects.ts`.
- The existing decision application transaction must stay atomic. Call the Task 5 executor-aware `...With(db, ...)` store implementations directly; never call a public wrapper or open a second `getDatabase()` connection from inside `applyDecisionEffectWith`.
- Every effect kind—not just model effects—uses a durable `decision_effect_applications` marker. The marker is keyed by `(company_id, decision_id)`, stores `effect_kind`, bounded `result jsonb`, and `applied_at`, and has company RLS. It is inserted in the same transaction as the effect. Absence means retry is safe; presence returns the stored result without reapplying. Do not infer application from an economic item/variable row because dimension/category effects may have no such lineage row.
- Moving a decision to `applied`, applying its effect, inserting the marker, incrementing the financial revision with cause `decision_applied`, and enqueueing the calculation outbox are one transaction. Outbox processing occurs after commit. The decision route must not call its legacy `refreshCurrentCalculationRun` after this helper returns.
- Projection is immutable. A `set_variable` or `set_dimension` projection merges into `input.model ?? { dimensions: [], variables: [] }`, canonicalizes it, and preserves every unrelated `ForecastRunInput` field. `set_item_formula` changes only the matching driver. A missing target item is a no-op in projection and a not-found failure on application, matching existing item effects.
- Keep a compatibility wrapper named `projectDecisionEffectOnDrivers` only if an intermediate caller needs it during this task; remove it after Task 7 migrates the final callers.

- [ ] **Step 1: Write failing pure projection tests.** Extend `decision-driver-effects.test.ts` to prove:
  1. all existing add/end/change/category behavior is unchanged through `projectDecisionEffect({ ...base, drivers }, effect, id).drivers`;
  2. `set_dimension` adds and replaces by name without mutating the input;
  3. `set_variable` adds and replaces by name, preserves conditional optionals, and canonicalizes model order;
  4. `set_item_formula` changes only the target driver's `amountFormula`, attaches `decisionId`, and accepts a non-empty formula;
  5. model effects preserve `actuals`, templates, accounts, dates, currency, and all drivers byte-for-byte.

- [ ] **Step 2: Extend the decision schemas.** In `decision-effects.ts`:
  1. import and reuse the Task 5 model schemas rather than defining a second validation grammar;
  2. add these union members (rebuild parsed objects with conditional spreads so no optional is assigned `undefined`):

```ts
z.object({ kind: z.literal("set_variable"), variable: variableDraftSchema }),
z.object({ kind: z.literal("set_dimension"), dimension: dimensionDraftSchema }),
z.object({ kind: z.literal("set_item_formula"), itemId: z.string().uuid(), amountFormula: modelFormulaSchema }),
```

  3. extend `flatEffectSchema` and `flatEffectJsonSchema` with nullable `variable`, `dimension`, and `amountFormula`; include every field in `required`, because the agent's strict JSON schema requires unused fields to be `null`;
  4. extend `effectFromFlat`, `describeEffect`, and `parseStoredEffect` for every new kind;
  5. use descriptions `Sets model variable <name>`, `Sets model dimension <name>`, and `Sets a formula on an item`.

- [ ] **Step 3: Generalize pure projection.** Replace `projectDecisionEffectOnDrivers` with:

```ts
export function projectDecisionEffect(input: ForecastRunInput, effect: DecisionEffect, decisionId: string): ForecastRunInput
```

  Preserve the existing driver logic exactly, but return `{ ...input, drivers }`. For model effects use `withVariable`/`withDimension` from `forecast-model-rows.ts`; for `set_item_formula`, map the matching driver to `{ ...driver, amountFormula: effect.amountFormula, decisionId }`. Keep the model property omitted only when neither the input nor the effect has a model. Update preview callers to build both runs from the full projected input:

```ts
const before = buildForecastRun(input);
const projected = projectDecisionEffect(input, effect, decisionId);
const after = buildForecastRun(projected);
```

- [ ] **Step 4: Apply effects once and enqueue atomically.** Use the `decisionEffectApplications` table already created by Task 4; do not edit an applied migration here.

  Keep `applyDecisionEffectWith(db, ...)` as the executor-only mutation implementation. Before the existing item/entity branches:
  - `set_variable`: call `upsertVariableByNameWith(db, companyId, effect.variable, decisionId)` and return the description.
  - `set_dimension`: call `upsertDimensionByNameWith(db, companyId, effect.dimension)` and return the description.
  - `set_item_formula`: call `setItemFormulaWith(db, companyId, effect.itemId, effect.amountFormula, { decisionId })` and return the item id and description.

  Replace row-shape idempotency in `applyDecisionIfEffective` with `applyDecisionIfEffectiveWith(tx, ...)`: lock the company-scoped decision row; if its marker exists, return `{ result: parsedBoundedResult, newlyApplied: false }`; otherwise run `applyDecisionEffectWith`, insert the marker, and return `{ result, newlyApplied: true }`. All existing add/end/change/category effects migrate to this marker path too.

  Add `applyDecisionAndEnqueue(companyId, decisionId, actorUserId, deps?)`. Like `commitModelWrite`, its test-only deps include `database`, `enqueue`, and `process`, all defaulting to production implementations. Its single transaction locks the decision, changes it to `applied` when appropriate, and calls `applyDecisionIfEffectiveWith`. Only when `newlyApplied` is true does it call `enqueueCalculationRefreshWith(tx, companyId, { cause: { kind: "decision_applied", subjectType: "decision", subjectId: decisionId, actorUserId, via: "ui" } })`; a marker hit returns the stored result with `calculationRun: null` and creates no new revision/job. After commit it invokes the injectable/default post-commit processor exactly like `commitModelWrite`. Update the landed decisions route to call only this helper for an applied transition and return its calculation result; remove/bypass any later `refreshCurrentCalculationRun` so one application creates one revision and one forecast outbox job.

  Concretely, remove the route's imports/calls of `applyDecisionIfEffective` and `refreshCurrentCalculationRun`. For `PATCH status: "applied"`, `applyDecisionAndEnqueue` owns the status update, audit, structured effect, legacy `appliesTo` mutation, marker, revision, and enqueue inside its transaction; the route performs none of those writes before calling it. Rejection remains a small company-scoped transaction with its audit and no calculation refresh. For `POST`, add `createAppliedDecisionAndEnqueue`: the decision insert, review resolution, effect/`appliesTo`, marker, `decision_applied` revision, and enqueue occur in one transaction, followed by post-commit processing. If effect validation fails, POST/PATCH returns the existing bounded 502 response and no decision status/effect/revision/outbox partial state remains. Decisions with no effect or `appliesTo` do not enqueue a financial refresh.

- [ ] **Step 5: Write the DB-backed parity test.** Create `forecast-model-decisions.test.ts` following the DB-suite conventions. Seed a model company and, for each new effect:
  1. load one base `ForecastRunInput`;
  2. calculate the preview with `projectDecisionEffect` and `diffForecastRuns`;
  3. insert/apply the decision through the production application path;
  4. reload the stored forecast and compare its consequence to the preview using the same normalized comparison already used by `forecast-preview.test.ts` (ignore generated ids/timestamps only, never financial values, exceptions, model summary, or runway);
  5. assert the saved variable/item has `decisionId`, a second application is idempotent, and a foreign-company item id cannot be changed.

  Also assert every effect kind writes exactly one `decision_effect_applications` marker. Inject a post-commit calculation failure and prove the effect, applied decision status, marker, revision cause, and queued/failed job remain durable. Inject an in-transaction failure after the effect but before marker/enqueue and prove all of them roll back; retry then applies once. Call the applied route/helper twice and assert one marker, one effect mutation, one `decision_applied` revision, and no legacy double refresh. Use a 3-second test timeout and a 2-second `Promise.race` bound for the one-connection path.

  Add this Task 6-local regression to `forecast-model-decisions.test.ts` (do not place it in Task 5's suite):

```ts
it("applies a model decision with a one-connection pool", { timeout: 3_000 }, async () => {
  const single = createTestDatabase(process.env.DATABASE_URL!, { max: 1 });
  const bounded = <T>(work: Promise<T>) => Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("single-connection decision timed out")), 2_000))]);
  try {
    const decisionId = await seedProposedModelDecision(single, seeded.companyId, { kind: "set_dimension", dimension: { name: "region", items: ["US"] } });
    const result = await bounded(applyDecisionAndEnqueue(seeded.companyId, decisionId, null, { database: single, process: noOpCalculationProcessor }));
    expect(result.mutation).toMatchObject({ applied: "Sets model dimension region" });
    expect(await markerCount(single, seeded.companyId, decisionId)).toBe(1);
  } finally { await single.end(); }
});
```

  Use concrete effects: raise Eng headcount with `set_variable`, add/replace a dimension with `set_dimension` without breaking references, and change Payroll's item formula with `set_item_formula`. Include one invalid/cyclic variable and assert the existing decision endpoint's 502/application-failure path exposes the bounded validation message and writes nothing.

- [ ] **Step 6: Teach the agent the exact grammar.** In `app/api/agent/route.ts`:
  - add the three effect kinds and nullable flat fields to the tool schema/context;
  - document that model values use decimal text, formulas are major currency units, names match `[A-Za-z_][A-Za-z0-9_]*`, and formulas support `+ - * /`, selectors (`salary[team=Eng]`), `sum|avg|min|max`, `prev`, and `round`;
  - include this example: dimension `team = [Eng, Sales]`; input variables `headcount[team]` and `salary[team]`; `payroll = headcount * salary`; `tax = payroll * 0.0765`; item formula `sum(payroll) + sum(tax)`;
  - explicitly say never emit JavaScript, function definitions, arbitrary calls, or more than six decimal places;
  - keep the prompt concise and bound all user-visible provider errors as before.

- [ ] **Step 7: Run and commit.**
  - Run: `pnpm --filter @finance/web test decision-driver-effects forecast-model-decisions forecast-preview`
  - Run: `pnpm --filter @finance/web test && pnpm -r typecheck && pnpm --filter @finance/web lint`
  - Expected: tests and typecheck pass; lint remains at the 10-error/13-warning baseline with no new finding.

```bash
git add apps/web/src/lib apps/web/src/app/api/agent
git commit -m "Add model decision effects with preview and application parity

Co-Authored-By: <implementing model> <noreply@anthropic.com>"
```

---

### Task 7: Scenario model changes and promotion

**Files:**
- Modify:
  - `apps/web/src/lib/scenario-changes.ts` and `.test.ts`
  - `apps/web/src/lib/forecast-scenarios.ts`
  - `apps/web/src/lib/scenarios.ts` and `.test.ts`
  - `apps/web/src/lib/decision-driver-effects.ts` callers
  - `apps/web/src/components/scenario-editor-dialog.tsx`
  - `apps/web/src/app/api/agent/route.ts` (the `simulate` flat change schema and prompt)
- Create: `apps/web/src/lib/forecast-scenarios-model.test.ts` (DB)

**Interfaces:**
- `ScenarioChange` gains:
  - `{ kind: "set_input"; variable: string; coords: Record<string, string>; from: string; value: string }`
  - `{ kind: "set_formula"; variable: string; formula: string }`
- `applyScenarioChanges(input: ForecastRunInput, changes: ScenarioChange[], scenarioId: string): ForecastRunInput` replaces the driver-only signature.
- Promotion converts each model change into a `set_variable` decision carrying the complete merged variable, not a partial patch.

**Rulings:**
- Scenario changes are ordered input-level transformations. Later changes win for the same variable/coordinate/month, and a later `set_formula` converts that variable to formula mode (`inputs: []`). A later `set_input` converts it to input mode (`formula` omitted) and upserts the exact `coords + from` entry.
- A missing variable, invalid coordinate, invalid month/value, or invalid resulting model makes scenario creation/update fail with `ScenarioInvalid`; stored legacy lists continue to be read leniently as today.
- Promotion snapshots each touched variable from the final validated projection. This prevents an applied proposal from depending on later edits to the scenario or base model.
- Apply the entire ordered list first and validate the final model exactly once. Intermediate states may be temporarily invalid (for example, a formula change followed by the variable it references); rejecting after each change would make valid ordered batches impossible. Structural errors that prevent applying a change at all (unknown variable, malformed coordinates/month/value) still fail at that change with its index.
- Promotion follows the same rule: project the full ordered list and validate its final model once. It then coalesces all changes to each variable into one final `set_variable` candidate and finds a deterministic valid application order as specified in Step 5. Never insert partial proposals from an invalid final scenario or from a final model that cannot be serialized into independently applicable decisions.
- Promotion does **not** deactivate or delete the scenario. It remains active and editable; the audit records the proposal ids, and the existing UI's repeated-promotion warning remains the guard against accidental duplicates.

- [ ] **Step 1: Add failing pure tests.** Extend `scenario-changes.test.ts` to cover parsing, stored-list leniency, descriptions, ordered overwrite semantics, formula/input mode switching, immutable full-input preservation, invalid/missing variables, and a changed runway through `runSimulation`. Update all old expectations for the new full-input `applyScenarioChanges` signature.

- [ ] **Step 2: Extend parsing and descriptions.** Add both variants to `scenarioChangeSchema`; reuse `modelNameSchema`, `modelMonthSchema`, `variableInputSchema`, and `modelFormulaSchema`. Rebuild parsed values without `undefined`. Describe them as `Sets <variable> input from <month>` and `Sets <variable> formula`.

- [ ] **Step 3: Apply changes to the full input.** Refactor `applyScenarioChanges` to reduce over `ForecastRunInput`:
  - existing driver changes call `projectDecisionEffect(current, scenarioChangeToEffect(change), syntheticId)` and retain the current scenario id/decision-lineage relabeling behavior;
  - `set_input` finds the named variable, removes an existing input with identical sorted coordinates and `from`, appends the new entry, clears `formula`, then replaces the variable through `withVariable`;
  - `set_formula` replaces the variable with `{ ...variable, formula, inputs: [] }`;
  - after the reducer has applied the complete ordered list, call `validateModel` once for the forecast window and return/throw a typed validation result that callers translate to `ScenarioInvalid`. Do not validate intermediate model states.

  Change `runSimulation` to append saved scenario drivers to `base.drivers`, call `applyScenarioChanges` once, then run `buildForecastRun(base)` and `buildForecastRun(changedInput)`. Never reuse a resolved `amountByMonth` from the base; formula resolution must run independently after the model transform.

- [ ] **Step 4: Validate scenario writes against the company's current input.** Add `loadForecastBaseWith(db: DbExecutor, companyId, now)` in `forecast-base.ts`. Every internal loader it calls (`loadForecastInputs`, latest stored run, drivers/templates/accounts/model, and as-of helpers) must accept and use that same executor. Keep `loadForecastBase(companyId, now)` only as a top-level wrapper delegating with `getDatabase()`.

  In `createScenarioWith` and `updateScenario`, call `loadForecastBaseWith(tx, companyId, now)` inside the existing transaction, apply the complete ordered list, validate its final model once, and only then write. Likewise add executor-aware `loadActiveScenarioWith`, `loadScenarioDriversWith`, `resolveSourcesWith`, and `loadScenarioForecastWith` so transaction-bound and one-connection scenario paths never escape to `getDatabase()`. The public `loadScenarioForecast` delegates to `loadScenarioForecastWith(getDatabase(), ...)`; any version called from promotion or mutation receives the current executor.

- [ ] **Step 5: Promote model changes with a concrete two-pass algorithm.** In `promoteScenario`:
  1. **Projection pass:** starting from `loadForecastBaseWith(tx, ...)`, apply every scenario change in stored order without validating intermediate models. Record the first scenario index that touches each model variable. Validate the final projected model once; abort before inserting decisions if it is invalid.
  2. **Coalescing pass:** create exactly one candidate per touched variable from that variable's final projected value: `{ kind: "set_variable", variable: { name, kind, dims, formula: variable.formula ?? null, inputs: variable.inputs } }`. Later changes to the same variable never create another proposal.
  3. **Serialization pass:** set `promotionModel` to the base model and `pending` to the coalesced candidates. Repeatedly consider pending candidates by `(firstTouchIndex, variable.name)` and choose the first whose replacement makes `promotionModel` pass whole-model validation. Emit it, update `promotionModel`, and remove it. If no candidate is currently valid while pending remains, throw `ScenarioInvalid("This scenario is valid as a whole but its model changes cannot be promoted as separate decisions")`; insert no proposals or audit rows. This permits deterministic reordering when the scenario's transient intermediate state was invalid.
  4. Emit the serialized model proposals first, then existing driver proposals in their original relative order. This ensures formula-driven item changes see their required final model when users apply proposals in displayed order. Keep all decision inserts and the promotion audit in the existing transaction; do not deactivate or mutate the active scenario.
  5. Include model changes in `decisionIds`, descriptions, audits, and repeated-promotion behavior.

  Extend `effectToScenarioChange` so a `set_variable` with a formula becomes `set_formula`; an input variable cannot be represented as one `set_input`, so return `null` unless it contains exactly one input. This keeps “Try as scenario” honest rather than silently dropping data.

- [ ] **Step 6: Extend the scenario editor and agent simulation.** Add `set_input` and `set_formula` choices to `scenario-editor-dialog.tsx`. The input editor collects variable, coordinate keys/values, effective month, and decimal value; the formula editor collects variable and formula. Populate variable/dimension choices from `GET /api/forecast/model`, show the same dry-run errors used by the Model panel, and keep old scenario editing unchanged. Extend the agent's `simulate` flat schema and prompt with nullable `variable`, `coords`, `from`, `value`, and `formula` fields.

- [ ] **Step 7: Add the DB-backed scenario test.** In `forecast-scenarios-model.test.ts`, seed the Task 5 company and prove:
  - raising `headcount` for Eng through `set_input` changes payroll, tax, cash, and runway;
  - `set_formula` changes the same forecast through the deterministic engine;
  - preview and the promoted/applied `set_variable` decision produce equal consequences;
  - invalid coordinates, unknown variables, foreign-company ids/data, and cycles write nothing;
  - a scenario base reload includes the latest model and no stale `amountByMonth`.
  - transient-invalid/final-valid promotion is deterministic: begin with `x = y` and input `y`; scenario changes set `y = x` (temporarily cyclic) then turn `x` into an input. The final model is valid. Promotion emits final `x` first and final `y` second, applying both succeeds, and only one proposal exists per variable. Also construct a final-valid candidate set with no independently valid serialization if the grammar permits one; otherwise document why the dependency graph guarantees progress and unit-test the no-progress guard with a synthetic validator result.

  Add the scenario-specific one-connection regression here, after `validateScenarioChangesWith` and `createScenarioWith` exist—not in Task 5:

```ts
it("validates and saves model scenario changes with a one-connection pool", { timeout: 3_000 }, async () => {
  const single = createTestDatabase(process.env.DATABASE_URL!, { max: 1 });
  const bounded = <T>(work: Promise<T>) => Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("single-connection scenario timed out")), 2_000))]);
  try {
    const scenario = await bounded(single.transaction(async (tx) => createScenarioWith(tx, seeded.companyId, {
      name: "One connection model scenario",
      changes: [{ kind: "set_input", variable: "headcount", coords: { team: "Eng" }, from: seeded.firstMonth, value: "5" }],
    }, null)));
    expect(scenario.changes).toHaveLength(1);
    expect((await loadScenarioForecastWith(single, seeded.companyId, scenario.id)).runway.runwayMonths).not.toBe(20);
  } finally { await single.end(); }
});
```

- [ ] **Step 8: Run and commit.**
  - Run: `pnpm --filter @finance/web test scenario-changes scenarios forecast-scenarios-model forecast-scenarios.simulate`
  - Run: `pnpm --filter @finance/web test && pnpm -r typecheck && pnpm --filter @finance/web lint`
  - Expected: tests and typecheck pass; lint has no additions to the baseline.

```bash
git add apps/web/src/lib apps/web/src/components/scenario-editor-dialog.tsx apps/web/src/app/api/agent
git commit -m "Apply model inputs and formulas in scenarios and promotion

Co-Authored-By: <implementing model> <noreply@anthropic.com>"
```

---

### Task 8: Model panel, item Formula fields, and final integration

**Files:**
- Create:
  - `apps/web/src/components/item-formula-field.tsx`
  - `apps/web/src/components/forecast-model-panel.tsx`
- Modify:
  - `apps/web/src/components/accounting-modal.tsx`
  - `apps/web/src/components/app-shell.tsx`
  - `apps/web/src/components/forecast-consequence-line.tsx`
  - the driver-formulas spec only if implementation reveals an approved behavior difference

**Interfaces:**
- `useModelDryRun(draft, delayMs?)` debounces `POST /api/forecast/model/validate`, cancels stale requests, and exposes `{ result, loading, error }`.
- `ItemFormulaField` edits/validates a formula and reports a normalized `string | null` to its parent.
- `ForecastModelPanel` provides dimension and variable CRUD plus dry-run samples.
- Refresh contract: `ForecastModelPanel({ onCommitted })` calls `onCommitted(calculationRun)` after each successful response; `AccountingModal` accepts and forwards `onForecastChanged`; `AppShell` supplies one callback that installs/refetches the returned latest forecast, recent consequences, items/model data, and scenario comparison without closing the modal.

- [ ] **Step 1: Build the shared dry-run hook and Formula field.** Create `item-formula-field.tsx` with:
  - an `AbortController` and 300 ms debounce; abort on value change/unmount and ignore out-of-order responses;
  - no request for an unchanged/empty formula; empty normalizes to `null`;
  - accessible label/help/error associations, loading text, positioned errors, warnings, and the three-month item sample;
  - props that allow saved item edits and unsaved draft-row edits to share the component without the component writing by itself.

- [ ] **Step 2: Build Dimensions in the Model panel.** Create `forecast-model-panel.tsx`, load `GET /api/forecast/model` when opened, and implement add/edit/delete through the Task 5 routes. The dimension editor has a name and an ordered item list (add/remove rows, no comma-packed implicit parsing). Display 400/404/409/422 responses inline, disable duplicate submissions, preserve the user's draft on failure, and refresh model/runway data after success.

- [ ] **Step 3: Build Variables and validation.** The variables table shows name, kind, dimensions, and either formula text or `<n> inputs`. Its editor supports:
  - name, money/number kind, and multi-select dimensions;
  - mutually exclusive formula and input modes;
  - a formula textarea using `useModelDryRun`, with errors, warnings, and three-month samples;
  - an inputs grid with one row per `{ coords, from, value }`, a selector for every chosen dimension, add/remove controls, decimal input, and month input;
  - POST for new variables and PATCH/DELETE for existing variables, retaining the draft and surfaced whole-model validation errors on failure.

  Do not generate the full Cartesian product automatically; users add effective rows, and missing coordinates remain the engine's documented zero-with-warning behavior.

- [ ] **Step 4: Add the Model tab and wire refresh explicitly.** Use these component contracts:

```ts
type ModelCommitResult = { financialStateRevision: string; status: "completed" | "failed" | "not_queued"; forecastJobId: string | null; forecastStatus: string };
type ForecastModelPanelProps = { onCommitted: (result: ModelCommitResult) => void | Promise<void> };
type AccountingModalProps = { open: boolean; onOpenChange: (open: boolean) => void; initialPeriod: string; onForecastChanged: (result: ModelCommitResult) => void | Promise<void> };
```

  In `accounting-modal.tsx`, add a `Model` tab beside the existing tabs and render `<ForecastModelPanel onCommitted={onForecastChanged} />`. Preserve the current default tab and keyboard/focus behavior. In `AppShell`, pass `onForecastChanged={handleForecastChanged}`; that callback updates the visible revision/status from the returned calculation result and invokes the existing fetch paths for runway/latest forecast, recent consequences, item rows, model data, and—when selected—the scenario comparison. It awaits those refreshes, does not close the modal, and surfaces a durable outbox failure as a notice while retaining the committed edit. Do not use a vague local “refresh” event or reload the page.

- [ ] **Step 5: Add item Formula editing in both surfaces.** In `app-shell.tsx`:
  - add `amountFormula` to the saved-item edit state and draft item row type without assigning `undefined`;
  - render `ItemFormulaField` in the dashboard item editor and every draft row;
  - saved edits send `PATCH /api/items` for one id with `{ amountFormula }`;
  - draft confirmation/preview sends `confirm_item.edits.amountFormula` and preserves it through final confirmation;
  - show a concise “formula overrides amount” explanation while retaining amount as the display fallback.

  In `forecast-consequence-line.tsx`, include `amountFormula` in the edits passed to preview and visibly label a formula-driven change rather than presenting the fallback amount as the projected result.

- [ ] **Step 6: Exercise UI state and accessibility.** Add component tests if the existing UI harness supports these components; otherwise cover the pure draft/normalization helpers and rely on typecheck plus the required browser walkthrough. At minimum prove stale dry-run responses cannot replace newer ones, blank formulas become `null`, server errors retain drafts, every field has a label, and destructive buttons name the dimension/variable they affect.

- [ ] **Step 7: Run the complete verification gate.**
  - Run: `pnpm --filter @balsa/finance-engine test`
  - Run: `pnpm --filter @finance/web test`
  - Run: `pnpm -r typecheck`
  - Run: `pnpm --filter @finance/web lint` and compare to the documented 10 errors/13 warnings; add none.
  - Run: `pnpm run verify`.
  - Because this changes forecasting and calculations, also run `pnpm acceptance`.
  - Because it changes company-scoped model routes and writes, start the app and run `pnpm isolation`.
  - If a check cannot run, record the exact command and environmental reason; do not mark it passed.

- [ ] **Step 8: Browser walkthrough and spec reconciliation.** With `pnpm dev`, use synthetic data to:
  1. create `team = Eng, Sales`;
  2. create headcount/salary inputs, payroll/tax formulas, and set an item's Formula to `sum(payroll) + sum(tax)`;
  3. confirm samples, forecast cash, runway, and consequence update;
  4. create a scenario that changes Eng headcount, compare it with base, then promote it;
  5. create and preview an agent model proposal;
  6. verify invalid formulas, cycles, deletion of referenced names, and cross-company access fail cleanly;
  7. check narrow and desktop layouts plus keyboard labels/focus.

  Compare observed behavior to `docs/superpowers/specs/2026-09-18-driver-formulas-design.md`. If an intentional approved implementation ruling differs, update the spec in the same commit; never rewrite the spec merely to conceal a defect.

- [ ] **Step 9: Commit.**

```bash
git add apps/web/src/components docs/superpowers/specs/2026-09-18-driver-formulas-design.md
git commit -m "Add the forecast Model panel and formula editing surfaces

Co-Authored-By: <implementing model> <noreply@anthropic.com>"
```

---

## Plan self-review

Perform this review after Task 8 and before the final branch review. Fix gaps in code/tests or amend this plan/spec before claiming completion.

- [ ] **F1 — Engine grammar, evaluator, and cubes:** parser positions, decimal rounding modes, broadcasting, selectors, reducers, `prev`, errors-as-null, cycles, naming, nesting/formula/model/cell caps, canonical order, and no JavaScript evaluation are implemented and tested.
- [ ] **F2 — Formula drivers:** major-to-minor conversion occurs once, residual dimensions and invalid/negative monthly values become bounded driver exceptions, cadence and idempotency use the month's amount, model summaries retain lineage, consequences compare formula/monthly changes, and fixed-driver runs remain byte-identical.
- [ ] **F3 — Storage/loading:** migration number is confirmed as `0075_forecast_model` (or deliberately updated to the actual next free number), RLS/company scope and active-name uniqueness exist, all loaders and model-store writes have shared executor-aware implementations inside transactions, the single-connection test passes, model rows are canonical, formula fields reach every run/preview/pin path, and every model mutation commits atomically with its revision cause and outbox enqueue before post-commit processing.
- [ ] **F4 — API:** all CRUD/dry-run/item endpoints use shared schemas and whole-model validation; malformed, missing/foreign, duplicate, and invalid requests return 400/404/409/422 consistently; dry run writes nothing and samples exactly three forecast months.
- [ ] **F5 — Agent decisions:** all three effects round-trip through flat schemas, strict JSON schema, storage, description, preview, application, idempotency, audit/decision lineage, and the parity DB test; the prompt documents only the supported grammar and bounds errors.
- [ ] **F6 — Model panel:** dimensions, variables, validation samples, input rows, formula mode, item Formula fields, loading/failure states, refresh behavior, accessibility, and responsive layout are exercised in the browser.
- [ ] **F7 — Scenarios:** `set_input` and `set_formula` transform the full ordered list and validate the final model once, independently resolve formula drivers, affect runway, promote/coalesce to complete valid `set_variable` decisions, leave the scenario active, and preserve company isolation and preview/application parity through executor-aware loaders.
- [ ] **Placeholder scan:** run `rg -n 'TODO|FIXME|TBD|INCOMPLETE|placeholder|not implemented|throw new Error\("TODO' packages/finance-engine apps/web packages/database docs/superpowers`. Every hit is resolved or explicitly documented as unrelated pre-existing work. Also run `rg -n 'internal/(specs|plans)|projectDecisionEffectOnDrivers' docs/superpowers apps/web` and update stale copied paths/final compatibility wrappers.
- [ ] **Type consistency:** run `pnpm -r typecheck`; inspect all `ForecastRunInput`, `DecisionEffect`, `FlatEffect`, `ScenarioChange`, `ModelDraft`, route payload, and component draft construction for `exactOptionalPropertyTypes`; use conditional spreads, never explicit `undefined`; confirm money is string/bigint minor units outside the model and decimal strings at scale 10^6 inside it.
- [ ] **Security and determinism:** run `rg -n '\beval\b|new Function|dynamic import' packages/finance-engine/src/forecast-model.ts apps/web/src/lib/forecast-model*`; confirm no formula text reaches executable JavaScript, no raw provider/database error or sensitive source content reaches users, and all reads/writes are company-scoped and auditable.
- [ ] **Final gates:** `pnpm run verify`, `pnpm acceptance`, and `pnpm isolation` pass (with the app running where required); lint has no findings beyond the recorded 10 errors/13 warnings; the synthetic browser walkthrough is complete; `git status --short` contains only intended work; no secrets or real company data appear in tests, fixtures, diffs, or commits.
