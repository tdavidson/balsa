# Driver formulas with dimensions: design

Date: 2026-09-18
Status: approved by delegation. The user chose a CFO panel plus agent
proposals, **arbitrary dimensions**, and autonomous execution. Decisions
are marked **Ruling**.
Builds on: forecast consequences, performance and concurrency (Group B),
scenarios (C2).

## Idea

Today every forecast driver is a fixed amount on a cadence. This change adds
a small model: named **dimensions**, and **variables** that hold either
dated inputs or a formula over other variables. A driver can then take its
monthly amount from a formula, so a change carries through:
headcount → payroll → payroll tax → cash. That in turn moves runway and
shows up in consequences and previews.

This is Reambase's lesson, rebuilt inside Balsa's own deterministic
engine. Formulas are parsed by our own grammar and are never evaluated as
JavaScript.

## Current state (constraints)

- `ForecastDriver.amountMinor` is one scalar for every month.
- `buildProjectedEntries` checks that the amount matches `/^\d+$/` and puts
  it into the idempotency version.
- There is no expression parser anywhere, and the repo's stated principle
  is never to evaluate untrusted formulas.
- An `assumptions` table exists but nothing in the forecast reads it.
  **Ruling:** leave it alone. Variables replace it for forecasting. Folding
  assumptions into variables is a later cleanup.
- Template and chart edits don't bump the revision. Model edits must bump
  it, because they change the base forecast.

## Design

### F1. Engine: grammar, evaluator, cubes (pure, `packages/finance-engine/src/forecast-model.ts`)

**Values.** Every value is a decimal held as a `bigint` at scale 10^6.
- Parsing accepts up to 6 fractional digits.
- `*` rescales, and `/` rounds half-even to 6 digits.
- Division by zero yields the error value (see "Errors" below).

**Cube.** A variable's value over its dimensions plus month. The shape is
`{ dims: string[] (sorted, month implicit), cells: Map<coordKey, Map<month, bigint>> }`.

**Grammar** (recursive descent, fully specified in the plan):
```
expr    := term (("+"|"-") term)*
term    := factor (("*"|"/") factor)*
factor  := number | ref | call | "(" expr ")" | "-" factor
ref     := name ("[" selector ("," selector)* "]")?
selector:= dim "=" item            // filter a dimension to one item (the dimension is removed)
call    := ("sum"|"avg"|"min"|"max") "(" expr ("," dim)* ")"   // reduce the named dims, or all dims when none are given
         | "prev" "(" expr ")"     // the previous month's value; before the first month, the as-of month's value
         | "round" "(" expr "," int ")"
name, dim, item := [A-Za-z_][A-Za-z0-9_]*
```

**Broadcasting.**
- A binary operation's result dims are the sorted union of its operands'
  dims.
- An operand that lacks a dimension is repeated across that dimension's
  items.
- Month always aligns.

**Inputs.**
- An input variable's cells are step functions. Each entry is
  `{ coords: Record<dim, item>, from: "YYYY-MM", value: "decimal" }` and
  applies from `from` until the next entry for the same coordinates.
- A cell with no entry is 0.
- **Ruling:** 0, not an error. That lets a CFO fill cells gradually.
  Validation lists empty coordinates as warnings.

**Evaluation.**
- `evaluateModel(model, months)` topologically sorts the variables by
  reference.
- A cycle, an unknown name, an unknown dimension or item, or a bad arity
  is a validation error. These are reported with positions by
  `validateModel(model)`, which is the dry run.
- The evaluation window is `[asOf, horizon end]`. As-of is included so
  `prev` has a base.

**Errors.**
- Evaluation never throws on data. A cell that divides by zero or
  overflows the cap is marked as an error.
- A driver that consumes an errored cell becomes a driver exception with a
  reason, the same way as today's exceptions.

**Limits.**
- Formulas are at most 2,000 characters.
- A model has at most 200 variables and at most 12 dimensions, each with at
  most 500 items.
- Each variable's cell count (the product of its dimension sizes × months)
  is capped at 250,000. Exceeding it is a validation error.
- **Ruling:** these caps keep "arbitrary dimensions" safe in a
  synchronous request.

### F2. Drivers from formulas

- `ForecastDriver` gains an optional `amountByMonth?: Record<string, string>`
  (minor units).
- In `buildProjectedEntries`, when `amountByMonth` is present:
  - Each emitted month uses `amountByMonth[month]`. A missing month, or a
    zero, skips that month.
  - A negative value, a non-integer, or an errored cell makes the driver an
    exception: "Formula amount for <month> is negative/invalid".
  - The idempotency version includes that month's amount.
- The cadence still selects which months emit, so a quarterly formula
  driver pays the formula value in each quarter's month.
- `resolveFormulaDrivers(drivers, model, months)` (pure) evaluates each
  driver's `amountFormula`. The result must reduce to a cube with no
  dimensions beyond month, or it is an exception telling the user to "use
  sum(...) to collapse <dims>".
- Money conversion: a variable value is in major currency units. It is
  converted to minor units by multiplying by 100 and rounding half away
  from zero.
- **Ruling:** formula money is written in major units, as CFOs think, and
  rounded once, at the driver.
- `buildForecastRun` input gains an optional `model`, and formula drivers
  are resolved inside it before projection. The run output gains
  `modelSummary`, the variables used by drivers with their monthly totals,
  for tracing.
- **Ruling:** `forecastFormulaVersion` stays `.2`. A run with no formula
  drivers and no model is byte-identical to today, and the equivalence
  test is extended to prove it.

### F3. Storage and loading

- Migration 0075 (or the next free number) adds these tables, all with RLS
  like 0072:
  - `forecast_dimensions`: id, companyId, name (unique per company among
    active), `items jsonb` (an array of strings), active, timestamps.
  - `forecast_variables`: id, companyId, name (unique per company among
    active), `kind` ("money" | "number"), `dims jsonb` (an array of
    dimension names), `formula text null`, `inputs jsonb NOT NULL DEFAULT '[]'`,
    `decisionId null`, active, timestamps. A variable has either a formula
    or inputs, not both.
- `economic_items` gains `amount_formula text null`. When it is set, the
  item's `amount` is the display fallback only.
- `loadForecastInputs` and the preview and scenario base load the model
  (company-scoped, active) and include it in `ForecastRunInput.model`. It
  is sorted by name for the canonical hash.
- `economicItemToDriver` carries `amountFormula`.
- New revision cause kinds, `model_changed` and `item_formula_changed`, are
  added to `RevisionCauseKind`. Every model write bumps the revision.
  `describeCause` labels them "Changed the model: payroll" and "Set a
  formula on Payroll".

### F4. API

- `GET /api/forecast/model` returns the dimensions and variables.
- Dimensions: `POST /api/forecast/model/dimensions` and
  `PATCH|DELETE /api/forecast/model/dimensions/[id]`.
- Variables: `POST /api/forecast/model/variables` and
  `PATCH|DELETE /api/forecast/model/variables/[id]`.
- Every write validates the whole resulting model with `validateModel`
  before saving, returns 422 with the errors if it fails, and then calls
  `refreshCurrentCalculationRun` with `model_changed`.
- `POST /api/forecast/model/validate` takes `{ model draft }` and returns
  `{ errors, warnings, sample }`, where `sample` holds the first 3 forecast
  months' values for each changed variable. This is the dry run. It writes
  nothing.
- `PATCH /api/items` accepts `amountFormula` (a string or null). It is
  validated against the model and records the cause
  `item_formula_changed`.
- The preview gains edits support for `amountFormula` on `confirm_item`.

### F5. Agent proposals

- New decision effects in `decisionEffectSchema` and `flatEffectSchema`:
  - `set_variable`
    `{ name, kind, dims, formula?, inputs? }`
    creates or replaces a variable by name.
  - `set_dimension` `{ name, items }`.
  - `set_item_formula` `{ itemId, amountFormula }`.
- They apply through `PATCH /api/decisions`, with the same validation as
  the API. A failure returns the existing 502 path with the validation
  message.
- `projectDecisionEffectOnDrivers` is generalized to
  `projectDecisionEffect(input, effect)`, which returns a new
  `ForecastRunInput` with the model or drivers changed. That way `apply_decision`
  previews cover model changes. The existing uses are migrated.
- The agent system prompt documents the grammar briefly, with the
  headcount → payroll example.

### F6. Model panel (accounting modal tab "Model")

- **Dimensions:** a list, plus editing a name and items.
- **Variables:** a table showing name, kind, dims, and either the formula
  or an input count.
  - The editor has a formula textarea with live validation. It calls
    `/validate`, debounced, and shows errors, warnings, and sample values.
  - An inputs grid holds one row per dimension coordinate × effective
    month. Rows can be added and removed.
- Economic items in the dashboard's item editor and the draft rows get a
  "Formula" field, with the same validation.

### F7. Scenarios integration (extends C2)

- `ScenarioChange` gains two kinds:
  - `set_input` `{ variable, coords, from, value }`, which adds or
    overrides an input entry
  - `set_formula` `{ variable, formula }`
- `applyScenarioChanges` becomes an input-level transform, applied to
  `ForecastRunInput`: model plus drivers.
- Promotion maps each kind to a `set_variable` decision that carries the
  merged inputs, or the formula.

## Testing

- **Engine, pure:**
  - Parser: precedence, unary minus, selectors, and each function, plus
    error positions.
  - Broadcasting across 3 dimensions.
  - `sum` over some or all dimensions, `prev` at the first month, and
    `round`.
  - Division by zero producing an error cell.
  - Cycle detection.
  - Limits.
  - Step-function inputs.
  - Half-even division, and half-away-from-zero conversion to minor units.
  - `resolveFormulaDrivers`: dims left over produce an exception, and a
    negative month produces an exception.
  - Equivalence: with no model, output is identical to the reference
    (extend `forecast-equivalence.test.ts`).
  - A worked end-to-end test: headcount[team] × salary[team] → payroll,
    payroll × 0.0765 → tax, and a driver `sum(payroll) + sum(tax)` gives
    the expected cash, runway, and consequence when headcount[team=Eng]
    increases from a month.
- **Web, DB-backed:**
  - Model CRUD bumps the revision and records a consequence.
  - Validation returns 422.
  - A `set_variable` decision preview matches the recorded consequence
    (parity).
  - A scenario `set_input` changes runway.
  - Company scoping.
- **UI:** typecheck and lint.
