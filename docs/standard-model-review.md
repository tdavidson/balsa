# Standard model implementation review

Reviewed October 6, 2026, against `6555d9c` (Standard Financial Model, PR #12).
The four findings below have now been addressed. The original reproductions are
retained to explain the regression coverage and remaining support boundaries.

## What the addition delivers

- Standard statement mapping and categories, fiscal-year summaries, and a model timeline.
- Forecast patterns, linked metrics, metric actuals, seasonality, escalation, and proposals inferred from history.
- Explicit posting and settlement accounts for scenario-added drivers.
- A formula-bearing workbook with Forecast and Model inputs, statement deltas,
  scenario selection, plan comparisons, lineage, and checks.
- Returned workbook inputs parsed into company-scoped, evidence-linked decisions.

These extend the existing operating-model, decision, and outcome-review tools.
They do not replace the deterministic accounting engine or automatically merge
operating-study observations with forecast metrics.

## Findings and corrections

### P1 — Approving edits to two coordinates can undo the first edit

[Workbook proposal construction](../apps/web/src/lib/workbook-round-trip.ts)
builds a separate `set_variable` proposal for each edited coordinate, each from
the same original variable snapshot. Applying a proposal replaces the variable's
complete inputs.

Reproduction: export headcount with engineering 2 and sales 3. Return engineering
4 and sales 5. The engineering proposal contains engineering 4 / sales 3; the
sales proposal contains engineering 2 / sales 5. Approving both restores one old
coordinate. Temporary synthetic tests reproduced the conflicting proposal payloads.

Implemented: all returned coordinates of a variable are grouped into one atomic
proposal. Approval checks the complete expected variable under the company write
lock; competing or intervening changes return a conflict without applying it.
Regression tests cover both coordinate orders and concurrent approvals. Old
workbook variable proposals without this guard are refused; export again.

### P1 — Unchanged workbook months can overwrite newer Balsa inputs

[`stepInputs`](../packages/model-export/src/round-trip.ts) replaces all months in
an edited coordinate's exported range, not just the changed cells. The proposal
summary lists only differences from the workbook baseline.

Reproduction: October and November were both 2 at export. November is subsequently
changed to 7 in Balsa. Returning October 4 with November unchanged at 2 produces
inputs October 4 / November 2, although the proposal describes only October.
A temporary synthetic test reproduced this replacement.

Implemented: only changed cells are merged into the current step schedule.
Untouched months and values beyond the export window are preserved. Changed cells
are compared with their exported baseline; a conflict suppresses the whole
variable proposal and produces a note. Approval rechecks the saved variable
snapshot. Tests cover drift before upload and between proposal and approval.

### P1 — Live statement deltas omit recognition and settlement treatment

The [export adapter](../apps/web/src/lib/standard-export.ts) passes posting and
settlement accounts into the workbook, but omits recognition treatment, recognition
intervals, and reviewed settlement schedules. Workbook
[`driverEffects`](../packages/model-export/src/forecast-sheet.ts) applies a
same-month two-leg change. The accounting
[projection engine](../packages/finance-engine/src/forecast-projections.ts)
can instead post a payment to a holding account and recognize it across months;
forecast runs also incorporate reviewed settlements.

For a $12,000 October prepayment recognized October–December, doubling the payment
should add $4,000 of expense each month and change the prepaid asset balance.
The workbook's current delta rule instead adds $12,000 of expense in October.
This finding follows the adapter and journal code paths; it has not been verified
in a spreadsheet application. Zero deltas at export can pass baseline parity
without validating the response to an edit.

Implemented containment: recognition and reviewed-settlement driver rows are
exported as fixed Balsa values, labelled with the reason and an instruction to
recalculate in Balsa. They produce no live statement deltas and are excluded from
returned-driver proposals. This applies to base and scenario rows. Tests cover
prepaid expenses, accruals, deferred revenue, partial settlements, and rescheduled
receipts. If a stored settlement cannot be matched to a current occurrence, the
export conservatively freezes driver rows. Full live compilation of these
accounting treatments remains unsupported.

### P2 — Recognized manifests lack structural validation

[`readManifest`](../packages/model-export/src/round-trip.ts) checks a format tag
and casts parsed JSON to a TypeScript type. Required collections and fields are
not validated before use. A recognized workbook with a Forecast sheet and a
manifest missing `drivers` throws during parsing. The
[upload route](../apps/web/src/app/api/evidence/route.ts) does not translate that
failure into a bounded intake error. A temporary synthetic workbook reproduced
the parser exception.

Implemented: a bounded runtime schema validates versions, dates, collections,
coordinates, finite values, duplicates, and model row lengths before parsing
edits. A malformed recognized export returns a bounded HTTP 400 and never falls
through to generic extraction. Parser and HTTP tests cover this boundary.
The manifest remains editable, unsigned input; company scoping and approvals
do not make it a trusted record of export history. Export authenticity is not
claimed, and this finding was not a cross-company authorization bypass.

## Product direction and remaining integration work

The broader promise should be **evidence-backed financial modeling and decisions**:
AI helps construct and explain a decision-specific model; deterministic code
calculates it; people inspect assumptions, compare alternatives, approve changes,
and review outcomes. Rich views and workbook interchange make the same reasoning
accessible in different contexts.

The next integration work should make the boundaries
between company forecast variables, driver metrics, and operating-study variables
visible in the interface. A shared review surface should expose their sources,
units, approval states, dependencies, and how a change reaches financial results.
Keep live links distinct from frozen scenarios and exported snapshots.

Simulation distributions are conditional on specified assumptions, not guaranteed
probabilities. A workbook that recalculates is not a full replay of every accounting
control. Neither should be presented as automatically replacing analyst judgment.

## Suggested GitHub About

> Open-source, AI-assisted financial modeling: turn company evidence into auditable books, driver-based forecasts, decision simulations, and editable workbooks—with reviewed changes and deterministic calculations.

The README and application metadata use the updated positioning. The hosted
GitHub About could not be inspected or updated: authenticated repository lookup
returned HTTP 401, and unauthenticated lookup returned Not Found.

## Validation

Regression coverage now includes atomic multi-coordinate approvals, unchanged-month
preservation, stale and concurrent approvals, legacy proposal rejection, fixed
accounting-treatment rows, malformed manifests, and bounded HTTP errors. All
fixtures are synthetic. LibreOffice-dependent recalculation tests require an
installed `soffice`; Google Sheets recalculation is not automated.

`pnpm run verify` passed with 759 tests, typechecking, and a production build.
`pnpm acceptance` passed, including Company Zero. `pnpm isolation` passed all 18
checks in local disabled-auth mode; authenticated multi-user mode was not run.
Nine LibreOffice-dependent tests were skipped because `soffice` is unavailable.
