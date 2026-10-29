# Cash goals, plans, and reviews

Open **Goals & reviews** from the workspace, or visit `/goals`.

This implements the initial cash workflow of the goal-directed financial model: preserve a baseline, reconcile expectations, measure progress, and review decisions against stated goals. [Intra-month expectation settlement and coverage review](forecasted-closes.md) now extend this foundation. Deterministic change explanations now compare the outlook with a saved plan or review. Goal-aware scenario approval and later outcome reviews are available at `/goal-decisions`.

## Workflow

1. Create a cash goal: a minimum balance at a specified month-end, or a floor across an inclusive interval of month-ends. Amounts use the company's reporting currency and the existing engine's two-decimal monetary convention.
2. Inspect the current assumptions, monthly cash roll-forward, and limitations. Download the current inputs and calculation for full journal and formula inspection.
3. Name the baseline, acknowledge its limitations, and choose **Approve as new plan**.
4. After approving new evidence or changing assumptions in the workspace, refresh the outlook. Compare its value with the unchanged plan and goal.
5. Use **Explain change** to compare the current preview with a saved plan or review. Inspect the contributions, intermediate goal values, supporting references and any residual.
6. Select the plan, name the review, and choose **Save review against plan**. The review retains explanations against the plan and the most recent prior review of that plan visible in the same database snapshot. Inspect earlier snapshots from saved history.
7. Revise or archive a goal with a reason. Earlier plans retain the earlier goal version; a new goal version requires its own approved baseline.

Goals never create forecast receipts or change financial assumptions. A new plan does not overwrite an old plan. A review does not post journals or alter financial state.

## What is preserved

Each saved plan/review includes the exact goal version, forecast input and output, formula versions, financial-state revision, actual journal lines, source/evidence references, chart mappings, coverage observations, limitations, and evaluated result. Its calculation run is also persisted through the existing financial engine. Snapshot content cannot be updated in place; deletion of the company removes its snapshots with the rest of its data.

The download contains company financial data. It includes financial inputs and source references, not the raw contents of uploaded documents. Formula replay uses the saved inputs; outputs from earlier engine versions remain stored rather than being silently restated.

The baseline is independent of legacy pinned plan journals. Existing plan pins are not presented as complete historical snapshots or assigned invented approvals.

## Explaining change

The cash-goal bridge compares the same company, goal version, currency and goal
periods. It replays saved inputs through the deterministic forecast and goal
engines in a fixed order:

1. Calendar movement and actuals cutoff, holding the previously known actuals.
2. Posted actual activity, including corrections, reversals and historical cash
   classification changes.
3. Reviewed expectation amounts, dates, cancellation/final state and allocations.
4. Forecast posting templates and active chart-account metadata.
5. Driver and model assumptions together.
6. Any remaining forecast settings.

Each step records the goal value before and after, its signed contribution,
first breach month, lowest-cash month for a floor goal, changed input references,
and intermediate calculation limitations. Interactions are assigned to the later
step in this documented ordering. Intermediate values are explanatory model
states, not approved operating forecasts or proof of real-world causation.

For example, increasing monthly costs by $20,000 across September and October
reduces October cash by $40,000. Receiving a $60,000 installment and allocating it
against a $100,000 expectation produces offsetting actual/settlement effects;
rescheduling the remaining $40,000 beyond October reduces October cash by $40,000.
Cash-floor comparisons recompute the minimum at every step, so a shift in the
lowest-cash month is visible rather than treated as a linear month-end difference.

Contributions plus the explicit residual equal the total change exactly in minor
units. Another forecast formula version, a replay mismatch, or an unavailable
intermediate result leaves attribution partial; the saved result is never silently
restated. Different goal definitions/versions, currencies or unavailable periods
are not comparable. Coverage changes are reported separately and never assigned
an invented cash effect. Complete attribution does not certify data completeness.

Saved review JSON now includes optional `comparisons.plan` and
`comparisons.previousReview`, each with its immutable baseline ID and complete
bridge output. Older snapshots remain readable without this field. Live explanations
require the same preview token as an input download or save. The download retains
all references; the page limits each displayed reference list to 30. Explanations
share the 8 MB saved-snapshot bound with the financial inputs.

Current grouping is deliberately explicit: expectation timing, amounts and matching
are attributed together, as are driver/model changes. Individual decision effects are available in scenario reviews below.
Alternative attribution orderings and cross-formula replay remain future work.

## Status and limits

Cash-goal evaluation reports the amount, signed headroom against the target, first month below the floor, actual/projected basis, and calculation inputs. Currency mismatch, missing months, invalid definitions, or an unavailable horizon cannot report success. Amounts and comparisons use integer minor units in deterministic server-side calculations.

Goal outlooks remain **provisional** where verification is incomplete. Evidence approval alone does not prove date-range completeness. Account coverage assertions and durable partial settlement are available in Reconcile expectations. Starting cash has a separate account-by-account evidence reconciliation in Financial progress. Missing coverage and forecast exceptions remain visible even if the calculated amount meets the target. Monthly balances do not establish daily liquidity. The historical anchor is not a certification that the books are closed or complete.

The capture time records when a database snapshot was read. Actuals after today’s UTC date are excluded consistently from the forecast and saved actual input. Arbitrary historical knowledge-cutoff queries are not implemented. The same forecast engine and input loader are used throughout; saved snapshots retain settlement inputs and coverage assertions.

Initial bounds: 120-month goal intervals, the existing 24-month forecast horizon, 20,000 actual journal lines and 8 MB per captured outlook, and the latest 50 snapshots in the history list. Out-of-range goals remain editable but cannot be approved as a plan. Full retained snapshots can still be retrieved by ID. Draft goals and persisted primary-goal preferences are available. Revenue/profit goals and automatic goal optimization remain outside this release. Manual conditions are reviewed explicitly, never inferred from a passing cash calculation.

## Decisions and outcomes

Open **Decisions & outcomes** from the workspace or Goals page (`/goal-decisions`).

1. Add any manual conditions to a cash goal, such as “preserve the product team.” Revising a goal preserves its earlier version and requires a new plan baseline.
2. Create a saved scenario in the workspace. Choose that scenario and a plan for a currently active goal in the decision review.
3. Review each manual condition with a status and supporting reason. Missing reviews remain pending. Changing the selected plan or scenario clears the screen's condition assessments.
4. Preview all active cash goals, target headroom, first breach month, and month-end cash across the full forecast. The page includes consequences after the goal deadline.
5. Save an evaluation without applying it, or acknowledge the limitations, give a reason, and **Approve & apply together**. Pending/failed conditions, cash-floor breaches, unavailable calculations, unsupported scenario items and other forecast exceptions block approval. Ending-cash targets may remain below target; their gap stays visible for management judgement.
6. Inspect the preserved approval or download its complete before/after inputs, formulas, journal lineage, conditions, and generated decision IDs. Successful approval archives the scenario and preserves the original plan.
7. Later, choose **Review outcome** on an applied review. The bridge compares today's outlook with the preserved applied outlook under the original goal version. Save this as another immutable review. It includes subsequent activity and other decisions, so it is not an isolated causal effect.

Approval rechecks the complete preview inside a company-scoped repeatable-read transaction. Promotion uses existing decision effects and application markers. Every effect, applied status, audit, one financial-state revision, outbox request, scenario archival and immutable review commits together. If any effect fails, or the resulting monthly cash differs from the preview, all changes roll back. Concurrent approvals cannot apply the same scenario twice. Identical request-key retries return the preserved receipt, even after archival. Goal-definition changes serialize against financial approval without creating artificial financial revisions.

The initial path supports valid driver and model-variable changes and fixed cash scenario items. Formula items retain their formulas during promotion. Fixed, single-payment recognition is supported within the bounds described below; unsupported treatments block approval. Captured expectations retain their reviewed identity and schedule; changing a driver does not silently rewrite them. A changed recurring policy needs renewed approval before later automatic capture. All such limitations remain in the reviewed preview. Legacy **Promote** continues to create individual proposals; use this reviewed path for atomic application.

Migration `0079_goal_decisions` adds immutable `goal_decision_reviews`, company-scoped foreign keys and RLS. `GET /api/goal-decisions` returns choices and the latest 50 summaries; `?id=<uuid>` returns one complete preserved review. `POST` supports `preview`, `save_evaluation`, `approve`, `preview_outcome`, and `save_outcome`, with the active `x-company-id` guard. Saves require a pinned preview, acknowledgement, reason and request UUID. Initial bounds are 20 active goals, 20 conditions per goal, 16 MB per preview and 24 MB per saved decision review; the existing 8 MB outlook bound still applies.

## Storage and API

Migration `0076_goal_reviews` adds append-only `cash_goal_versions` and immutable `financial_review_snapshots`. Composite foreign keys prevent linking snapshots across companies. New tables follow the existing company-scope RLS policy and all application queries explicitly filter by company.

- `GET /api/goal-review`: latest goal versions, outlook evaluations, current assumptions, month values, and recent snapshot summaries.
- `POST /api/goal-review`: `create_goal`, `revise_goal`, or `save_snapshot`. Mutations require `x-company-id` to match the active company.
- `GET /api/goal-review/outlook?preview=<token>`: full current inputs, outputs, and lineage for the reviewed preview.
- `GET /api/goal-review/bridge?baseline=<id>&preview=<token>`: current-preview attribution against a company-scoped saved plan or review for the same goal version.
- `GET /api/goal-review/snapshots/<id>`: exact saved content, scoped to the active company.

Snapshot saves require the preview token, current goal version, acknowledgement, and an idempotency UUID. A changed input, currency, date, coverage observation, or financial revision invalidates the preview. Identical retries return the saved snapshot; reusing a key with different intent fails. Goal revisions require the expected prior version. Concurrency conflicts return a refresh/retry response.

Reads and saves use repeatable-read database transactions. A save's snapshot, calculation run, and audit record commit together. These are management records and do not advance the financial-state revision or enqueue an unnecessary forecast mutation. Unknown failures are bounded; missing schema produces a migration instruction.

## Validation

Engine tests cover the specification's $500,000 opening-cash fixture, month-end targets/floors, exact large amounts, missing periods, unsupported currencies, provisional results, and compatible comparisons. Database tests use synthetic companies and verify unchanged baselines after driver changes, replay, stale approvals, retries, goal history, cross-company rejection, immutable records, and migration constraints.

Run `pnpm run verify`, `pnpm acceptance`, and `pnpm isolation` against an isolated synthetic database and application. The existing isolation script uses the installation's first company as its fixture, so do not point it at a database containing customer companies.

The decision integration fixture runs the full $500,000 opening-cash example through partial allocation, a delayed remainder, a four-effect spending scenario, explicit manual review, atomic application, idempotent retry and an immutable later outcome review. Failure injection verifies transaction rollback and cash-preview parity; concurrent approval and cross-company cases cover the decision boundary.

## Financial progress and review completion

`/progress` is the founder entry point: persisted primary goal, latest plan and
review, posted cash, projected headroom, account coverage and prioritized review
actions. Draft goals can be prepared without becoming approval constraints.
Selecting a primary goal is company-scoped and version checked; revising it
follows the new active version, and archiving it clears the selection.

Starting cash now reconciles each cash account to approved, identity-reviewed
bank or brokerage evidence at the exact boundary. Matching requires the same
account identifier, currency and entity. Conflicting balances, omitted accounts,
wrong dates and mismatches remain unverified; evidenced zero balances are valid.
The review preserves the inputs, formula version, statements and supporting
journal lines. This arithmetic and source control does not certify completeness
of activity after the boundary.

Monthly inspection includes current entries, preceding opening-balance entries,
history behind expectations, formulas, decisions and scoped evidence links.
Corrections can map a cash account to reviewed evidence, draft a fixed-driver
amount change for scenario approval, review an expectation, or open the source
import comparison. Every correction requires the current preview and a reason.
Formula drivers must be changed through their model inputs/formulas, not their
fallback display amount.

`/imports` compares up to 2,000 normalized rows from explicitly selected sources.
Full replacement approval requires the exact same account, entity, currency and
statement period. Partial updates require matching account, entity and currency
and overlapping dated statements. Up to 100 explicit one-to-one row mappings
support changed export identifiers. Partial corrections require explicit mapping;
absent rows retain their original postings. Equal export keys can establish equal
rows, but amounts and dates alone never establish identity. New and corrected activity needs a reviewed posting proposal;
ambiguous rows, unavailable provenance and unsupported FX effects block approval.
Duplicates retain the earlier posting. Corrected rows reverse their earlier
posting. Only full replacements reverse removed rows and supersede the earlier
statement; partial updates preserve both statement documents and expose any
remaining balance-evidence conflicts. A maximum of 200 journal effects can be
approved together. Comparisons of unrelated files do not establish duplication
from shared amounts or dates.

The import preview executes the normal posting, recurrence and settlement controls
inside a rolled-back savepoint, including source supersession and coverage
changes. Approval repeats the current comparison, validates the preview token,
and commits postings, source disposition, audit, receipt and calculation outbox
atomically. Evaluations can be preserved while blocked. Applied receipts retain
both the preview and the actual saved journal lineage; temporary preview journal
IDs are not posted IDs. Retries use a company-scoped request key.

Decision reviews attribute scenario items in ID order, followed by stored changes
in order. Interactions belong to the later step. Invalid intermediate states
leave attribution incomplete with an explicit residual; this is a model
comparison, not causal evidence. Existing saved reviews remain readable without
attribution. Formula items retain their formulas when promoted. Approval checks
both monthly cash and projected debits/credits by account, entity and currency.

Additional recognition support is deliberately bounded: one fixed payment with
an explicit recognition interval of at most 24 months, an approved cash/revenue or
expense/cash template, and exactly one active account explicitly classified as
receivable, payable, prepaid asset or deferred revenue. Prepayments precede
recognition; accrual payments follow recognition. Recognition splits integer minor
units exactly, allocating remainder pennies to the earliest months. Payment and
recognition use balanced entries in the shared forecast engine. Recurring or
formula-based recognition and ambiguous mappings remain explicit exceptions.
Past schedules can continue after actual payment and recognition journals are
explicitly linked and their cumulative account debits and credits exactly tie to
the completed schedule. Changed or reversed journals reopen the exception.
Unproven past balances cannot silently become a remaining schedule. This does not expand the release to
revenue/profit goals or verified projected financial statements.

Automated regression, accounting acceptance and company-isolation checks cover
this release. Real-user pilots, browser visual QA and multi-user exercises remain
separate validation work.


## Continuous review and CFO ownership

The guided checklist at `/progress` is derived from live evidence, starting-cash
reconciliation, coverage, outstanding expectations, the primary goal and an
approved plan. It reopens steps when those controls stop passing; it is not a
manually checked onboarding badge.

The same page includes 13 rolling weeks of dated cash. Posted cash through the
UTC cutoff is the starting point. Journal-derived expected receipts and payments
roll forward by date, with the minimum daily closing cash within each week and
its first floor breach. Overdue and undated amounts remain outside dated totals
until reviewed. Monthly schedule dates are visibly assumed. This view does not
prove intraday liquidity or completeness of future activity.

At `/reviews`, prepare a current financial review, an accuracy report against a
preserved plan/review, or named downside/base/upside cases. Accuracy scores only
completed obligations explicitly allocated to actual journals and preserved before
the expected event and payments. Partial and unmatched items remain pending;
retrospective, cancelled, reversed or incompatible observations are excluded.
Amount error, final-payment timing error, sample counts and cash optimism retain
source references. No observations means unavailable accuracy, not perfect
accuracy. Driver summaries do not automatically recalibrate assumptions.

Named cases reuse existing scenarios without applying decisions or assigning
probabilities. Optional timing sensitivity tests each whole-day delay (1–90 days)
for an outstanding expectation through the same forecast engine, including other
active goals and the 13-week cash floor. Unverified evidence, overdue obligations,
manual conditions and dates beyond the weekly window prevent a supported timing
limit. These are bounded model checks, not guarantees.

Saving a report assigns its preparer and optionally a current-company reviewer.
Each limitation becomes an exception task with assignee, due date and disposition.
Only the preparer/company owner can reassign ownership; assigned people can update
their tasks. Submission requires a reviewer. Only that reviewer can sign the
submitted, current snapshot. A founder can prepare and sign, with explicit
self-review acknowledgement recorded permanently. Outstanding exceptions must
be fixed in underlying records or explicitly accepted with reasons. Accepting an
exception never upgrades the financial result's verification status.

Changed evidence, assumptions, goals, scenario inputs or the UTC review date make
the saved scope stale. Refresh reopens review and relevant tasks. Immutable
sign-off history retains the exact report, inputs, formulas, tasks and identities;
it survives refresh. Current membership is checked for assignments and actions.

Migrations `0083_recognition_links` and `0084_review_operations` add scoped
recognition links, review records, exception tasks, immutable sign-offs and
reviewed payment-day storage. `/api/financial-reviews` supports company-scoped
preview/create, assignment, task updates, submission, refresh and signing.
Creation uses a pinned preview and request UUID; updates require the current
version and reason. Full reports are bounded to 24 MB; history lists return the
latest 100 records, with complete reviews still retrievable by ID.

## Visual cash outlook

Open **Cash outlook & progress** from the workspace (`/progress#cash-outlook`).
The month selector controls opening cash, cash in, cash out, net cash flow,
ending cash, and the category breakdown. Ending-cash and cash-in/cash-out charts
show six months at a time with exact value labels and explicit actual/forecast
labels. Previous/next controls expose the remaining forecast horizon.

**Show spreadsheet** opens a read-only category-by-month table across the entire
horizon, including totals and opening/ending balances. Categories retain approved
driver or expectation labels; actual journals use the counterpart account when
unambiguous. Compound journals appear as “Other / split cash activity” rather
than receiving an invented allocation. Cash transfers are netted per journal
entry using the shared engine's cash-flow calculation.

Every view uses the same captured forecast snapshot. Approved changes appear on
refresh, on returning to the browser tab, or on revisiting the page; proposed and
rejected decisions remain excluded. The current forecast month includes posted
activity plus approved remaining expectations. Reconciliation mismatches,
coverage limitations, and forecast exceptions remain visible. **Inspect
calculation & sources** opens the existing month inspection with formulas,
journals, source documents, expectations, and decisions. **Ask about this month**
drafts a question in the live workspace assistant; the user sends it explicitly.
Responses are generated using the product's existing tools, not prepared demo
answers.

The synthetic cash-explorer tests verify the marketing example: approving a
$20,000 October agreement raises October ending cash from $80,000 to $100,000,
adds $20,000 to subsequent month-end balances, and leaves historical months
unchanged. A database integration test exercises the actual decision approval
and financial-progress read path. No sample agreement or demo amounts are added
to a user's company.
