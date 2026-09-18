# Forecast scenarios: design

Date: 2026-09-18
Status: approved by delegation. The user chose the dashboard switcher and
autonomous execution. Decisions are marked **Ruling**.
Builds on: forecast consequences (slice 1), performance/concurrency (Group
B), and traceability (C1).

## Idea

A scenario is a named set of hypothetical changes to the forecast's drivers.
Its result is a forecast run computed on demand by the same `buildForecastRun`
and compared to the base run with `diffForecastRuns`. That is the preview
machinery run on a saved set of changes. It replaces the disabled scenario
simulation without adding a second engine.

## Current state (constraints)

- The `scenarios` table has id, companyId, name (not unique), `assumptionIds`
  (unused by the forecast), and active.
- `economic_items.scenarioId` exists. The decision `add_item` with a
  `scenario` name finds or creates the scenario by name and inserts a
  confirmed, assumed item tagged to it. `loadForecastDrivers({ scenarioId })`
  returns scenario items only.
- The stored forecast run and runway are base-only. The ledger "scenario
  view" shows only posted `scenario`-basis journals, and nothing posts them
  today.
- The agent `simulate` tool is a stub that returns an error. The system
  prompt still mentions it.
- The dashboard has single `forecast` and `runway` states written by
  `applyJournalDashboard`. The chart plots net cash-flow bars.

## Design

### S1. Scenario changes (pure, `apps/web/src/lib/scenario-changes.ts`)

```ts
type ScenarioChange =
  | { kind: "add_driver"; label: string; direction: "receipt" | "spend"; amount: number; cadence: "once"|"monthly"|"quarterly"|"annual"; effectiveFrom: string; effectiveTo?: string; category?: string }
  | { kind: "change_amount"; itemId: string; amount: number; effectiveFrom: string }
  | { kind: "end_item"; itemId: string; effectiveTo: string };
applyScenarioChanges(drivers: ForecastDriver[], changes: ScenarioChange[], scenarioId: string): ForecastDriver[]
```

- The semantics match `projectDecisionEffectOnDrivers`. Reuse it by mapping
  each change to the matching `DecisionEffect`, so there is one
  implementation. Added drivers get ids of the form
  `scenario:<scenarioId>:<index>`.
- **Ruling:** three change kinds in v1, mirroring the decision effects so
  that promotion is lossless. "Remove" is `end_item` at the forecast as-of.
  Variable changes arrive with C3.

### S2. Storage

- Migration: `scenarios` gains `description text` and
  `changes jsonb NOT NULL DEFAULT '[]'`. It keeps `name` and `active`.
- **Ruling:** existing scenario-tagged confirmed items are part of their
  scenario. A scenario run uses base drivers, plus that scenario's confirmed
  items, plus `changes`. The decision and `state/mutate` scenario paths
  therefore keep working.

### S3. Scenario run (server, `apps/web/src/lib/forecast-scenarios.ts`)

- `loadScenarioForecast(companyId, scenarioId, now?)`:
  1. Build the base input with the same stored-input-or-full-load logic as
     the preview. Factor that logic out of `forecast-preview.ts` as
     `loadForecastBase(companyId, now)` so both use one path.
  2. Load the scenario (company-scoped), then take base drivers, append the
     scenario's items, and apply its changes.
  3. Build the scenario run and the base run, diff them, and resolve
     sources as in C1.
  4. Return:
     `{ scenario, months: ForecastMonth[] (forecast basis), runway, consequence, exceptions, sources }`.
     Nothing is persisted.
- **Ruling:** scenario runs are not persisted or versioned. They are cheap
  now (O(P)) and always reflect current base state. Consequences over time
  stay a base-forecast concept.

### S4. API

- `GET /api/scenarios` lists active scenarios with id, name, description,
  changeCount, and itemCount.
- `POST /api/scenarios` takes `{ name, description?, changes? }`. Names are
  unique among active scenarios per company; a duplicate gets 409.
- `PATCH /api/scenarios/[id]` takes `{ name?, description?, changes? }`, and
  `changes` replaces the whole list. `DELETE` soft-deactivates.
- `GET /api/scenarios/[id]/forecast` returns the output of
  `loadScenarioForecast`.
- `POST /api/scenarios/[id]/promote` creates one proposed decision per change
  (add_driver → add_item, change_amount, end_item) and one per scenario
  item (add_item with the item's fields and no scenario). Each carries a
  question such as "Apply from scenario <name>: <describeEffect>". It
  returns the decision ids. Nothing applies automatically, which respects
  the trust model.
- `POST /api/scenarios/from-decision` takes `{ decisionId }` and creates a
  scenario named after the proposed decision, with its effect mapped to a
  change. This powers a "Try as scenario" button.
- Every write is company-scoped and validated with zod. Scenario edits do
  not bump the financial-state revision, because they don't change base
  state.

### S5. Dashboard switcher

- There is a scenario select next to the period controls: "Base forecast"
  plus the active scenarios.
- With a scenario selected:
  - app-shell fetches `/api/scenarios/[id]/forecast` into separate
    `scenarioForecast` state. `applyJournalDashboard` is not touched.
  - The Runway figure shows the scenario runway, with the note "vs base 14
    mo".
  - A "Scenario vs base" line renders `describeConsequence`, plus source
    links (C1).
  - The chart draws scenario net bars as outlined bars offset beside the
    base forecast bars, for forecast months only, with a shared scale and a
    third legend entry.
- Actions:
  - **Edit** opens a scenario editor dialog. It lists changes, adds a
    change through a small form (add_driver fields, or pick an existing
    confirmed item for change_amount or end_item), and removes changes.
    Saving sends a PATCH.
  - **Promote to proposals** shows the created decisions in the proposed
    list.
  - **New scenario**.
- Each proposed decision row gets a "Try as scenario" button.
- **Ruling:** the switcher does not change the Cash, Cash in, Cash out, and
  Net figures. They stay base, so the dashboard never presents a
  hypothetical as the books. Only Runway, the overlay bars, and the
  "vs base" line reflect the scenario.

### S6. Agent

- Re-enable `simulate`. Input:
  `{ changes: ScenarioChange[] }` (flat JSON schema) or
  `{ scenarioId }`.
- Output: `{ runway, consequence: describeConsequence(...), exceptions }`,
  computed through `loadForecastBase` plus `applyScenarioChanges`.
  Nothing is written.
- Update the system prompt: `simulate` answers what-if questions against
  the current base forecast, and a scenario is a saved set of changes the
  CFO can promote.

## Testing

- **Pure:** `applyScenarioChanges`, for each kind and for ordering. It must
  match `projectDecisionEffectOnDrivers` for the mapped effects (parity
  test).
- **DB-backed:**
  - A scenario with an `add_driver` produces the same consequence as
    previewing the equivalent proposed decision.
  - Scenario-tagged items are included.
  - Company scoping, including another company's scenario id, returns 404.
  - Promote creates proposed decisions that, applied one by one, reach the
    scenario's runway.
  - `from-decision` round-trips.
- **Agent:** a unit test of the `simulate` tool handler with a stubbed base.
  If the route makes this impractical, test a pure `runSimulation` helper
  instead.
- **UI:** typecheck and lint.
