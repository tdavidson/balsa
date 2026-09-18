# Forecast performance and concurrency: design

Date: 2026-09-18
Status: approved by delegation. The user asked for Group B to be designed,
planned, and built while they were away. Each decision below that would
normally be the user's is marked **Ruling** and is recorded in the SDD ledger.
Builds on: `2026-09-18-forecast-consequences-design.md` (slice 1).

## Problem

Slice 1 works, but it will not scale past a small ledger. There are five
problems.

1. **Compute.** `buildForecastRun` makes H+4 = 28 calls to
   `buildJournalStatements` over every line. Each call makes three
   `buildTrialBalance` calls, and each of those sorts by id with
   `localeCompare`. The total is about 84·L·log L, and the run then reads
   only three numbers per month: ending cash, cash receipts, and cash
   spending.
2. **Preview.** Every pending row sends its own request, and each request
   does a full `loadForecastInputs`, which loads the whole ledger. It then
   runs two full builds. A revision change repeats all of this for every
   row.
3. **Storage and hashing.** `inputJson` holds every loaded line, so storage
   grows at O(L) per revision. The lines come back unordered, so
   `inputHash` is not canonical, and a retry can store a second run for the
   same revision.
4. **Readers.** `/api/journal-financials` calls `loadLatestForecast` once per
   dashboard month, which is about 21 calls and 63 queries. A run that
   lands mid-loop can mix two runs in one response.
5. **Concurrency.** Forecast inputs are read in several autocommit
   statements, with no snapshot and no check after computing. Forecast
   jobs for N and N+1 can overlap. If N+1 persists first, both diff against
   N−1 and an effect is counted twice. A mutation that commits between
   another job's supersede check and its reads is attributed to the wrong
   cause.

## Goals

- Forecast compute becomes O(L log L) once per revision for the actual
  history, and O(P) for projections, where P is the number of projected
  lines. A preview must not load the ledger.
- The output (`months`, `nodes`, `runway`, and therefore every consequence)
  is identical to slice 1 for realistic ledgers. A randomized equivalence
  test against the statement-based reference proves this.
- Persisted input is compact, and hashed canonically.
- One `loadLatestForecast` per request.
- Forecast jobs for a company are serialized, check the revision before
  and after computing, and never persist a run for a revision that has
  already been superseded.

## Non-goals

- Batching previews into a single request. **Ruling:** once a preview costs
  a few small queries and O(P) compute, N small requests are acceptable.
  YAGNI.
- Moving the revision bump into each mutation's own transaction across all
  24 callers. **Ruling:** deferred. The residual race is documented below.
- SQL-side aggregation of actuals.

## Design

### B1. Two-part forecast engine (pure, `packages/finance-engine`)

Split the calculation into an actuals summary and a projection. The
summary depends only on posted actuals. The projection depends only on
drivers, templates, and accounts, plus the summary's closing position.

```ts
// forecast-actuals.ts
type ActualCashMonth = { month: string; openingCashMinor: string; endingCashMinor: string; receiptsMinor: string; spendingMinor: string };
type ActualCashSummary = { currency: string; asOfMonth: string; months: ActualCashMonth[] /* asOf-2..asOf */; cashAccountIds: string[] };
summarizeActualCash(actualLines: PostedJournalLine[], currency: string, asOfMonth: string): ActualCashSummary
```

- **Filter.** Keep lines where `basis ?? "actual"` is actual, adjustment, or
  elimination, `period ≤ asOf`, and `currency === currency`. This is the
  same filter slice 1 uses.
- **Ending cash.** Make one pass over the lines sorted by `id`, rolling the
  balance forward per trial-balance key. It uses the balance-sheet
  predicate exactly as statements.ts and cash.ts do:
  - The section is `accountType === "contra" ? statementSection : accountType`,
    and it must equal `"asset"`.
  - The group key is `statementLine ?? accountCode`. The group label is
    `statementLine ?? accountName`, taken from the first trial-balance row
    in that group, where rows are ordered by `accountCode` and each row's
    metadata comes from its lowest-id line.
  - `\bcash\b` is tested against `"key label"`.
  - Amounts are `whole(debit) − whole(credit)`.

  **Ruling:** the cash flag is resolved per group once, over all included
  lines. It is not resolved per month. The two differ only when a
  same-keyed group gains a differently labelled account partway through
  the history. The equivalence generator excludes that case, and the
  limitation is documented.
- **Receipts and spending.** For each month, group that month's lines by
  `entryId ?? id`. Within each entry, the cash lines are those where
  `/cash/` matches `` `${statementLine ?? ""} ${accountName}`.toLowerCase() ``.
  The movement is `Σ BigInt(debit) − BigInt(credit)`. A movement ≥ 0 adds to
  receipts, and a negative movement adds its magnitude to spending.
  `period_close` entries are included. This matches statements.ts.
- **Output.** Months from asOf−2 to asOf, each with opening and ending cash
  (the opening of asOf−2 is the ending balance at asOf−3), plus
  `cashAccountIds`. `cashAccountIds` lists the accounts that the
  ending-cash predicate marks as cash, and projected lines on those
  accounts move ending cash.

```ts
// forecast-run.ts (new input shape)
type ForecastRunInput = { actuals: ActualCashSummary; drivers; templates; accounts; currency; asOfMonth; horizonMonths; minimumCashMinor };
buildForecastRun(input: ForecastRunInput): ForecastRun   // unchanged output shape
```

- Projected entries and `projectedLines` are built exactly as in slice 1.
- **Projected months.** Ending cash for each projected month is the
  previous ending cash plus the sum of `whole(debit) − whole(credit)` over
  projected lines that are cash under the ending-cash rule. For each
  projected line the rule is applied to the line's account metadata, and
  the result is unioned with `actuals.cashAccountIds`. Receipts and spending
  use the per-entry cash-flow rule over that month's projected lines.
- Actual months, trailing burn, the ratio, cash-out, runway, and nodes are
  computed from the months exactly as before. Node ids, formulas, and
  lineage stay the same.
- **Ruling:** `forecastFormulaVersion` stays `"forecast-run-2026-09-18.2"`.
  The output is identical, so bumping it would show a false "Forecast
  method updated" on every company. Readers of the stored input (B3) must
  detect the older shape (no `actuals` key) and fall back.

**Equivalence test (required).** A seeded generator produces random
ledgers with these features:

- several cash, bank, AR, AP, revenue, expense, equity, and contra accounts,
  some with `statementLine` and some without
- two currencies
- multi-line and transfer entries
- `period_close` entries
- `plan`, `scenario`, and `translation` basis lines that must be ignored
- drivers of every cadence, including one with no template
- horizons from 1 to 24 months

The test asserts that `stableJson(newRun)` equals `stableJson(referenceRun)`
across at least 200 seeds. `referenceRun` is the slice-1 implementation,
kept verbatim as a test-only helper, `forecast-run.reference.ts`, that is
not exported from the package index.

### B2. Compact, canonical persisted input

`persistForecastRun` stores `inputJson = stableJson(input)` where `input` is
the new `ForecastRunInput`. That input holds the summary, not the lines, so
it is O(drivers + accounts). Drivers and templates are sorted by id before
hashing. `summarizeActualCash` is order-independent because it sorts by id.
So `inputHash` is canonical.

### B3. Cheap preview

`previewForecastChange` loads only these:

- the latest persisted forecast run's `inputJson`, which is a small query
- the current company revision
- the drivers and templates, which are small queries
- the changed item or decision

If the latest run's revision equals the company revision, and its as-of
equals today's computed as-of, it reuses `input.actuals`, and the accounts
and settings from the stored input. Otherwise it falls back to
`loadForecastInputs`, which loads the ledger once. Both sides are then
built with `buildForecastRun`, which is now O(P). The preview is still
never written.

### B4. One forecast per request for readers

`withDerivedForecast` and the three ledger loaders accept an optional,
already loaded `forecast` value (or `null`).

- `loadJournalFinancialMonths` loads it once and passes it through.
- The journal-financials, reporting, inspect, calculations, and agent routes
  pass the value they already loaded.
- When nothing is passed, loaders keep today's behaviour of loading it
  themselves.

### B5. Serialized forecast jobs, checked before and after

`runForecastJob(companyId, revision, { now? })` becomes one READ COMMITTED
transaction. Every query inside it uses the `tx` executor. Nothing may call
`getDatabase()`, because the dev pool has one connection.

1. Run `select pg_advisory_xact_lock(hashtext('forecast:' || companyId))`.
   This blocks until any other forecast job for the company commits.
2. Read the company revision. If it is not equal to `revision`, return
   `{ superseded: true }` without writing anything.
3. Load the inputs through `tx`, compute, persist the run and its nodes, and
   record the consequence. The previous-run lookup happens after the lock,
   so it sees every run committed before this job.
4. Read the company revision again, just before commit. If it has moved,
   throw an internal `ForecastSuperseded` error so the transaction rolls
   back, then return `{ superseded: true }`. The newer job's cause window
   `(previousRun.revision, newer]` still includes this revision's causes,
   because no run was persisted.

**Ruling: READ COMMITTED plus a lock, not REPEATABLE READ.** Under
REPEATABLE READ, Postgres takes the snapshot at the start of the lock
statement, before it waits for the lock. The job would then miss the run
that the job ahead of it just committed and would diff against a stale
previous run, which is exactly the double counting this section removes.
The revision checks before and after give the guarantee that matters:
never persist a run for a superseded revision. Reads are not taken from a
single snapshot. The only writer that can change them mid-job is a
mutation, and a mutation's revision bump is caught by the second check
unless it lands after the commit. That is the residual race below.

To support this, the loaders take an optional executor `db?: DbExecutor`,
where `DbExecutor` is the database type or its transaction type:

- `loadForecastInputs(companyId, { now?, db? })`
- `loadPostedJournalLines(companyId, period, db?)`
- `loadForecastDrivers(companyId, opts, db?)`
- `forecastAsOfMonth(companyId, now, db?)`
- `persistForecastRun`, which uses the passed `db` and does not open its own
  transaction when one is given
- `loadPreviousForecastRun(..., db?)`
- `recordForecastConsequence(..., db?)`

`processCalculationOutboxJob` maps `{ superseded: true }` to the existing
`superseded` status.

**Residual race (documented).** A mutation's data commit and its revision
bump are separate transactions. If mutation B commits its data before job
N reads it, and bumps the revision to N+1 only after job N commits, then
run N includes B's data under A's causes, and job N+1 diffs to null. The
window is the gap between B's commit and its
`refreshCurrentCalculationRun`, which is milliseconds. The full fix, bumping
the revision inside each mutation's transaction, is a follow-up.

### B6. Performance check

A perf script, `packages/finance-engine/src/forecast-run.bench.ts`, run with
`vitest bench` and not part of `pnpm test`, compares the reference against
the new engine on 10k and 50k synthetic lines. The implementer records the
numbers in the report. A regular test asserts that the new engine does not
call `buildJournalStatements`, using a module spy, so the O(L) claim is
enforced structurally rather than by timing.

## Testing

- **finance-engine:**
  - the equivalence property test, over 200 or more seeds
  - `summarizeActualCash` unit tests covering the contra and section rule,
    a `statementLine` versus code key, `period_close` inclusion, per-entry
    netting of transfers, and excluded bases
  - the existing forecast-run and forecast-consequence tests, unchanged
    apart from the input shape
- **web, DB-backed:**
  - forecast-job tests still pass
  - a new test starts two `runForecastJob` calls for consecutive revisions
    at the same time and asserts one consequence per non-superseded
    revision and no double counting
  - a test that a job whose revision has already moved persists nothing
    (`superseded`), and a test that a revision bump during the job leaves no
    run for that revision
  - the preview parity tests still pass
  - a new preview test asserts that the ledger loader is not called when the
    latest run is current
- **reader:** a unit or integration check that `loadLatestForecast` is
  called once per journal-financials request, through a spy or a counter.
