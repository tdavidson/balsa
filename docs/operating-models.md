# AI-drafted operating models

For the observation, review, adaptive-plan, and simulation implementation history, see the
[operating decision roadmap](superpowers/plans/2026-10-05-operating-decision-roadmap.md).
The sections below describe current behavior.

Open **Operating models** from the workspace or cash progress page, at
`/operating-models`. Describe a decision and the mechanics that matter. The AI
returns a proposed model rather than choosing from a catalog of hard-coded
business workflows. Follow-up instructions revise the current draft.

Review the dated assumptions, relationships, alternatives, and omissions. Edit
input values directly or ask the AI to change the structure. **Calculate and
compare cases** evaluates the operating model and feeds its incremental cash
outputs through the existing scenario/journal forecast engine. Inspect every
variable by month, cash balances, goal outcomes, source references and exceptions.
No draft or preview changes the company's base forecast.

**Save this case as a scenario for review** preserves the definition, selected
operating run, formula versions, base forecast inputs and output, source references,
and goal evaluations in an immutable experiment snapshot. It creates a normal
unapproved scenario, subject to existing Decisions & outcomes approval. Saving
requires acknowledgment of assumptions and potential overlap with existing cash
flows; a stale preview or forecast exception prevents saving. Retries with the
same request key are idempotent. The saved scenario is a frozen cash schedule,
not a live attachment of operating rules to the approved base forecast. Reopen
an experiment's assumptions to revise and recalculate; earlier snapshots remain
unchanged even if the scenario is subsequently edited or approved.

## Execution contract

The runtime accepts structured data, never arbitrary code. Up to 80 scalar
variables use dated inputs, arithmetic, min/max, comparisons, conditional selection,
or an explicit one-month lag. Same-month dependencies must be acyclic. Lag edges
permit state feedback, with an explicit starting value. Every input needs a value
at or before the starting month; missing inputs do not silently become zero.

Values use the shared fixed-decimal arithmetic helpers, with six decimal places
and bounded magnitude. Cash mappings are nonnegative major currency amounts,
rounded to minor units by the shared financial engine's rounding convention.
All cash outputs must carry the company's currency as their unit. Other unit
labels are descriptive; this version does not prove physical dimensional
consistency or infer unit conversions. All intermediate nodes must evaluate
without exceptions in every month. Model-generated cash uses existing active
forecast posting templates; missing mappings remain visible exceptions.

The horizon is 1–24 months within the company's current forecast horizon. Up to
four cash outputs and five named cases are supported. Cases override input
schedules; no probabilities or calibrated distributions are invented. Input and
relationship rationales must distinguish supplied facts from assumptions.
Unapproved or missing support remains provisional. Financial results retain
existing coverage and reconciliation limitations.

## Current limits and next steps

The model receives the user's request, previous draft, reporting currency, and
allowed horizon. It does not automatically read all source documents or derive
behavioral relationships from company evidence. Source IDs attached to definitions
are validated within the company. Generation uses the configured model provider;
provider telemetry is redacted and errors do not expose provider responses.

This version supports monthly scalar graphs, not entity arrays, calibrated
probability distributions, autonomous actors, or automatic retraining. Continuing
cash obligations beyond the operating horizon must be modeled explicitly. An unconnected scenario remains a frozen schedule. Connected models can propose
source-driven replacements using the workflow below; they never silently change
approved financial state.

Tests cover distinct delivery-capacity and inventory-replenishment graphs,
conditional rules, temporal feedback, one-time collections, invalid references,
cycle detection, decimal rounding, historical boundaries, source/company isolation,
immutable snapshots, idempotency, and parity with the existing scenario engine.
Apply migration `0086_operating_experiments` with `pnpm db:migrate`.


## Connected models and reviewed updates

After saving a case, open **Models connected to evidence → Connect a saved
experiment**. For each input to connect, select an approved numeric fact, review
its unit and effective month, and confirm the connection. Connections apply to
that saved case's inputs; the original formulas and other assumptions are
preserved. One connection per input is offered in the UI; the API also supports
multiple explicit effective months. A binding replaces the input step at its
effective month. Later existing input steps still apply. Source facts must be
plain decimal numbers (up to six decimals), with matching currency when present;
there is no inferred conversion or free-text amount parsing.

The page checks source status on opening and every 30 seconds while visible.
**Check sources now** refreshes that status. This is on-demand monitoring, not an
unattended background job. New unrelated documents are not automatically mapped
to assumptions. Missing, deleted, unapproved or incompatible connected sources
block an update; no value silently becomes zero or falls back to an old fact.

**Calculate update** presents source values versus the previous model,
intermediate operating calculations, goal effects, and current-versus-proposed
monthly ending cash. **Save replacement for approval** stores a new immutable
experiment and creates a replacement scenario. It closes superseded pending
scenarios in the same transaction. Neither connecting nor saving changes the
approved forecast. **Reject proposed update** preserves the current forecast and
records a reason. The usual **Decisions & outcomes** flow approves an update and
preserves the applied outlook for later outcome review.

Replacement identifies this model's contributions using the prior applied
decision review and durable decision-application receipts, never label matching.
It ends only the model's still-future items, then generates new future cash
through the same scenario, journal and calculation engine. Actual periods are
untouched. Prior operating periods may be recomputed to carry lagged state into
future months; this is an updated estimate, not a rewrite of actual results.
There is no automatic horizon extension. A model whose horizon has ended needs
new, explicitly reviewed starting conditions.

Approvals revalidate source fingerprints, the latest revision, the prior applied
version, the forecast period and the exact items being replaced. Source rows are
locked during final application. Separately edited scenarios and economic items
are blocked, as are direct promotions that would bypass preserved decision
reviews. Items with reviewed settlement occurrences need separate reconciliation
and a deliberately revised model: ending a driver alone would leave the preserved
obligation in place and could count cash twice. This version does not automate
that settlement-aware replacement.

Connections and revision links are company-scoped and immutable. A snapshot
retains the source fact IDs, values, document names, locations, timestamps,
connection dates and units, model definition, formula versions, replacement
changes, base inputs and output, and goal effects. Source replacements are preserved inside new revision snapshots, while the
original connection stays immutable. Structural model changes require a new
experiment, so earlier assumptions remain inspectable.
Apply migration `0087_operating_connections` before using these routes.


## Decision workbench

The operating model may carry an optional decision brief (old saved models remain
readable). In **Frame the decision**, enter the question, optional deadline,
non-cash constraints, two alternatives, cash comparison metric, and a minimum
month-end cash floor. The unchanged company forecast is always displayed as
**Do nothing**. This means no incremental operating-model cash; it does not set
existing company operations to zero. Named cases remain explicit input schedules,
not probability-weighted scenarios.

Constraints in this brief are review questions, not enforced approval conditions.
Use cash goals and their manual conditions for binding approval rules. Deadline
metadata does not schedule an automation. The workbench compares cash; it does not
claim to determine the best business decision.

Add up to four uncertain input ranges and an effective month. Calculation tests
at most eleven evenly spaced fixed-decimal values per range through the existing
accounting engine. The input is varied in both selected alternatives; subsequent
saved dated steps still take precedence. Other assumptions stay fixed. Invalid
points remain visibly unavailable. Crossings are intervals between sampled points
or sampled ties, never assertions of an exact global threshold. The model may be
non-monotonic and crossings between samples can be missed. These are conditional
sensitivity results, not calibrated distributions or formal value-of-information
estimates.

The results show every alternative, cash-floor outcomes, unresolved non-cash
constraints, monthly cash differences, and each output stream's signed cash
contribution. Changed input schedules and the relationship explorer explain the
modeled mechanisms without asserting independent causal attribution. **What to
verify next** ranks user-selected ranges by their tested impact on the selected
cash metric, with incomplete calculations flagged. Without ranges the app asks
for them rather than inventing uncertainty bounds.

AI-generated variables are marked as suggestions. Direct value edits become user
assumptions. Derived relationships remain assumption-dependent calculations.
Referenced approved documents do not verify an assumed input or behavioral rule.
Recorded historical cash and approved connected facts have separate labels.
The saved experiment includes the decision brief, formula version, range inputs,
samples, comparisons and research ranking along with the financial calculation
snapshot. Changing the brief invalidates a previous preview token.

## Suggested mappings from new evidence

**Suggest connections from recent evidence** is available in the saved-experiment
connection form and for each connected model. It sends only bounded input
metadata and up to 100 recent extracted numeric facts to the configured model
provider. It does not run document extraction itself. Suggestions are limited to
five supplied input/fact pairs, checked against company scope, currency and model
horizon. Source text is treated as untrusted data. Provider failures are bounded
and telemetry is redacted.

Each suggestion shows the source, approval state, proposed effective date, reason
and remaining uncertainty. Pending/rejected sources cannot be used until their
source review is complete. Choosing a suggestion in the initial connection form
only fills the form. Choosing one for an existing connected model calculates an
update preview with a replacement mapping for that input. It replaces that input's
previous source bindings; saved dated assumptions and other input bindings remain.
Users still review and save the replacement scenario, then approve it in Decisions
& outcomes. Source state and calculation freshness are checked again at save and
approval. Rejected revisions do not replace the applied connection mapping.

## Predictions and observed outcomes

Open **Predictions & outcomes → Open approved outcomes** within Operating models.
Approving an operating scenario through Decisions & outcomes now preserves its
original selected operating run, formula version, approval reference, and the
application receipts identifying its cash drivers. Choose an approved prediction
version, metric, and period to inspect the comparison chart and exact-value table.
Earlier approvals can be enrolled with **Track** using their original saved run;
this does not reconstruct predictions with today's model. A scenario edited
separately from its experiment cannot be attributed to that original model.
Historical periods recomputed to initialize a later connected revision remain in
its calculation snapshot but are excluded from its prediction comparison.

Cash observations come from posted journal entries explicitly allocated to the
model's applied forecast occurrences in **Reconciliation**. Installments appear
on their actual posting dates while retaining the originally predicted month.
The view shows remaining obligations, current expected dates, and invalidated
allocations. Reversals, revoked allocations, incompatible movements, and amounts
outside the cutoff follow the existing settlement engine's validation. It does
not match by amount or label, post journals, or change the forecast. No usable
allocation means missing evidence, not zero cash; allocated totals do not prove
complete bank coverage. Payments outside the original forecast horizon remain
visible in the installment detail.

For operational metrics such as available capacity or completed work, select an
approved numeric fact and explicitly confirm its unit, measured scope, month,
and completeness. Capacity and delivered output are separate metrics. The source
value must be a plain decimal; no conversion or aggregation is inferred. A complete
observation requires a finished calendar month. Current-month observations remain
partial, and future observations are rejected. Metrics are scoped to a node in a
preserved prediction; cross-version cohort calibration is not implemented yet.
The source picker includes up to 100 recently updated approved facts.

Confirmation records a sourced observation, not a financial posting or forecast
revision. Differences use exact decimal arithmetic and partial observations are
marked provisional. Missing, withdrawn, changed, or unapproved evidence is
excluded from the current comparison. **Correct this observation** appends a
replacement, and **Withdraw observation** removes a mistaken mapping from the
current comparison without deleting its history. Both require a review note;
concurrent or stale corrections require a refresh.

**Preserve this outcome review** stores the current comparison, prediction,
source snapshots, observation history, settlement details, calculation version,
and note. Saved reviews reopen in the same chart and table view as read-only
records; **Refresh outcomes** returns to current evidence. Source changes and
withdrawals do not rewrite earlier reviews. These comparisons establish observed
differences, not causal attribution, automatic review triggers, or calibrated
probabilities. Settlement-aware replacement of existing obligations remains
blocked as described above.

Apply migration `0088_operating_outcomes` before using outcome tracking. The
migration adds company-scoped prediction, observation, and outcome-review storage
with immutable records. Missing storage produces a migration error rather than
silently disabling tracking. Observations and saved reviews have idempotency keys;
approval and prediction preservation share one transaction.

## Explaining operating differences

Within **Predictions & outcomes**, select a metric and period, then inspect
**Explain the difference**. The bridge compares the preserved prediction with a
replay of the original relationships using complete observations for finished
months. It shows each input's effect in isolation, the interaction between those
changes, and the unexplained remainder against a complete observed result:

`Observed − prediction = isolated input effects + interaction + unexplained remainder`

These terms use the same fixed-decimal arithmetic as the operating evaluator.
They reconcile exactly when a complete, usable output observation exists.
Without one, the remainder and total observed difference remain unavailable.
Partial, withdrawn, or changed-source observations do not substitute inputs.
Derived observations supply comparison targets; they never overwrite formulas.
An input's own bridge records its measured replacement rather than explaining
why that input changed.

Substitutions affect only their measured months. The replay expands the selected
case's original monthly input schedule before replacing observations, preserving
later assumptions and dated steps. Explicit lag relationships may carry effects
into later periods. **Inspect substitution order and conditional effects** shows
a deterministic alphabetical order and the effect of each substitution after the
preceding ones. These conditional allocations depend on order; interaction is
reported separately from isolated effects. Neither calculation establishes a
causal account of the real business.

**Observed inputs used** links each substitution back to its source, measured
scope, observation record, and period. Other assumptions remain intact. The
explanation supports up to twelve observed input variables. If the original
formula version cannot be replayed, the preserved run does not reproduce, or an
isolated or joint substitution is invalid, the explanation becomes unavailable
instead of showing a partial attribution. **Questions to investigate** offers
explicitly labeled hypotheses about missing measurements, scope, relationships,
and unexpected events; it does not invent a cause or call a model provider.

Cash outputs have a separate allocation timing bridge. It splits the original
expectation into a final amount difference and known cash movements between
predicted and posted months. A final amount difference is reported only when all
obligations affecting that month are settled. An open balance is not classified
as a loss. A reviewed final settlement with no allocated cash can establish a
zero outcome for that obligation; absent or incomplete reconciliation cannot.
The comparison concerns the prediction's allocated cash, not all company cash.

**Modeled financial consequences** compares the original approved outlook with
an accounting replay using the observed operating inputs. It removes that model's
original hypothetical cash contributions before generating replacements through
the existing scenario and journal engine, preserving the other financial inputs
as they were at approval. The table shows ending cash and changes in cash in and
cash out. **Inspect accounting trace** shows up to 200 projected journal lines;
the full replay inputs and outputs are retained when the outcome review is saved.

This replay is an explanation against the approved baseline, not today's
forecast, a new approved scenario, or an isolated explanation of actual company
cash. It does not include subsequent decisions or new actual cash activity.
Unsupported accounting mappings, incompatible formula versions, or failure to
reproduce the original financial result prevent financial attribution. Reviewed
settlement obligations are not automatically replaced.

New saved outcome reviews preserve the bridge, substitution inputs, interactions,
residuals, timing analysis, and financial replay with formula versions. Older
reviews without explanations remain readable without being silently recalculated.
No new migration is required beyond `0088_operating_outcomes`.

## Review triggers

In **Predictions & outcomes**, open an approved prediction and choose **Open review rules**. Create a rule for a non-cash operating metric or a calendar review date. Metric rules compare the observed value, or observed minus the preserved prediction, with a threshold and tolerance in the metric's exact units. They require one to six consecutive complete closed months and an exact observation scope match. Above means strictly greater than threshold plus tolerance; below means strictly less than threshold minus tolerance. Boundary equality does not trigger.

Reporting delay is explicit (zero to three months): zero requires the last closed month; one shifts the entire required window back one month. Older evidence cannot become fresh merely by being recorded again. Missing, partial, withdrawn, source-changed, unapproved, or mismatched observations produce **insufficient data**, even when another period is inside the threshold. A calendar rule becomes due on its stated UTC date and makes no claim about business performance. Cash outputs remain in settlement reconciliation and are not accepted as operational trigger inputs.

**Save review rule** preserves a confirmed rule version. **Evaluate** reads current approved observations in one consistent database snapshot, stores the rule, exact evidence versions, comparison inputs, results, and evaluator version, and opens one review for a continuing qualifying episode. Request retries are idempotent; subsequent explicit evaluations retain separate dated receipts while sharing that review. Resolving it does not reopen it on every refresh. A new qualifying episode after a clear or insufficient-data evaluation can open a new review.

Acknowledge, snooze (up to 90 days), and resolve require a review note and revalidate the current event version. Snooze expiry changes the displayed effective status on refresh without overwriting the original receipt. Corrected evidence that no longer qualifies, insufficient evidence, or a rule revision supersedes an unresolved review on evaluation/revision; this does not claim that the business issue was fixed. Resolved receipts remain resolved. A rule revision is a new immutable version. Recent evaluations link to preserved review history, including original evidence and status changes; the workspace shows the latest 20 evaluations per rule.

Evaluation is an explicit user action. **Refresh review queue** only reads the saved state; there is no scheduled or unattended monitoring, notification delivery, forecast application, or business execution. Rules are bounded to 20 current rules and 100 versions per preserved prediction. Each prediction has its own queue and scope. Migration `0089_operating_triggers.sql` supplies immutable, company-scoped rule, evaluation, and event tables. These records do not replace the scenario approval process or write journals.

## Conditional plans, reliability and simulation studies

Decision studies are available beneath a draft preview and inside an approved prediction's Outcomes workspace. The selected prediction provides the same model, case, approval cutoff and owned cash contributions for the study. Overview, Model, Outcomes, Reviews, Studies and History links keep that prediction selected. A draft study instead adds incremental hypothetical cash to the current outlook; check overlap with existing forecasts.

A conditional plan has one to six ordered branches. Each branch specifies a reviewed threshold or calendar condition, zero to six months of lead time, one to twelve months of minimum commitment, dated input changes, an optional one-period switching-cost input and explicit resource limits. The first qualifying branch has priority. Conditions use complete prior periods. Observed comparisons only use observations recorded before each decision month and begin after the prediction's approval month; later corrections cannot justify an earlier decision. Simulated comparisons use the assumed operating path and are labeled accordingly. The timeline preserves the decision cutoff, supporting observations, activation, minimum commitment and blocked conditions. Switching costs are additive to the separately modeled input and restore its planned value the following month.

Preserved conditional studies can prefill a proposal against an open review. Proposals are still assumptions requiring review. `operating_plan_revisions` links the original prediction, trigger review, immutable experiment and ordinary scenario. Preview and approval revalidate current sources, review state, owned drivers, settlement records and forecast period. Rejection leaves the forecast unchanged. Approval retains paid and captured obligations and replaces only owned, uncommitted future contributions. A changed captured obligation remains blocked: use reconciliation to review its remaining amount instead of silently overwriting it. Inherited contributions are carried into the new prediction and removed exactly once during counterfactual variance replay.

Reliability studies require an explicit stable metric identity, node binding, unit, entity scope, monthly aggregation and forecast age. Additional approved versions must be deliberately mapped; matching labels never establish equivalence. Existing observations without this metadata remain unchanged; the study records the author's comparability attestation. Only mature, complete, currently supported measurements at the selected forecast age are scored. Conflicting outcomes, partial data, withdrawn evidence, forecasts approved during the measured month, different horizons and duplicate versions are excluded with reasons. Positive bias means overprediction. Bias, mean absolute error and WAPE use exact decimal arithmetic; WAPE is undefined when observed amounts sum to zero.

A constant-bias proposal requires at least five training outcomes known before the first holdout forecast's approval and three later holdout outcomes at the same forecast age. An adjustment is proposed only if holdout absolute error improves. Sparse history produces insufficient evidence, not confidence. Preserved reports retain every evaluated observation and exclusion, so a later withdrawal changes the current report without rewriting the saved one. A supported adjustment to an input can prefill a normal review proposal for the calibrated future month, with restoration of the original assumption afterward. Derived metrics require review of their upstream inputs. No adjustment modifies universal accounting rules.

Cash reliability uses settled obligations and valid posted allocations. The amount comparison is separate from the table of payment-month delays. Partial or reversed settlements are not complete outcomes. Unrevised, unrevoked obligations use the last allocation's recorded time as the knowledge cutoff; revised settlement histories conservatively use the report cutoff and cannot provide earlier training evidence. Month-level forecasts never imply a day-level due date.

Simulation studies use 16–64 seeded paths, one to eight uncertain inputs, up to twelve explicit entities/cohorts and at most two additional complete structural models. All models use the same horizon, existing input IDs and included source references. Entity node memberships are disjoint; shared or unallocated cash is shown separately and reconciles to total model cash. Demand competition, shared capacity and feedback are ordinary graph dependencies, including explicit lag edges. The existing dimensional forecast model was assessed; studies reuse the bounded scalar operating graph rather than introducing another formula or accounting language. See the [simulation design review](superpowers/plans/2026-10-05-simulation-design.md).

Uniform ranges are user assumptions. A named rank group shares one draw, either in the same direction or its inverse; empty groups are independent. This is not an estimated correlation matrix or an empirically calibrated distribution. Every supported path runs through the existing financial engine. Failed paths remain visible, and summaries explicitly describe only supported paths. Structural models are reported separately without inferred weights. Views include monthly P05/median/P95 cash, exact tables, threshold counts, quantile bands, a first-half/full-sample convergence check, noncausal rank associations and downside/median/upside path inspection. Each path retains assumptions, formulas, entity cash, monthly balances and projected journals.

Optional valuation names a cash-flow node in the reporting currency and requires an explicit enterprise/equity cash-flow basis. It discounts end-of-month flows to the start of the model using nominal annual discount divided by twelve, then adds an explicit multiple of annualized final-month cash flow. The exact discount trace is preserved. The closest sampled combinations to an entered price are shown; price does not identify a unique distribution. Debt, taxes, terminal growth or other adjustments must be represented explicitly in the chosen model and stated basis.

Studies are company-scoped, immutable, idempotent analytical records in `operating_studies` (migration `0091`; revision links use `0090`). Saving rechecks the preview and never posts or changes a forecast. Snapshots are limited to 16 MB; request size, sampling, graph dimensions, entities and model counts are bounded. API failures redact internal details and name missing migrations. Original study results are read as preserved instead of being regenerated with newer formulas. No unattended trigger scheduler, automatic retraining, empirical distribution fitter or external business execution is included.

## Relationship to the Standard model and workbooks

[Forecast drivers](forecast-drivers.md) and [Standard statements](standard-statements.md)
serve the company forecast and its workbook export. Operating studies serve a
particular decision: their cases, observations, calibration, and sampled runs
remain reviewable records. Both reach financial results through the shared
journal/forecast engine, but their authoring models and metric records are distinct.

Saving an operating case creates a frozen scenario for approval, not a live
binding from the study into the company model. The workbook's Model sheet exports
the company forecast model; it does not export an operating study's simulation
runtime, adaptive policies, or calibration history. Returned workbook edits target
supported forecast inputs and still require decision approval. See the
[Standard model review](standard-model-review.md) for current interchange controls and limits.
