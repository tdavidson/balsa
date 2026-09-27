# Goal-directed financial model

Date: 2026-09-25  
Status: cash workflow for slices 1–4 and the financial-review gap completion implemented; real-use validation deferred.  
Audience: product, engineering, and finance reviewers.

Gap completion: [delivery checklist and verification](2026-09-25-financial-review-gap-completion.md).

Implementation note: [cash goals, plans, and reviews](../../goal-reviews.md) documents the delivered first slice and its explicit limits. [Intra-month expectations and coverage](../../forecasted-closes.md) documents reviewed occurrences, partial settlement, explicit source-fact automatic matching, and date cutoffs. Fixed-driver recurring capture is now available with bounded approval windows, stale-source detection and audited rollover. Fixed-order change bridges now compare goal outcomes with saved plans and reviews, preserve intermediate values and references, and expose unexplained residuals. Goal-aware scenario evaluation, versioned manual conditions, atomic reviewed application and immutable outcome reviews now complete the decision loop. The minimum cash fixture runs end to end. Historical recurrence approval, import-difference review, evidence-backed starting balances and per-decision attribution are implemented. These controls do not certify the books or replace user validation. Continuous review, ownership, accuracy and weekly cash follow the [continuous-review delivery plan](2026-09-26-continuous-financial-review.md). Cash results remain provisional where these evidence controls are incomplete; the broader trustworthy-starting-point and pilot-usability requirements below are not claimed complete.

## Product intent

**An evidence-backed financial model that continuously reconciles what happened, what is expected, and what each decision changes.**

The recurring user question is: **How is the business progressing toward our goals, and what should we change?** The specific question changes as the business changes. Goals, evidence, assumptions, and past decisions provide the durable context.

The initial adopter is a founder managing finance. The credibility standard is a CFO who can inspect, correct, and take ownership of the same model. Simplicity comes from progressive disclosure, while calculations, provenance, and review history remain available underneath.

Proposed initial customer profile: a founder-led business with recurring receipts and spending, existing accounting records, and consequential cash decisions, but without a dedicated financial planning team. The first release supports one company and one reporting currency. It must identify unsupported activity rather than silently exclude it.

The direction established in the Numeric discussion is to preserve source context, reuse approved financial treatments, surface exceptions, and maintain a consistent financial foundation. Direct provider integrations and an ERP replacement are outside this release. Files, accounting exports, supporting agreements, and approved assumptions are sufficient inputs.

## Release outcome and boundaries

The first release must complete one repeatable loop:

1. Import evidence, review its coverage, and establish a trustworthy cash starting point.
2. Set a cash goal and constraints; approve the assumptions and save the plan intended to achieve it.
3. Import new activity during the month. Reconcile actuals with expected events and update the outlook.
4. Explain the gap to the goal, the variance from the plan, and the change since the previous review.
5. Compare a decision against the same goal and constraints, approve it if appropriate, and preserve the review.
6. Let a CFO trace and correct the inputs without rebuilding the model elsewhere.

Release one supports month-end cash targets and cash floors across specified month-ends. These fit the current cash forecasting foundation. Monthly resolution must be visible: passing a month-end floor does not establish that cash stays above it every day.

Revenue and operating-profit goals follow once projected statements, recognition schedules, and their reconciliation are verified. A receipt is not revenue. Runway remains contextual, with its definition and horizon shown; no forecast breach within the horizon means “no breach within this horizon,” not infinite runway.

Out of scope: ERP migration, payments, autonomous business decisions, automatic optimization of management goals, probabilistic success scores without calibrated models, daily liquidity guarantees, consolidation, and new direct provider integrations. Existing features outside this scope remain available.

## Domain language

| Concept | Meaning | Change rule |
| --- | --- | --- |
| Goal | A desired metric value, comparator, and date or interval | Explicit versioned revision by a user |
| Constraint | A condition a proposed path must respect | Explicit revision; never silently relaxed |
| Plan | An approved snapshot of assumptions and projected financial results | New version; prior versions remain readable |
| Outlook | The latest calculation using accepted evidence and current approved assumptions | Recomputed when relevant inputs change |
| Actual | Approved, posted financial activity | Corrected through auditable accounting actions |
| Expectation | A supported event expected to occur, with remaining financial effects | Revised or settled through explicit lineage |
| Scenario | Hypothetical changes evaluated against a specified outlook | Does not alter actuals or the approved plan |
| Review | A saved view of goals, plan, outlook, coverage, exceptions, and decisions at a point in time | Immutable; later reviews may supersede it |

A goal must never generate a forecast receipt merely because the business needs that receipt to hit its target. Saving a new outlook must not rewrite the plan. Approving a decision changes relevant assumptions; it does not automatically rebaseline the plan or revise the goal.

## Founder workflow and CFO depth

### Establish the path

Onboarding asks the founder to choose a goal, provide the available evidence, and review the major assumptions. The proposed default is “finish the selected month with at least this cash balance,” with an optional cash floor for intervening month-ends.

Show detected accounts and covered dates, the reconciled opening cash balance, recurring obligations, expected receipts, and unresolved questions. Allow a draft before coverage is complete, but mark affected results as provisional. Saving a plan requires an explicit approval action; acknowledged exceptions remain attached to it.

Nonfinancial constraints such as “preserve the product team” are supported as manual review conditions. Do not show them as automatically satisfied unless structured inputs and a deterministic evaluator exist. A scenario with an unresolved manual condition is “requires review.”

### Review the business

The primary screen shows, in order:

1. **Goal and path:** target, plan, latest expected outcome, signed gap, and constraints.
2. **What changed:** a reconciled bridge from the previous saved review, with dated evidence and assumption changes.
3. **What needs attention:** missing coverage, ambiguous settlements, overdue expectations, and decisions requiring action.
4. **Choices:** saved scenarios and their effects on the goal and constraints.

Actuals and remaining expectations must be distinguishable within the open month. Use text labels as well as visual styling. Always show the information cutoff, forecast horizon, and calculation status. While recalculation is pending, retain the last completed result with a visible stale status.

Chat can explain and navigate this state or draft changes. The user should not need to invent a prompt to discover a material exception or understand progress.

### Inspect and correct

Each headline opens its calculation, relevant journal lines or schedules, assumptions, and source evidence. Show formula version, input values, output, approval history, and exceptions. Distinguish arithmetic validity, evidence completeness, and assumption approval; a correctly computed forecast is still uncertain.

Corrections to mappings, financial treatment, dates, assumptions, or matches create scoped, auditable changes with effective dates and reasons. Preview financial consequences before approval. Approved changes trigger a new outlook and leave earlier reviews intact. Founders can perform this review themselves; the first release does not require a separate CFO role or claim segregation of duties.

## Functional requirements

### 1. Goals and constraints

A goal version stores company, name, metric identifier and version, currency, scope, comparator, target in minor units, target month or interval, owner, author, timestamp, and reason for revision. Support draft, active, and archived lifecycle states. Archiving preserves history. Multiple goals can be active; one is selected as the primary review goal.

For the first release:

- `ending_cash_at_month`: evaluate one month-end balance against a target.
- `minimum_month_end_cash`: evaluate every month-end in an inclusive interval against a floor; report the minimum and first breach.
- Compute signed headroom as observed/projected amount minus target for these minimum-value goals.
- Reject incompatible currencies, invalid periods, and unsupported metric definitions.
- Return “outside forecast horizon” or “unable to evaluate” rather than a pass when required values are unavailable.

Display projected status separately from achieved status. An incomplete period cannot establish achievement. Known missing coverage or financial exceptions that affect the metric prevent an unqualified “on track” result.

### 2. Versioned plans and saved reviews

An approved plan version freezes the selected goal and constraint versions, forecast input and output, assumptions, templates, account mapping context, source references, coverage snapshot, financial-state revision, formula versions, approval, and exceptions. Use immutable snapshots or immutable version references for everything required to explain its numbers later.

The existing plan-journal pinning function is a useful posting mechanism, but it reconciles and reverses prior projections. It is not the complete historical plan contract. New plan versions must have separate identities and cannot make older versions unreadable through reversal or current-state filtering.

A review references exact goal versions, plan version, completed outlook run, scenario evaluations if any, coverage, exceptions, and approved decisions. “Compare with previous review” uses those references rather than recalculating the past against today's assumptions. Formula upgrades produce a new run; an optional restated comparison is separately labeled and never replaces the original.

### 3. Expectations and actual settlement

An expectation is company state describing a financial event, not a second financial engine. Its remaining effects materialize through existing journal templates and deterministic calculations. It retains origin (agreement, approved assumption, or historical pattern), evidence, approval or approved inference policy, counterparty, currency, amount, timing, treatment, and stable identity for each occurrence.

Historical patterns initially produce reviewable suggestions. A user may approve a scoped recurrence policy so later occurrences can be included automatically. Store the pattern inputs and rule version; mark inferred amounts as estimates. An explicit approved schedule takes precedence only when it represents the same economic obligation. Sharing posting accounts is insufficient.

Separate lifecycle states (proposed, active, canceled, superseded) from settlement state (unmatched, partial, settled, disputed) and overdue status. Cancellation and supersession preserve earlier versions. Passing an expected date does not delete an expectation or silently move it to today.

Settlement requirements:

- Link actual journal events to expectation occurrences with explicit allocations; permit partial receipts, installments, and one actual covering several expectations.
- Allocate in the expectation's currency and minor units. Allocation totals cannot exceed an actual's eligible amount or silently erase an expectation's remaining amount. Excess amounts need explicit variance treatment.
- Automatically settle only under an approved deterministic rule with sufficiently specific identity and no competing candidate. Amount, generic memo, or account shape alone is insufficient. Otherwise propose a match for review.
- Remove only the settled portion from future projections. Retain the expectation and link in history; never delete the evidence of what was expected.
- Permit explicit final settlement for a different amount, recording the variance. A partial payment alone must not imply final settlement.
- Reversing or correcting an actual reverses or revises its allocations and restores the appropriate expectation balance.
- Keep revenue recognition, invoicing, and cash settlement distinct. A cash receipt must not erase future recognition, and a delayed receipt is not automatically lost revenue.
- Maintain one canonical occurrence identity across approved drivers and inferred expectations to prevent overlapping forecasts. Do not deduplicate unrelated obligations by posting shape.
- Handle unsupported foreign-currency settlement as a visible exception until conversion policy and FX lineage are supported; never copy historical FX amounts into a new forecast event.

Historical pattern inference now produces review suggestions only. Whole-event description matching and account-shape suppression have been removed from the live outlook. Durable partial allocations and explicitly approved exact-source-fact rules provide the initial settlement path; fixed-driver recurring capture now uses bounded approvals and canonical occurrence identities. Historical-pattern recurrence policies and the remaining coverage requirements are still outstanding.

### 4. Information cutoff and coverage

Track effective financial dates separately from when information was recorded and approved. Each outlook records the actuals-through date, knowledge cutoff, coverage by required source/account and interval, and remaining forecast window. Filter actuals by the cutoff; a label alone is insufficient.

Coverage states distinguish missing, partial, pending review, complete through a date, and conflicting/corrected evidence. Record how completeness was established. Zero transactions can be a valid complete period when supported by a statement or approved coverage assertion; the presence of one transaction cannot establish completeness.

Import review reports new rows, duplicates, corrections, and superseded evidence, with financial effects after approval. Duplicate imports are idempotent. Source coverage rules are specific to the metric: bank evidence may support cash without establishing revenue or profit completeness.

Late-arriving evidence can change the latest outlook for an earlier effective period. Previously saved reviews retain what was known then. Reproducibility in release one means saved snapshots, not a promise to reconstruct every arbitrary historical timestamp.

### 5. Explain the gap and change

Keep three comparisons distinct: outlook versus goal, outlook versus approved plan, and outlook versus previous review. Use the same metric definition, currency, scope, and period for both sides; expose incompatibility rather than comparing unlike values.

Produce a deterministic numerical bridge. Categories include actual amount differences, timing shifts, approved assumption/decision changes, coverage corrections, and formula changes. Store supporting input IDs and intermediate outputs. Contributions plus any explicit residual must equal the total change exactly in minor units.

For interacting changes, use a documented stable ordering or an explicit interaction bucket. Present this as model attribution, not proof of real-world causation. Do not manufacture a complete explanation when attribution is unavailable. An unexplained residual remains visible and cannot be narrated away by a model.

### 6. Decisions and scenarios

Evaluate scenarios against an exact base run and goal/constraint versions, using the existing engine. Show impact on target cash, minimum cash and first breach, assumptions changed, and unresolved conditions. Operational effects such as a hiring delay changing revenue require explicit supplied assumptions; the product must not invent them.

Editable scenarios may continue to recompute against the latest base. A scenario attached to a review or promoted decision freezes its changes, base, results, and assumptions. If the base changes before approval, require a refreshed preview and show the difference.

Promotion creates proposals through the existing decision workflow. Approval applies supported changes idempotently and records the reviewed evaluation. For a multi-change decision, use an atomic application or explicitly display partial application and its recalculated effect; never imply the entire scenario took effect when only part did. Neither promotion nor approval silently changes the plan or goal.

Later reviews compare expected decision effects with observed outcomes, while showing other changes during the interval. Do not label observed variance as the isolated causal effect of the decision.

## Implementation shape

Reuse the existing boundaries: evidence and source rows record inputs; company state records approved interpretations, expectations, goals, and decisions; journals and calculation runs own financial results.

| Existing foundation | Proposed extension |
| --- | --- |
| `packages/finance-engine/src/forecast-run.ts` | Explicit cutoff, remaining expectation projections, and cash-goal evaluation over the shared run |
| `packages/finance-engine/src/forecast-consequence.ts` | Comparable-period bridges with attribution and residuals |
| `apps/web/src/lib/forecast-plan-pin.ts` | Version-specific plan identity plus full immutable plan snapshot |
| `apps/web/src/lib/forecast-persistence.ts` | Preserve complete lineage and attach goal evaluations/review references |
| `apps/web/src/lib/journal-coverage.ts` | Date-range completeness distinct from evidence approval and activity presence |
| `apps/web/src/lib/forecast-inputs.ts` | Deterministic selection by cutoff, approved policy, and settlement state |
| `apps/web/src/lib/forecast-scenarios.ts` | Frozen evaluations for review and decision approval, alongside live previews |
| `packages/database/src/schema.ts` | Company-scoped version, occurrence, allocation, and review records |

Proposed persisted concepts, with final table names left to implementation planning:

- Goal identity and immutable goal versions, including constraint definitions.
- Plan identity and immutable plan versions with full snapshot references.
- Expectation identity, versions, occurrences, and auditable settlement allocations.
- Coverage assertions with source/account scope, intervals, support, and supersession.
- Review snapshots and saved scenario evaluations tied to exact calculation runs.

These extend existing economic items, decisions, and journal lineage; they must not create competing stores for the same approved assumption. Decide ownership explicitly in the migration design. Every derived journal occurrence needs stable lineage back to its expectation or driver and its input evidence.

Expose server operations for goal creation/revision, plan approval, expectation review/allocation, coverage review, review creation/read, and scenario evaluation/approval. Financial results are server calculated; clients submit validated intent rather than authoritative totals. Return resource versions and reject stale writes. Keep URL and payload details in the implementation plan after schema ownership is settled.

All reads, references, writes, and background jobs are company scoped. Cross-company IDs must fail even when the caller can access both companies. Financial mutations, audit records, state revision, and calculation-outbox requests commit atomically. Preserve the existing transaction/locking conventions and make retries idempotent. Do not hold a database transaction open while calling a model.

Migrations must retain existing forecasts, scenarios, and plan journals. Legacy inferred events remain labeled as legacy estimates until reviewed; do not manufacture historical approvals or complete plan snapshots from incomplete data. Missing migrations produce actionable errors, not silent fallback behavior.

## Delivery sequence

| Slice | Deliverable | Exit condition |
| --- | --- | --- |
| 1. Preserve the baseline | Goal definitions, immutable plan/review snapshots, cash goal evaluator | A changed driver updates the outlook without changing the saved plan or goal; prior review remains inspectable |
| 2. Reconcile the open month | Coverage/cutoffs, durable expectations, allocations, overlap prevention | Imports and partial settlements update remaining projections once, with complete lineage and visible gaps |
| 3. Make progress understandable | Primary review screen, three comparisons, deterministic change bridge, inspection/correction | A founder can explain the gap and a CFO can independently inspect every displayed amount |
| 4. Complete the decision loop | Goal-aware scenario evaluations, reviewed approval, subsequent outcome review | One approved decision updates the outlook with a preserved before/after evaluation |
| 5. Broaden supported goals | Verified projected statements and recognition schedules, then revenue/profit goals | Statement and cash reconciliation acceptance tests pass before these goals are offered |

The first product release includes slices 1–4. Individual slices are internal milestones, not claims that the entire loop is ready. Start implementation with slice 1 and include a small fixture-backed review view so product semantics can be evaluated before building the full interface.

## Acceptance scenarios

Use synthetic data only. The following is the minimum end-to-end release fixture; dollar displays are backed by integer minor units.

**Baseline:** opening September cash is $500,000. Approved September receipts are $100,000 and spending is $150,000. October receipts are $100,000 and spending is $150,000. The plan ends September at $450,000 and October at $400,000. The goal is at least $400,000 at October month-end, with a $350,000 floor at each month-end.

1. Import a $60,000 partial September receipt against the expected $100,000 receipt. Actual cash rises by $60,000, the remaining receipt is $40,000, and September projected cash remains $450,000. A duplicate import changes nothing.
2. Approve a timing revision moving the remaining $40,000 to November. September becomes $410,000 and October $360,000. October goal shortfall is $40,000; cash-floor headroom is $10,000. The bridge attributes the $40,000 reduction to timing, without reporting lost revenue. The plan remains unchanged.
3. Simulate moving $50,000 of October discretionary spending to November. October becomes $410,000, beating the target by $10,000; the month-end floor still passes through October. Show the November consequence too. A manual “preserve product team” condition remains pending until reviewed.
4. Approve the scenario after checking the latest base. Save the decision, evaluation, and review. Applying it twice has one effect. The original plan still reports October $400,000; the latest outlook reports $410,000.
5. A CFO opens October cash and follows the $50,000 difference to the approved schedule change, decision, and supporting source. Correcting its timing creates a new result without overwriting the saved review.

Additional required cases:

- Missing account coverage makes goal status provisional even when arithmetic is valid; confirmed zero activity can establish complete coverage.
- Two unrelated obligations sharing amounts and posting accounts remain distinct; ambiguity never silently removes a forecast.
- Multiple receipts settle one expectation; one receipt can settle multiple expectations without over-allocation.
- Explicit final settlement with a differing amount records variance; reversal restores the correct outstanding amount.
- Future-dated actuals are excluded from a prior cutoff; late-arriving corrections affect the latest review only.
- Recognition and cash schedules remain separate, and transfers do not create revenue.
- Month rollover preserves outstanding occurrences without duplication or silent cancellation.
- Incompatible currency, unsupported FX, horizon gaps, and failed calculations cannot yield a successful goal status.
- Attribution sums to the total delta; interactions or residuals are visible.
- Engine upgrades preserve old snapshots and label restatements.
- Concurrent approvals, imports, and allocation attempts remain consistent and idempotent.
- Cross-company reads and mutations fail; migrations preserve legacy records and disclose incomplete history.

For implementation, add accounting regression tests, database transaction/migration tests, and focused UI workflow checks. Run `pnpm run verify`, `pnpm acceptance`, and `pnpm isolation` against isolated synthetic companies as required by `AGENTS.md`. Verify journal balance, statement balance where applicable, cash roll-forwards, and actual/forecast/scenario calculation parity. This document alone does not require running those code gates.

## Product validation

In pilot sessions, ask founders to identify the goal gap, explain its largest change, and compare a decision without assistance. Ask a finance reviewer to validate a headline and correct an assumption without rebuilding the model in a spreadsheet.

Measure time to first approved plan, time from import to reviewed outlook, unresolved exception count/age, percentage of displayed changes with reconciled explanations, successful source inspections, and return visits for subsequent reviews. Record review burden and incorrect automatic match rate before broadening inference policies. Set numerical adoption targets after establishing a pilot baseline; accounting conservation and replay requirements are mandatory from the start.

## Proposed defaults to validate

These choices make the first build concrete without presenting them as settled customer findings:

- Start with cash goals for founder-led businesses with recurring activity; validate the industry and company-size focus with pilots.
- Default to a monthly review with updates after approved imports, retaining intra-month visibility.
- Require initial approval of inferred recurrence policies; expand automation only with observed matching quality.
- Keep nonfinancial constraints explicit and manually reviewed until structured evaluation is supported.
- Add revenue/profit goals after projected-statement verification, rather than inferring them from cash.

Related repository context: [forecasted closes](../../forecasted-closes.md), [forecast scenarios](2026-09-18-forecast-scenarios-design.md), and [driver formulas](2026-09-18-driver-formulas-design.md). This spec extends those designs; it does not claim their existing implementations already meet these release requirements.
