# Forecast consequences — design

Date: 2026-09-18
Status: approved design, awaiting spec review
Slice: 1 of 4. Later slices: 2, scenarios rebuilt on the same machinery. 3,
dimensional driver formulas. 4, event intake and alerts.

## Why

Today every AI finance product automates the bookkeeping side of an event:
coding it, matching it, posting it. Almost none show what the event does to
the forecast, cash, or runway, or trace that change back to its cause. When a
CFO approves something, Nevermodel should show its forward consequence both
**before** approval (a preview) and **after** it (a stored consequence
record). Each consequence is traced to the evidence, item, or decision behind
it.

## Current state (what this changes)

- The future forecast is a set of **posted journals with `forecast`
  basis**. The CFO creates them by hand through "Apply projections"
  (`apps/web/src/app/api/forecast-projections/apply/route.ts`). Nothing
  regenerates them when drivers change.
- Drivers are confirmed `economic_items` (agreement or obligation) matched to
  active `forecast_entry_templates`. The mapping code is duplicated in the
  projection preview route and the apply route.
- `refreshCurrentCalculationRun` bumps `companies.financialStateRevision` and
  queues journal-period outbox jobs that cover actuals only. It records no
  cause or actor. Nothing queues or processes `base` jobs any more.
- No burn or runway calculation exists. Future cash on the dashboard comes
  from posted forecast journals, so it is flat when none have been applied.
- Applying projections bumps the revision once for every entry and every
  reversal.

## Decisions

1. **The forecast is derived.** It is computed deterministically from
   confirmed drivers and templates on every revision, and stored as a
   calculation run. Nothing posts, and nothing needs applying.
2. **Runway is forward-looking, with trailing figures for context.** The
   primary figure is the cash-out month from the derived forecast. The
   context figures are trailing 3-month net burn and cash ÷ trailing burn.
3. **The preview is narrow.** It covers confirming an interpreted
   agreement or obligation, and applying a proposed decision.
4. **"Apply projections" becomes "Pin as plan".** It posts `plan`-basis
   journals, which are frozen for later variance-to-plan work. Live views no
   longer read posted `forecast` or `plan` journals.

## Architecture

### Revision causes

`refreshCurrentCalculationRun(companyId, { journalPeriods?, cause })`, where:

```ts
type RevisionCause = {
  kind:
    | "evidence_published" | "evidence_revoked" | "evidence_reprocessed"
    | "item_confirmed" | "item_rejected" | "item_edited" | "item_created"
    | "decision_applied" | "journal_posted" | "journal_reversed"
    | "period_closed" | "period_reopened" | "fx_changed" | "entity_changed"
    | "allocation_changed" | "mapping_approved" | "plan_pinned" | "settings_changed";
  subjectType: string;       // "evidence" | "economic_item" | "decision" | "journal_entry" | ...
  subjectId: string | null;
  actorUserId: string | null;
  via: "ui" | "agent" | "worker";
};
```

- `cause` is **required**, so leaving it out is a type error. All of the
  callers listed in the current-state mapping are updated.
- New table `financial_state_revisions`: `(company_id, revision)` unique,
  plus `kind`, `subject_type`, `subject_id`, `actor_user_id`, `via` and
  `created_at`. The row is written in the same transaction that bumps the
  revision.
- `refreshCurrentCalculationRun` also queues one `period: "forecast"` outbox
  job for each revision.

### Driver loading (shared)

`loadForecastDrivers(companyId, { scenarioId? })` in
`apps/web/src/lib/forecast-drivers.ts` replaces the mapping code duplicated
in the two projection routes. It returns confirmed items as `ForecastDriver[]`
and active templates as `ForecastEntryTemplate[]`. Each driver carries its
`economicItemId`, `evidenceId` and `factId`, so lineage can reach the evidence.

### Forecast run (pure)

`packages/finance-engine/src/forecast-run.ts`:

```ts
buildForecastRun(input: {
  actualTrialBalance: TrialBalanceLine[]; // actuals through asOf
  drivers: ForecastDriver[];
  templates: ForecastEntryTemplate[];
  asOfMonth: string;          // max(latest closed period, last full calendar month)
  horizonMonths: number;      // 24
  minimumCashMinor: string;   // company setting, default "0"
}): ForecastRun
```

It:

1. Expands drivers into projected entries with `buildProjectedEntries`, over
   the months `asOf+1 … asOf+horizon`. Drivers that do not match a template
   become `exceptions`.
2. Builds monthly statements from the actual lines plus the projected lines.
   It reuses the existing statement code, with projected lines treated as
   `forecast` basis in memory.
3. Emits calculation nodes. Each node has a formula, a formula version,
   input node ids, and driver lineage:
   - `ending_cash[month]`, which uses the same cash-line rule as
     `journal-financial-views.ts`
   - `net_burn[month]`, calculated as −(ending cash − opening cash), with
     positive meaning burn
   - `cash_out_month`, the first projected month where ending cash is below
     `minimumCashMinor`, or `null` if there is none within the horizon
   - `runway_months`, the number of full months funded before
     `cash_out_month`: `max(0, months from asOf to cash_out_month − 1)`, or
     `null` (shown as "> horizon") when there is no cash-out month. A cash-out
     in the month right after asOf is 0 months of runway.
   - `trailing_burn_3m`, the average net burn over the last three actual
     months
   - `cash_over_trailing_burn`, ending actual cash divided by trailing burn,
     or `null` when burn is 0 or negative
4. Returns `{ formulaVersion, asOfMonth, horizon, nodes, projectedEntries,
   exceptions, verificationStatus }`. `verificationStatus` is `"exception"`
   when any driver was excluded.

`buildForecastRun` is deterministic: the same input gives byte-identical
`stableJson` output. `stableJson` moves from `apps/web/src/lib/journal-calculation-graph.ts` into `finance-engine` so both can share it. Minor units stay as `bigint`/string throughout, and
there are no floats except in the `cash_over_trailing_burn` ratio, which is
truncated to one decimal place.

### Consequence diff (pure)

`packages/finance-engine/src/forecast-consequence.ts`:

```ts
diffForecastRuns(previous: ForecastRun | null, next: ForecastRun): ForecastConsequence | null
```

- It returns `null` when no headline figure changed.
- Headline figures:
  - ending cash for each month in the union of both horizons
  - `cash_out_month`
  - `runway_months`
  - total projected receipts and total spend over the horizon
- `rolledForward` is true when the two runs have different as-of months.
  The horizons are then offset, so only months forecast by **both** runs are
  compared: `cash` rows cover only those common months, projected receipts
  and spend are summed over only those months on both sides, and
  `horizonEndCash` uses the latest common month. If the horizons share no
  forecast month, `horizonEndCash` uses the next run's horizon end with a
  null before value and a delta of `"0"`. The roll itself is never reported
  as a cash change.
- Driver changes: drivers that were added, removed, or changed (amount,
  cadence, or effective dates), keyed by `economicItemId`.
- The exceptions count before and after.

### Outbox job

`processCalculationOutboxJob` handles `period: "forecast"`:

1. Supersede the job if the revision has moved on. This is existing
   behaviour.
2. Load the actual trial balance through asOf, the drivers, the templates,
   and the company settings.
3. Run `buildForecastRun`, then persist a `calculation_runs` row
   (`engineVersion = forecastFormulaVersion`, `scenarioId = null`) and its
   `calculation_nodes` in one transaction. A retry that finds the run already
   persisted reuses it and still runs steps 4–5; the unique
   `(company_id, revision)` index makes recording the consequence idempotent.
4. Load the previous **completed** forecast run for the company, and run
   `diffForecastRuns` against it.
5. If there is a previous run and a consequence, insert a `forecast_consequences` row. The first
   forecast run has nothing to compare against and records nothing. Its
   `causes` field holds every `financial_state_revisions` row after the
   previous run's revision, up to and including this one, so causes whose
   jobs were superseded are still attributed.

A failed forecast job stays in the outbox and is retried by the existing
cron job. The dashboard serves the last completed run with `stale: true`.

The as-of month is **max(latest closed period, last full calendar month)**,
compared as `YYYY-MM` strings. Actuals posted after the last close are
therefore never hidden behind an old close. Before any close it is the last
full calendar month.

`stale` is true when the latest run's revision is not the company's current
revision, **or** when the run's as-of month is earlier than the as-of month a
run computed now would use (for example, the calendar has moved into a new
month since the run was derived).

### Table `forecast_consequences`

`id`, `company_id`, `revision`, `previous_run_id` (nullable),
`next_run_id`, `causes` (jsonb array of revision rows), `delta` (jsonb
`ForecastConsequence`), `created_at`. Index on `(company_id, created_at)`.
Access is scoped by company row-level security (RLS), like other company
tables.

### Preview

`POST /api/forecast/preview`

```ts
{ kind: "confirm_item"; itemId: string; edits?: Partial<{ amount; cadence; effectiveFrom; effectiveTo; category }> }
| { kind: "apply_decision"; decisionId: string }
```

- The route loads the current drivers and applies the change in memory. It
  then runs `buildForecastRun` twice, once as-is and once with the change,
  and returns `diffForecastRuns(asIs, withChange)`. Nothing is persisted.
  Computing both sides fresh keeps the preview correct when the stored run is
  stale.
- A pure `projectDecisionEffectOnDrivers(drivers, effect, decisionId)` mirrors
  `applyDecisionEffect` in memory. A database-backed parity test confirms each
  preview's headline figures equal the consequence recorded after the real
  confirmation or apply.
- The route returns 409 if the item is not a draft, or if the decision is not
  `proposed`.

### Pin as plan

- The apply route and panel are renamed "Pin as plan". A pin posts journals
  with `basis: "plan"` (`EntryBasis` gains `"plan"`), using
  `source: "forecast_plan_pin"`. The existing reversal-on-version-change logic
  is kept.
- A pin bumps the revision **once**, with cause `plan_pinned`. The posting
  helper gains a batch mode that defers the refresh until the batch
  completes.
- Existing posted `forecast`-basis journals are treated as plan entries. The
  ledger loader reads both stored `forecast` and `plan` as in-memory `plan`, so
  no data migration is needed. `selectJournalLinesForReporting` is unchanged:
  it never includes `plan` lines, and the in-memory `forecast` basis now comes
  only from the derived run.

### Readers switched to the derived run

- `/api/journal-financials` (dashboard) returns actual months from the ledger
  and future months from the latest completed forecast run. It adds a
  `runway` object with `cashOutMonth`, `runwayMonths`, `trailingBurn3m`,
  `cashOverTrailingBurn` and `stale`.
- The agent's `get_financials` and context use the same source. The context
  also includes the five most recent consequences, each with its causes.
- `/api/ledger/calculations?view=projected` and every other projected or
  scenario reader get the derived run the same way. The shared ledger loaders
  (`journal-ledger.ts`) overlay the latest run's projected lines and anchor
  the view at its as-of month.
- Minimum cash is set in Company settings (`/api/forecast/settings`). A change
  is a revision with cause `settings_changed`.

## UI

- **Interpreted items** ("confirm before they enter…"): each draft row
  lazily calls preview and shows one line, for example "Aug 2028 ending
  cash +$120k · runway 14 mo → beyond horizon · cash-out Mar 2028 → none",
  where the cash figure is at the end of the horizon. If
  drivers were excluded, the line adds "· 2 drivers excluded". If the item
  has no forecast effect, it shows "No forecast effect". When the horizon-end
  cash, runway, and cash-out month are unchanged but a month inside the
  horizon moved, the line names the month with the largest change instead,
  for example "Mar 2027 ending cash −$5k". When the as-of month moved, the
  line starts with "Forecast rolled forward to <Mon YYYY>" followed by any
  other changes.
- **Proposed treatments:** the same line appears next to "If applied:".
- **Dashboard:**
  - The runway figure shows forward runway months and the cash-out month,
    with a secondary line for trailing burn and cash ÷ burn, and a stale
    badge when relevant.
  - A new "What changed" list shows the latest consequences. Each entry has
    a headline delta and its causes, named by the label of the item,
    evidence, or decision.
- **Calculation trace dialog:** works on forecast nodes with no changes.
- **Accounting modal:** the "Forecast entries" tab becomes "Pin as plan".
  The Templates tab is unchanged.

## Out of scope (this slice)

- Per-entity forecasts
- Foreign-currency drivers, beyond the existing base-currency conversion
- Variance-to-plan views
- Rebuilt scenarios (slice 2)
- Driver formulas and dimensions (slice 3)
- Live connectors, notifications and materiality thresholds (slice 4)
- Consequence previews on evidence publication, which only creates drafts

## Testing

**finance-engine** (vitest):
- `buildForecastRun`:
  - driver expansion across cadences and the horizon
  - ending cash
  - net burn sign
  - cash-out with a floor above zero
  - `null` cash-out beyond the horizon
  - trailing burn that is ≤ 0
  - determinism: identical `stableJson` for the same input
  - node lineage to driver ids
  - excluded drivers set `verificationStatus: "exception"`
- `diffForecastRuns`:
  - returns `null` when nothing changed
  - added, removed and changed drivers
  - cash-out moving from `null` to a month and back
  - handles a previous run whose horizon differs
- Stored `forecast` and `plan` bases are read as `plan`. Plan lines never
  reach the actual or projected views.

**web**:
- A type-level check that `refreshCurrentCalculationRun` without `cause`
  fails to compile (`@ts-expect-error`).
- A forecast outbox job persists a run and nodes, and writes a consequence
  whose causes cover superseded revisions.
- Preview parity: the preview delta equals the consequence recorded after
  confirming the same item, and after applying the same decision.
- Pinning bumps the revision exactly once.

**accounting-evals**: a new eval, "confirming a contract extends runway and
the consequence is attributed to its source evidence."
