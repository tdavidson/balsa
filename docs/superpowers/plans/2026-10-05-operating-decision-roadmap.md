# Operating decision roadmap

Status: the bounded implementation and gap review are complete in the working tree, October 5, 2026. Standard verification, accounting acceptance and local company isolation passed. Real-browser visual validation and authenticated second-user isolation remain unverified as detailed below.

Implemented: immutable predictions tied to reviewed approval; sourced operational observations and append-only corrections or withdrawals; settlement-backed cash observations; charts, exact-value tables, source inspection, and saved read-only outcome reviews. Migration `0088_operating_outcomes` is included. Collection timing and delivery capacity share the generic contracts. Existing approved numeric facts supply operational observations; automatic observation extraction is not included.

Phase 2 implemented: exact operational bridges with isolated effects, interaction, and an unexplained remainder; explicit month-only input substitutions; settlement amount and timing analysis; source drill-down; and a financial replay using the approved baseline's accounting inputs. New outcome reviews retain these calculations. Older reviews are not reinterpreted. Explanatory text is deterministic; investigation prompts are labeled hypotheses. The financial replay does not apply a new forecast.

Phase 3 implemented: reviewed threshold and observed-minus-predicted rules with exact tolerance, one to six consecutive closed months, and an explicit reporting delay; calendar review dates; immutable evaluations and evidence receipts; acknowledge, snooze, resolve, supersede, and rule revisions. Explicit Evaluate actions run the rules; refresh only reads queue state. No scheduler or automatic financial update is enabled. Cash outputs remain in reconciliation; this first trigger slice targets reviewed non-cash observations. Migration `0089_operating_triggers` is included.

Phase 0 progress: the initial prediction and observation contracts are implemented, and rollover tests now restrict processing to their own companies, resolving the shared-database release-gate race. Settlement-aware revision preserves captured obligations and allocated actuals, replaces only owned uncommitted future contributions, and blocks changes to captured amounts pending explicit reconciliation. Calibration records explicit metric identity, units, scope, aggregation and forecast age; cross-version equivalence is reviewed rather than inferred.

Balsa should let someone describe a decision, inspect an AI-drafted operating model, compare alternatives, approve a plan, and learn from its results. The reusable product is the structure for doing that across businesses. AI proposes the variables, relationships, evidence mappings, and explanations; deterministic code owns calculations and approved financial changes.

The next release should complete the observation and review loop. Subsequent releases can support conditional plans and richer simulations on that same foundation. Building each workflow as a separate application would undermine this goal.

## The user experience

A user asks, “Should we hire, outsource, or wait if demand keeps growing?” Balsa drafts a model linking demand, available capacity, delivery, collections, costs, and cash. The user reviews the assumptions and sources, compares alternatives including doing nothing, and sees what would change the decision.

When approving an alternative, the user also chooses what to track and when to reconsider. As evidence arrives, the workspace shows expected versus observed results, missing data, and the effects on cash. A material difference opens a review with an explanation and proposed alternatives. Accepting a revision updates future financial state through the existing approval flow and preserves the previous prediction.

The primary navigation within a decision should be Overview, Model, Outcomes, Reviews, and History. Each view shares the same selected model version, period, alternative, and evidence cutoff. Chat helps the user navigate and propose changes, and links to these inspectable views.

| View | What it helps the user understand |
| --- | --- |
| Overview | Current decision, approved plan, cash implications, and outstanding reviews |
| Model | Editable assumptions, dependencies, sources, alternatives, and a read-only calculation table |
| Outcomes | Expected versus observed values, timing differences, completeness, and forecast versions |
| Reviews | Why attention is needed, competing explanations, alternatives, and proposed changes |
| History | What was known, predicted, approved, rejected, and subsequently observed |

Charts need exact values, accessible table equivalents, units, actual/forecast distinctions, missing-data gaps, and source drill-down. Selecting a point should expose its formula, inputs, and evidence. Richness comes from making the same information useful at several levels of detail.

## Existing foundation

The current working tree contains generic monthly operating graphs, AI drafting and refinement, immutable experiment snapshots, scenario approval, evidence connections, reviewed source updates, decision briefs, comparison with doing nothing, sampled sensitivity analysis, and a relationship explorer. See [the operating model documentation](../../operating-models.md) for current behavior and limits. The release checks below cover this working tree; deployment is a separate action.

Reuse the existing journal engine, scenario machinery, decision reviews, forecast occurrences, and settlement allocations. Current sensitivity samples are not probability distributions. Connected models currently block replacement of drivers with reviewed settlement occurrences; resolving that safely is a prerequisite for adaptive updates to those models.

## Shared contracts

Define these contracts before adding separate screens or workflow-specific storage. Names below describe proposed concepts, not finalized database tables.

| Concept | Required information and responsibility |
| --- | --- |
| Decision | Stable company-scoped identity, question, alternatives, constraints, owner, review dates, and links to existing approvals |
| Model version | Immutable graph, assumptions, source bindings, formula versions, and predecessor; structural changes create a version |
| Prediction | Model version, approval reference, metric, entity scope, unit, period, predicted value, and knowledge cutoff |
| Observation | Metric, entity scope, unit, measured period, recorded time, source, approval state, completeness, and correction history |
| Observation binding | Explicit mapping between an observation and a predicted metric, including aggregation and matching rules |
| Outcome review | Prediction and observation versions, deterministic differences, data gaps, explanation evidence, and unresolved residual |
| Review rule | Versioned predicate, evaluation window, data requirements, tolerance, cooldown, and lifecycle |
| Conditional plan | Reviewed alternatives, branch conditions, temporal state, commitments, and approval requirements |
| Calibration report | Eligible historical predictions, scoring method, exclusions, sample size, coverage, and proposed assumption revisions |

Keep evidence, operating observations, and financial state separate. A measured delivery count is not a journal entry. A predicted receipt is not actual cash. Financial observations use existing posted journal and reconciliation records; operational observations retain their own approved evidence.

Missing values must remain missing. Record partial coverage explicitly. Distinguish when something happened from when Balsa learned it. Corrections supersede observations without erasing prior reviews. Reopening an old review must reproduce its original information cutoff; a current view may separately flag withdrawn evidence.

AI output stays bounded and schema-validated. No generated executable code. All reads, writes, source references, and background evaluations remain company-scoped and auditable. Every financial result retains inputs, output, formula version, and lineage.

## Implementation sequence

### Phase 0 Consolidate contracts and release readiness

- [x] Map current experiments, connections, scenarios, application receipts, and outcome reviews to the shared contracts. Introduce only missing storage and use migrations with backward-aware loading.
- [x] Specify stable metric identity, units, entity scope, period aggregation, and prediction cutoff semantics. Preserve old saved models that have no tracking metadata.
- [x] Specify settlement-aware replacement: retain allocated actuals and existing obligations, explicitly reconcile remaining amounts, and prevent duplicate cash when a future driver is replaced. Keep unsupported replacements blocked until this passes accounting acceptance.
- [x] Establish a reproducible verification baseline and resolve test isolation or serialization failures before treating the release gate as green.

Exit gate: a reviewed contract and synthetic fixtures show how both collection timing and delivery capacity fit the same model; no new parallel accounting engine is needed.

### Phase 1 Track predictions against observations

- [x] Freeze selected metric predictions when an existing decision is approved. Store enough context to reproduce them; do not retrospectively regenerate the original prediction from current sources.
- [x] Add explicit observation mapping and review, including sourced manual observations where no integration exists. AI may suggest a match; a number with a similar label is insufficient evidence.
- [x] Implement collection tracking from existing forecast occurrences, posted actuals, and settlement allocations. Show partial, late, reversed, unmatched, and unresolved amounts. Do not infer day-level timing errors from a monthly prediction.
- [x] Implement operational tracking with delivery capacity and completed work as distinct metrics. Require units, scope, period, and approved evidence; revenue is not a substitute for capacity.
- [x] Add Outcomes charts and tables with prediction versions, observed coverage, missing periods, source inspection, and links to settlement details.

Exit gate: a synthetic predicted $20,000 October receipt, allocated as $12,000 in October and $8,000 in November, shows the timing shift without duplicating cash. Reversal changes the current observation view while preserving the original prediction and saved reviews. A delivery case uses the same observation contracts without bespoke engine logic.

### Phase 2 Explain differences and their financial effects

- [x] Compute deterministic amount and timing differences for compatible, sufficiently covered observations.
- [x] Where the graph permits it, substitute observed inputs into a preserved model to explain quantity, rate, and timing effects. Record the substitution order and interaction effects; retain an explicit unexplained residual.
- [x] Separate calculation-backed explanations from hypotheses about unexpected events, missing mechanisms, or source quality. AI can draft a narrative with references but cannot convert a hypothesis into an established cause.
- [x] Add a variance bridge, input drill-down, and comparison of the original forecast with a proposed revised outlook. Incomplete evidence remains visible.

Exit gate: displayed contributions plus residual reconcile to the displayed difference. Nonlinear interactions and missing observations do not produce falsely precise causal explanations. Reviewing an outcome does not change the approved forecast.

### Phase 3 Open reviews when conditions change

- [x] Support a bounded rule language over approved observations and deterministic results: threshold, consecutive periods, tolerance, and overdue review date.
- [x] Require coverage and freshness conditions. Missing evidence produces an insufficient-data state instead of a false business trigger.
- [x] Add durable, idempotent evaluations and an in-app review queue with acknowledge, snooze, resolve, and supersede states. Store the exact rule and evidence versions that caused each review.
- [x] Start with explicit evaluation on refresh and scheduled evaluation only after job ownership, retries, deduplication, and observability are implemented. Do not imply that an open-page polling mechanism runs unattended.

Exit gate: two qualifying periods create one review; repeated processing creates no duplicate. Corrected evidence produces an auditable status change. A trigger never applies a scenario or initiates a business action.

### Phase 4 Support conditional operating plans

- [x] Represent a plan such as “outsource first; reconsider hiring after demand exceeds capacity for two complete periods” using bounded temporal rules and the existing operating evaluator.
- [x] Distinguish simulated branches from branches supported by actual observations. Evaluate each branch using information available at that point; prevent future observations from influencing earlier decisions.
- [x] Model lead times, minimum commitments, reversal costs, and resource limits as explicit assumptions. Preview cash and operating outcomes for each alternative through the same journal engine.
- [x] Connect triggered reviews to proposed plan revisions. Application revalidates sources, the current approved version, settlement state, and the exact changes being replaced.
- [x] Add a branch timeline showing conditions, observed evidence, approval state, and future commitments.

Exit gate: a qualifying observation opens a proposed branch change. Rejecting it leaves the approved plan intact. Approving it changes only authorized future state, preserves historical actuals, and passes the settlement replacement acceptance tests from Phase 0.

### Phase 5 Evaluate assumption reliability

- [x] Score matured predictions against adequately covered observations using appropriate errors for amount, timing, and operational metrics. Keep incomparable units and forecast horizons separate.
- [x] Show bias, sample size, coverage, excluded observations, and forecast age. Prevent overlapping versions of the same outcome from inflating the apparent independent sample count.
- [x] Use time-separated evaluation for proposed calibration changes. Show insufficient evidence when history is sparse; do not invent a confidence score.
- [x] Suggest scoped assumption or range revisions, with supporting outcomes, through the normal review process. Keep universal accounting rules unchanged.

Exit gate: a synthetic persistently optimistic collection assumption is visibly identified, but the proposed adjustment remains unapproved. Correcting or withdrawing an observation changes the current report without rewriting earlier reports.

### Phase 6 Expand to interacting entities and uncertainty

This phase carries the original simulation ambition forward. It depends on trustworthy versioning, observation semantics, and evaluation; it is not required to ship the first observation release.

- [x] Add bounded entity and cohort models for stores, customers, teams, or products. Assess reuse of the existing dimensional formula model before extending the scalar operating graph; avoid competing formula languages.
- [x] Represent shared constraints and feedback explicitly: stores compete for local demand, teams share capacity, pricing changes demand, and competitors respond according to inspectable assumptions. Interactions occur among modeled entities and state within a simulated path; separate hypothetical worlds do not need to affect one another.
- [x] Add reproducible sampled runs with stored seeds, joint assumptions and correlations, parameter sources, and strict compute limits. Process each path's financial effects through the existing calculation engine.
- [x] Distinguish user-assumed distributions from empirically evaluated ones. Expose structural model alternatives as well as parameter uncertainty, convergence checks, and sensitivity to assumptions.
- [x] Add outcome distributions, downside cases, clusters, branch explanations, and representative path drill-down. Every summary links back to reproducible runs and accounting results.
- [x] For an investing workflow, add an explicit valuation layer and reverse scenarios showing which combinations could support an entered market price. Discount rates and valuation assumptions remain visible; price does not identify a unique implied distribution.

Exit gate: a synthetic multi-store expansion model demonstrates cannibalization and a shared resource constraint, reconciles entity totals to company cash, reproduces runs from saved seeds, and exposes how changing a behavioral assumption changes the distribution. A second domain proves the primitives generalize.

## Dependencies and delivery boundaries

Implement Phases 0 through 5 in order. Settlement-aware replacement can be developed alongside observation tracking but must pass before applying adaptive updates to affected drivers. Phase 6 needs a separate design review and performance budget after the earlier contracts are proven.

Ship complete slices rather than all storage first and all views later. Each phase includes its UI, trace, approval behavior, tests, migration where needed, and documentation. The first slice is collection timing plus delivery capacity: one financial and one operational metric exercise the generic contract without a catalog of workflow-specific features.

Avoid expanding the first release into arbitrary agent simulations, automatic model retraining, external business execution, or automatically inferred probability estimates. These require their own validated contracts. The roadmap preserves room for them without making early delivery depend on them.

## Implementation locations

| Area | Starting points |
| --- | --- |
| Pure graph and comparisons | `packages/finance-engine/src/operating-model.ts`; proposed pure observation comparison and rule evaluators |
| Versioned snapshots and approvals | `apps/web/src/lib/operating-models.ts`, `operating-connections.ts`, `operating-connection-state.ts`, and `goal-decisions.ts` |
| Financial observation and replacement | `apps/web/src/lib/forecast-reconciliation.ts`, `forecast-settlement-load.ts`, and existing settlement engine |
| Persistence | `packages/database/src/schema.ts` and next available checked-in migrations; composite company-scoped references |
| Product views | Existing `/operating-models` route and operating components; shared decision and source inspectors |
| Documentation | `docs/operating-models.md` for shipped behavior; this roadmap for sequencing and completion status |

Confirm current interfaces before each phase. Reuse existing outcome-review storage when its semantics fit; do not create a second approval system merely to satisfy the proposed names above.

## Verification and completion

Use synthetic fixtures only. Each phase needs pure calculation tests, service integration coverage, and browser checks of its complete user flow. Include missing observations, partial periods, incompatible units, source withdrawal, reversal, stale previews, rejected updates, concurrent approvals, retry idempotency, and cross-company access where applicable.

For substantial implementation, run `pnpm run verify`. Run `pnpm acceptance` for accounting, reconciliation, or calculation changes and `pnpm isolation` for company-scoped routes and authorization changes. Include migrations and material migration tests. Report blocked checks explicitly; passing a narrower or sequential suite does not establish that the standard release gate passed.

Product acceptance is one continuous demonstration: describe a decision, inspect its assumptions and alternatives, approve it, ingest or enter observed evidence, explain the miss, open a review, compare a conditional revision, reject or approve it, and inspect the preserved history. Every view must agree on values and approval status. The user must be able to answer “What changed, why, and what should I review?” without reconstructing the model from chat.


## Completion notes and bounded scope

Phase 4 adds inspectable conditional timelines and normal approval proposals. Captured obligations are retained, not automatically rewritten. Phase 5 adds explicitly matched reliability cohorts, temporal holdouts, scoped input proposals and immutable evidence receipts. Different forecast ages are scored in separate studies; sparse or temporally unsupported histories remain insufficient. Phase 6 adds explicit entity/cohort membership, graph interactions, seeded joint ranges, separately inspected structural models, journal-backed sampled paths, exact distribution tables, sensitivity diagnostics and valuation/reverse scenarios. The separate design review records compute and snapshot limits.

Contract mapping: a company-scoped operating experiment is the immutable model version; a scenario and goal decision review are its approval/application records; connections and plan-revision parent links retain lineage; predictions freeze the approved case; observations retain source/mapping/correction history; trigger evaluations and review events retain decisions to reconsider; analytical studies preserve conditional plans, calibration reports and simulations. A calibration metric identity is an explicit scoped binding in the saved study, never an automatically inferred global metric name. Legacy models and observations are preserved without retroactive tracking metadata.

The gap audit added inherited-contribution variance regression coverage, explicit approved versus unapproved closed proposal states, additive switching-cost pulses, retained lead-time evidence, whole-period and forecast-age calibration exclusions, training knowledge cutoffs, conflicting-observation rejection, evaluated-observation preservation in preview hashes, source receipts, failed-path visibility, immutable-study proposal links and company-scoped study isolation checks. All studies remain analytical until an ordinary scenario is reviewed and approved.

Deliberate limits: monthly rather than daily liquidity; explicit trigger evaluation rather than unattended scheduling; user-assumed uniform ranges rather than fitted empirical distributions; perfect same/inverse rank groups rather than an inferred correlation matrix; exact graph-based entity interactions rather than arbitrary executable agents; conservative cash-history calibration when settlement knowledge cannot be reconstructed. These limits are visible in the product.

Verification: `pnpm run verify` passed with 666 tests across the workspace, typechecks and the production build. `pnpm acceptance` passed ingestion, finance-engine and Company Zero accounting checks. `pnpm isolation` passed all 18 checks in disabled-auth local mode; second-user checks were explicitly skipped and require a better-auth test environment. DOM checks passed the conditional builder, exact branch/cash/journal views, downside path inspection, confirmation and read-only preservation flow. Chrome cannot launch in this sandbox, so real-browser visual inspection remains unavailable; this is not represented as a passing browser check. Web test workers are capped at four after default concurrency caused worker-startup timeouts; no tests were skipped to pass the release gate.
