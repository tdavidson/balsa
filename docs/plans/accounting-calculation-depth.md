# Accounting calculation depth plan

## Purpose

The financial calculation graph is now a deterministic, source-aware cash,
forecast, P&L, balance-sheet, and cash-flow foundation. This plan deepens it
into an accounting calculation system that can ingest heterogeneous financial
evidence, post a reviewable accounting model, and explain every reported
number from source row through formula.

```text
documents, files, integrations
            ↓  (model-assisted interpretation)
facts, source rows, proposed mappings
            ↓  (CFO approval + deterministic posting)
chart of accounts, journals, subledgers, periods
            ↓  (deterministic calculation graph)
statements, forecasts, scenarios, reconciliations, trace
```

The model proposes interpretation. It never creates accounting truth or
performs reported arithmetic. The deterministic layer owns posting, roll-up,
calculation, controls, and presentation of verification status.

## Design principles

- Preserve raw source data, extracted facts, mappings, postings, and
  calculations as separate layers. Never overwrite evidence with a derived
  result.
- A journal posting is immutable after approval. Corrections are reversing or
  adjusting postings, not edits to history.
- Every stored monetary amount carries currency and uses integer minor units
  internally. FX policy and rates are explicit source-backed inputs.
- Every calculated figure identifies its formula version, calculation run,
  direct input nodes, source facts/rows, approval, account, entity, and period.
- Source summaries and YTD totals are evidence only; they cannot enter the
  transaction ledger without an explicit posting rule.
- Bank and brokerage activity prove cash; general-ledger detail proves
  recognition. The system must not collapse those evidence roles into one
  transaction stream.
- A missing proof creates an exception or an unverified result. It does not
  become a guessed balance.
- Actuals, forecasts, scenarios, eliminations, and derived presentation
  translation use one entry model and one deterministic calculation graph.
  Their basis is explicit: `actual`, `forecast`, `scenario`, `adjustment`,
  `elimination`, or `translation`.
- Scenarios are additive overlays with their own assumptions and runs. They
  cannot mutate actual entries or the base run.

## Scope and sequencing

Work is deliberately sequenced. Do not add broad integrations or multi-user
complexity until the single-company accounting loop is reliable.

## Current implementation status (2026-09-11)

The Phase 1 substrate and the first Phase 2/3 transition controls are built:

- Chart accounts, immutable journal batches/entries/lines, posting proposals,
  posting rules, idempotency, reversals, opening-balance conversion, and
  closed-period protection exist in the database and posting service.
- Posting validates integer minor units and balance by currency *and entity*.
  It verifies company-scoped provenance and requires an approved evidence/fact,
  applied decision, approval event, or active policy on every line.
- A cash event can create an explicit proposal, or exactly one approved posting
  rule can draft one. Unmatched and overlapping rules remain review exceptions.
  Transfer, investment, and financing activity cannot post to revenue or expense
  without an explicit policy.
- Trial balance and conventional journal-native statement roll-ups are available
  as unverified entry-graph APIs. They retain source/fact/decision/approval
  lineage, separate currencies, include unclosed earnings in equity, and keep
  unmapped contra accounts visible rather than guessing their presentation.
- Imported transaction files now persist immutable normalized source rows. The
  derived cash event, proposal, and journal line can retain that exact-row
  lineage; source rows transition between staged and approved with evidence
  publication and are never discarded merely because an interpretation changes.
- Typed adapters now distinguish bank/brokerage activity, QuickBooks
  transactions, general-ledger detail, balance-sheet/P&L facts, agreements,
  and invoices. Their row type and (for statement facts) exact fact lineage are
  persisted. General-ledger evidence cannot publish cash actuals merely because
  it contains debit/credit values.
- Rule reprocessing has a deterministic preview: it classifies each persisted
  source row before writing anything and preserves the exact rule snapshot that
  produced an automated proposal. A rule edit therefore becomes a visible diff,
  not a silent rewrite of prior accounting interpretation.
- The journal transition now has a deterministic monthly control report:
  approved source row → actual cash event → posted cash line coverage, source
  amount agreement, trial-balance balance, and balance-sheet equality. A period
  remains explicitly unverified until those controls pass.
- Strict account-level reconciliation compares journal account balances only to
  exact, approved statement-fact rows. An approved, versioned account-balance
  mapping can deliberately bridge a source-row label to a chart account;
  unmapped labels and mismatches remain exceptions and block authority
  eligibility. It never uses fuzzy matching to make a balance look reconciled.
- A journal-native calculation graph now turns posted journal lines into
  account balances, conventional statement lines/totals, and explicit trial
  balance, balance-sheet, source-to-ledger, and account-reconciliation control
  nodes. The graph is immutable, idempotently persisted by financial-state
  revision and journal formula version, and is available without recalculation
  through the ledger calculation API.
- Journal posting and approved source-row mappings advance the company's
  financial-state revision. A period-aware calculation outbox now queues an
  affected journal period and dispatches only the journal calculation graph.
  For a non-posting mutation, it safely rebuilds every posted period in this
  single-company deployment. Former event-engine jobs are superseded rather
  than executed. A manual period calculation remains available for inspection
  or recovery.
- The Accounting modal exposes the journal-native statements, trial balance,
  posted journal register, reconciliation controls, and persisted calculation
  graph. Each graph node exposes formula, result, dependencies, journal-line
  count, and verification reasons; it is deliberately not presented as
  authoritative until the promotion gate is satisfied.
- A fresh deterministic promotion gate can now declare a period *eligible for
  CFO review* only when its coverage and accounting controls pass. CFO
  promotion persists an immutable period record pinned to the exact journal
  calculation run, financial-state revision, and promoting user. It does not
  close the period; close remains a separate explicit control.
- Period close now has a durable checklist and immutable close record. It
  requires the promotion plus the same live reconciliation controls, closes
  the reporting period, and schedules a fresh calculation run. The legacy
  month command now uses that same service, so it cannot bypass the controls;
  a closed period cannot be reopened. Normal postings are rejected afterward;
  only explicit adjustment or reversal postings can affect it.
- Company mappings now begin as drafts. Activation is a separate, auditable
  approval action requiring an applied decision or active policy; mappings can
  carry effective dates and supersede an earlier approved mapping.
- Source-row trace is available as a single deterministic chain—normalized row,
  derived cash event, applied rule snapshot, proposal, and posted journal
  lines. The Accounting journal register exposes that same chain directly from
  a posted line; the base calculation trace already links graph provenance to
  its source document.
- Journal-native direct cash flow now groups actual posted entries, links every
  section to its cash journal lines, and prefers the explicit chart-account
  cash-flow category. A legacy inference is named unverified; conflicting or
  absent classifications remain exceptions rather than quietly becoming a
  trusted category.

Still outstanding before journal statements can become authoritative:

- representative-company acceptance testing with clean, individual account
  statements, transaction detail, and GL evidence; and
- adding a redacted regression fixture for each material discrepancy found in
  that acceptance run.

The code-level intake floor now accepts common bank and GL export aliases
(`posted date`, `money in/out`, `GL account`, plural debit/credit headings),
preserves source locations, and rejects ambiguous value columns rather than
silently inventing activity. FX, entities/eliminations, scenario basis, and
the local deterministic evaluation runner are implemented; their real-company
acceptance fixtures remain the next evidence step.

## Current finishing sequence

1. **Completed:** working-capital roll-forwards and the cash-to-bank statement
   control now derive directly from approved evidence and posted cash accounts.
   A tied control is verified; missing, invalid, or mismatched statement cash
   blocks authority and appears in both the graph and Accounting controls. The
   chart has a dedicated working-capital category field as the deterministic
   classification input (rather than relying on account-name heuristics).
2. **Completed:** formal retained-earnings close workflow. It prepares and
   posts one balanced, immutable entry per promoted period, records exact
   many-to-many upstream journal-line lineage, keeps pre-close operating P&L
   visible, and separates designated retained earnings from unclosed earnings
   in the balance sheet. The chart also carries an explicit current/non-current
   classification for asset and liability accounts, which drives the
   traditional balance-sheet view; unclassified accounts remain visible rather
   than being guessed.
3. **Completed for journal statements and forecast:** the shared inspector
   supports actual, projected, and scenario traces and is available from the
   primary statement views and projected-entry previews. During acceptance,
   add it to any remaining bespoke consolidated or reconciliation amount
   rather than creating a second drill-down contract.
4. **In progress, with deterministic baseline:** the fixture corpus now
   covers realistic bank and GL headers, source location, opening cash,
   transfers/capital, forecast-before-close, statement provenance, FX, and
   graph/recovery controls. Each material acceptance discrepancy must add its
   redacted fixture before the owning logic changes.
5. Add the Chart of Accounts workspace to Accounting: users can create,
   edit, deactivate, and delete unused accounts. Referenced accounts retain
   historical integrity: deleting deactivates them, and changing accounting
   treatment requires a successor account rather than rewriting old postings.
6. Introduce entry basis and scenario identity on the journal model, then
   convert approved forecast drivers into balanced projected entries before
   switching main-page reporting to the unified graph.
7. Require an approved forecast-entry template—driver type, direction,
   category, debit account, and credit account—before any agreement or
   obligation can generate projected entries. Missing mappings remain visible
   exceptions, never guessed postings.
8. Treat the former cash/event calculation only as disposable migration input.
   Its results are known to be unreliable and must never be compared to,
   displayed beside, or used to certify or block the entry graph. Graph
   authority comes solely from source-to-ledger coverage, account
   reconciliation, cash controls, and graph invariants.

   **Completed:** the former forecast, P&L, statements, simulation, automatic
   outbox, and trace endpoints no longer run or persist event-engine output.
   They are retired with an explicit migration response; the trace compatibility
   endpoint now resolves only journal calculation graphs.

### Phase 1 — Authoritative accounting state

**Build**

- Chart of accounts with account type, normal balance, statement presentation,
  cash-flow classification, entity ownership, and active dates.
- Journal batches, journal entries, and balanced journal lines. Lines carry
  account, entity, minor-unit amount, currency, posting date, period,
  source/fact/mapping/decision provenance, and optional reversal linkage.
- A posting proposal layer between interpreted cash events/economic items and
  approved journals. Models draft proposals; deterministic validation and CFO
  approval create postings.
- A period-close protocol: no mutation of posted lines in a closed period;
  only explicit adjustments or reversals may affect it.
- An opening-balance conversion workflow that creates a balanced opening batch
  rather than relying on standalone opening-position values.

**Controls**

- Every journal entry balances by currency and entity.
- Every posted line is tied to approved evidence, an approved decision, or a
  named opening/adjustment policy.
- Idempotency keys prevent a source row from being posted twice.

**Done when**

> A CFO can inspect a posted line, see why it was posted and from what source,
> and trace it to a balanced entry and a chart-of-account classification.

### Phase 2 — Ingestion-to-posting pipeline

**Build**

- Typed source-row adapters for bank/brokerage activity, QuickBooks general
  ledger and transaction detail, P&L, balance sheet, agreements, and invoices.
- Mapping records that link source rows/facts to a proposed journal template;
  mappings learn company-specific counterparties, accounts, treatments, and
  effective dates only after approval.
- Deterministic duplicate and overlap resolution across source systems: bank
  activity proves cash, the GL proves recognition/posting, and statements prove
  balances. One source never silently replaces another.
- A reconciliation work queue that groups conflicts by root cause rather than
  emitting a question for every row.

**Controls**

- Rejected, pending, duplicate, summary, and YTD facts are excluded from
  posting by default.
- Imported source row, mapping version, and posting proposal remain visible on
  the resulting journal lines.
- Reprocessing is idempotent and produces a diff of proposed changes rather
  than quietly changing approved state.

**Done when**

> A new file can be processed into source rows, proposals, grouped exceptions,
> and approved postings without confusing cash activity for recognized revenue
> or expense.

### Phase 3 — Ledger and statement calculation graph

**Build**

- Replace all statement, forecast, and scenario derivation from event
  categories with entry-backed journal-ledger roll-ups in one calculation
  graph. The existing cash/event engine is migration-only: convert its
  approved drivers into projected entries, then remove it from reporting.
- Graph nodes for trial balance, each account balance, statement line,
  recognized revenue, working-capital roll-forward, cash-flow adjustment,
  intercompany elimination, and consolidated result.
- Formal financial-statement layouts: traditional assets, liabilities, and
  shareholders’ equity; income statement; direct and indirect cash flow.
- Account-level reconciliation nodes that compare ledger balances to approved
  statement balances by account and period.

**Controls**

- Trial balance is zero by currency, entity, and period.
- Assets equal liabilities plus equity after consolidations and eliminations.
- Cash ledger roll-forward agrees with reconciled bank activity and statement
  ending cash, or explicitly names the difference.
- Revenue/expense postings cannot use transfer, investment, or financing
  templates unless an approved accounting policy explicitly allows it.

**Done when**

> Every statement total is a graph node composed from journal-line nodes, and
> the trace can move from a displayed number to account, posting, fact, and
> source row.

### Phase 4 — Currency, entities, and consolidation depth

**Build**

- Currency metadata on every source, fact, mapping, journal line, account
  balance, and calculation input.
- Source-backed FX rates and an explicit translation policy: transaction-date,
  average-rate, or closing-rate as appropriate to the statement line.
- Foreign-currency gain/loss postings and remeasurement at period end.
- Entity-specific books, ownership/relationship rules, intercompany due-to/
  due-from matching, and elimination journal proposals.
- Consolidation views that retain both local-currency and reporting-currency
  traceability.

**Controls**

- A calculation cannot combine currencies without a named FX rate and policy.
- Every intercompany elimination has matched source postings or is an exception.
- Consolidated results expose elimination nodes separately from operating
  results.

**Done when**

> The same calculation can be reproduced per entity and in consolidation, with
> every translated amount showing its rate, policy, and original currency.

### Phase 5 — Scenario and forecast depth

**Build**

- Versioned scenario assumptions with driver type, owner, effective dates,
  source/decision provenance, and approval status.
- Projected entries with the same account, entity, currency, period, lineage,
  and recognition mechanics as actual journal entries, marked with an explicit
  `forecast` or `scenario` basis rather than maintained in a separate engine.
- Explicit overlays for volume, pricing, timing, headcount, collections,
  payment timing, and FX—not generic model-generated amounts.
- Base-vs-scenario graph comparison: changed nodes, changed inputs, monthly
  deltas, and drivers of variance.
- Forecast-to-actual bridge that replaces only the relevant driver/event as
  evidence arrives while retaining the original forecast and variance history.

**Controls**

- Scenario entries are stored separately from actual entries and never appear
  as actual or base-case evidence.
- A scenario run identifies each changed assumption and its downstream nodes.
- Actuals cannot be overwritten by a forecast refresh.

**Done when**

> A CFO can ask “what changed?” between base and scenario, or forecast and
> actual, and see the precise assumptions and source-backed events responsible.

### Phase 6 — Trace, review, and operating controls

**Build**

- A universal “inspect this number” interaction for statements, forecast,
  reconciliation, and scenario views. It opens the same graph trace rather
  than separate, inconsistent drill-downs.
- Trace views for formula, inputs, journal postings, source document/page/row,
  extracted fact, mapping/policy, decision/approval, invariant results, and
  calculation-run metadata.
- Exception lifecycle: owner, severity, source links, suggested resolution,
  CFO answer, resolution posting, and re-run result.
- Period-close dashboard showing unresolved reconciliations, unverified
  figures, stale calculation runs, and changes after close.

**Done when**

> A CFO can audit any figure without leaving Nevermodel or asking the model to
> reconstruct its reasoning.

### Phase 7 — Evaluation, migration, and reliability

**Build**

- Expand `@nevermodel/accounting-evals` into a redacted, versioned corpus for
  extraction, mapping, posting, reconciliation, statements, scenarios, FX,
  consolidation, and review workflows.
- Add deterministic fixture metrics: row/source-location coverage, mapping
  precision, balanced-entry rate, reconciliation differences, invariant pass
  rate, source-to-figure trace coverage, and forecast error.
- Add migration/replay fixtures that prove a saved financial-state revision
  replays to the same calculation output and trace.
- Add load, retry, and failure tests for the calculation outbox before a
  multi-instance deployment.

**Done when**

> Every material production correction becomes a regression fixture, and a
> release cannot change a known accounting outcome or trace without an explicit,
> reviewed fixture update.

## Transition strategy

1. Convert approved cash-event and schedule drivers into projected entries with
   explicit `forecast` basis and journal-account treatment. Do not preserve the
   old event engine as a reporting or scenario subledger.
2. Validate the converted entry graph against approved source coverage,
   account-level reconciliation, cash roll-forward, and statement invariants.
   The legacy event reports are not an accounting baseline and cannot certify
   or block the graph.
3. Make the single entry-backed graph authoritative only after account-level
   reconciliation and forecast-driver coverage pass for the selected company
   and period.
4. Model scenarios as versioned overlay entries on that same graph; never let
   them mutate actual entries.
5. Preserve old calculation runs permanently; never rewrite a historical run
   to fit a new accounting model or formula version.

## First implementation slice

Start with Phase 1 only:

1. Define chart-of-account, journal batch, journal entry, journal line, and
   posting-proposal schemas.
2. Add integer-minor-unit and currency fields with source/fact/decision lineage.
3. Implement deterministic balanced-entry validation and idempotency checks.
4. Convert approved opening positions into one balanced opening journal batch.
5. Add calculation-graph nodes for trial balance and journal-backed cash.
6. Add evaluation fixtures for balanced entries, duplicate posting prevention,
   and a journal-to-statement cash roll-forward.

This slice creates the authoritative accounting substrate without attempting a
general ledger replacement in one step.

## Finish-the-core release plan

### Goal and cutoff

Finish the single-company accounting loop sufficiently to begin structured
testing with real company data. This is **not** a commitment to finish FX,
multi-entity consolidation, or a broad scenario product before testing. The
test release uses one deterministic entry graph and treats the former event
engine solely as discarded migration input—never as a comparison baseline.

The release is ready when a CFO can ingest a representative month, configure
its chart and bank mappings, review exceptions, approve postings, reconcile
each required cash account, inspect every displayed figure, and close a period
without an unexplained number or a model-created accounting result.

### Release 1 — Complete source coverage and reconciliation

**Implementation status:** the Accounting workspace now has explicit bank-account
identifier mappings and a period-specific Coverage tab. Bank controls compare
each mapped cash account independently, so one account cannot offset another;
unmapped statements and incomplete source roles are named exceptions. The
existing reconciliation review groups operational questions by root cause.
The representative three-month acceptance run remains the first testing task.

1. **Per-account bank control.** Finish the exact statement-account to chart
   cash-account mapping flow in the UI and reconcile each mapped account and
   currency separately. A statement without a mapping, a cash account without
   a required statement, duplicate statement coverage, invalid ending balance,
   or mismatch is an explicit blocker.
2. **Coverage matrix.** Add a period view that lists every required source by
   account and evidence role: bank statement, activity/transaction detail,
   general ledger, and account-balance support. Show received, approved,
   missing, stale, duplicate, and conflicted—not merely a document count.
3. **Statement adapters.** Add fixtures and deterministic adapters for the
   bank-statement formats in the current company test set. Preserve account
   identifier, statement start/end, opening/ending balance, activity detail,
   and source location. A summary/YTD total remains evidence, never a ledger
   row.
4. **Exception queue.** Group source gaps and reconciliation conflicts by
   root cause and account/month, with the evidence and affected journal lines
   attached. Do not create one CFO question per transaction.

**Acceptance:** July–September (or another representative three-month set)
can each report account-by-account coverage and either a verified bank tie or
a named exception with no hidden aggregate offset.

### Release 2 — One universal inspection path

**Implementation status:** the shared journal inspector now exposes formula,
verification, displayed lines, chart accounts, posted-line lineage, and source
references from the main income statement, balance sheet, cash flow, and bank
tie views. Finish the remaining Accounting workspace entry points during the
representative-period test pass.

1. Replace remaining bespoke drill-downs with one `inspect number` payload:
   calculation run/node, formula, inputs, journal lines, account, source rows,
   evidence/facts, mappings/policies, decisions, controls, and verification
   state.
2. Wire it into P&L, traditional balance sheet, cash flow, trial balance,
   reconciliation rows, forecast entries, and close entries.
3. Make unverified figures visibly unverified, with the exact blockers and
   next action. A trace may explain a calculation; it must not imply source
   support that is absent.

**Acceptance:** selecting any displayed amount reaches the same inspector and
can be traced to its formula inputs and original source locations without an
LLM reconstruction.

### Release 3 — Test harness and recovery confidence

**Implementation status:** started. The redacted fixture pack includes an
internal-transfer regression, graph replay is deterministic, and stale
calculation-worker claims requeue safely. Add each real-company discrepancy
to this pack before correcting its owning layer.

1. Build a redacted fixture pack from the actual onboarding and correction
   cases: bank statements, transaction detail, GL/account balances, transfers,
   duplicate summaries, close entries, and known bad extractions.
2. For every fixture assert extraction facts, source-row type, mapping/posting
   outcome, journal balance, bank/account reconciliation result, statements,
   graph status, and inspector lineage.
3. Add revision replay tests: the same source set and approved decisions
   rebuild the same entry graph, statement values, and trace hashes.
4. Add outbox failure/retry tests, including duplicate delivery, stale jobs,
   retry after a process interruption, and a calculation failure that remains
   visible rather than silently serving old output.

**Acceptance:** each material bug fixed during testing becomes a fixture; the
suite can replay a company-period deterministically and failures are visible
as control exceptions.

### Release 4 — Controlled testing launch

**Implementation status:** a Testing tab now provides the structured test
sequence, a persistent discrepancy log, and an exact-name confirmation flow
that fully resets the current company and retained uploads. The actual
representative-period run is deliberately outstanding: it begins only after
the user loads a clean, selected test source set.

1. Create a clean test company/data reset workflow that clears the named
   company and its raw source files, derived source rows, proposals, journals,
   graph runs, and test decisions only after an explicit typed confirmation.
   The next authenticated request provisions a clean company.
2. Run the representative months end to end: ingest → coverage → mapping →
   review → post → reconcile → inspect → promote → close.
3. Log every discrepancy in a compact triage format: expected value, observed
   value, statement/account/period, source evidence, graph node, suspected
   layer, and regression-fixture status.
4. Fix only the layer that owns the error—adapter, source classification,
   mapping/policy, journal posting, deterministic calculation, or presentation.
   Never patch a reported figure directly.

**Exit criterion:** the representative periods are reproducible, all remaining
exceptions are knowingly accepted or explicitly unresolved, and every visible
financial figure either has an inspectable verified lineage or carries an
unverified label.

### Explicitly deferred until after this test release

- FX rates, remeasurement, translation policy, and multi-currency
  consolidation (planned next, below).
- Entity ownership, intercompany matching, and eliminations (planned next,
  below); multi-user workflow remains deferred.
- Advanced scenario authoring and forecast-to-actual analysis beyond the
  existing unified forecast/scenario journal basis.
- New external integrations or broad file-format expansion not needed by the
  representative test data.

## Next phase — Entity consolidation and FX

Begin this phase only after the representative-period exit criterion above is
met. It extends the same journal and calculation graph; it does not create a
parallel consolidation or FX engine.

### Release 5 — Legal entities and consolidation perimeter

**Implementation status:** foundation complete. Legal entities now have
functional currency, ownership, consolidation method, and effective dates;
intercompany receivable/payable account pairs are explicit and effective-dated;
the journal engine has a tested selector for the full-consolidation perimeter
and explicit elimination basis. Reciprocal balances now produce a deterministic
preview: only exact pairs become candidates with source journal-line lineage;
one-sided or unequal pairs are named exceptions in the Accounting
Consolidation tab. CFO approval posts the exact current candidate as an
idempotent, immutable `elimination` entry and records the approver, mapping,
and upstream-line lineage. Existing journal reversal preserves the elimination
basis. Next: complete the representative entity/consolidation acceptance
fixture and expose the same number inspector from every consolidated figure.

**Implementation update:** the Accounting Consolidation tab now presents a
deterministic consolidated trial-balance and statement control for the
selected perimeter. It reports the included entity and journal-line counts,
assets, liabilities and equity, net income, and the balance-sheet difference
and direct cash-flow sections separately for each currency. It deliberately
does not add currencies together before Release 6 supplies an approved
translation policy.

1. Define each legal entity, functional currency, ownership, consolidation
   method, and effective dates. A journal entry and line must name its entity;
   a consolidated view selects the in-scope entities rather than copying rows.
2. Add intercompany counterparty identity and due-to/due-from account mapping.
   Matching uses entity, counterparty, currency, amount, date window, and
   source lineage; unmatched items remain explicit exceptions.
3. Create deterministic elimination entries in a dedicated `elimination`
   journal basis. They are reversible, versioned, and always show both source
   entity entries and the elimination rationale.
4. Add entity and consolidated trial balance, P&L, balance sheet, cash flow,
   account reconciliation, and inspection views. Consolidated totals must
   reconcile to the sum of included entity balances plus posted eliminations.

**Controls:** every entity-level entry balances in its functional currency;
intercompany balances tie by counterparty or remain an exception; eliminations
never alter standalone entity reporting; ownership and perimeter changes are
effective-dated and require CFO approval.

**Acceptance:** a selected entity group can produce a reproducible consolidated
trial balance and statements, with every elimination traceable to both sides of
the underlying intercompany activity.

### Release 6 — FX measurement and translation

**Implementation status:** complete for the deterministic core. Approved rate
sets and source-linked rational rate observations are stored in the journal
system. The engine selects only the latest approved direct quote and returns
explicit `missing`, `stale`, or `conflicting` outcomes; conversions use integer
arithmetic and named half-up rounding. Journal lines retain optional native
transaction amounts, transaction currency, posting date, and selected rate ID
beside functional-currency debit and credit amounts. Explicit chart-account
configuration determines which foreign-currency balances are monetary;
month-end remeasurement creates an immutable, lineage-linked `adjustment`
journal entry. Presentation translation creates a separate, sourced graph
overlay and CTA reserve without altering functional books. The Accounting FX
tab exposes the blocked/ready state, chosen rates, CTA, and reviewed
remeasurement posting.

1. Store currency on every source row, fact, journal line, account balance,
   and rate observation. Preserve the original transaction currency and amount;
   never overwrite it with a converted value.
2. Add approved, sourced exchange-rate sets with rate type (spot, average,
   closing, historical), effective date, quotation convention, and provider
   lineage. Missing or conflicting rates block the affected reported result.
3. Implement deterministic functional-currency measurement: foreign-currency
   monetary balances remeasure at closing rates; realized and unrealized FX
   gains/losses post balanced adjustment entries with rate and source lineage.
4. Implement presentation-currency translation for consolidation: income and
   cash flow use approved average/transaction rates; balance-sheet accounts use
   approved closing or historical rates; translation differences post to CTA in
   equity according to the approved policy.
5. Extend the calculation graph and inspector with native amount, selected
   rate, converted amount, rate type, FX entry, translation reserve, and
   verification status. Scenarios may overlay an approved rate assumption but
   remain explicitly unverified projections.

**Completed:** rate selection and conversion are deterministic and source
backed; native-currency measurement is validated at posting; explicit monetary
accounts can create durable closing-rate adjustments with policy, rate, and
upstream journal-line lineage; presentation translation uses policy-driven
spot/average/closing/historical rates, calculates CTA, and exposes rate and CTA
nodes in a persistable calculation graph. A translation graph remains a
presentation overlay and is never posted into a functional ledger.

**Controls:** transaction currency always balances before conversion; each FX
entry balances by entity and functional currency; converted consolidated
statements balance in presentation currency; rate gaps, stale rates, or mixed
rate conventions are visible exceptions; no LLM can select or calculate a
reported rate.

**Acceptance:** one representative foreign-currency transaction, month-end
remeasurement, and multi-entity translation can be replayed from source rate
evidence into inspectable balanced journal entries and a verified or explicitly
unverified consolidated statement.

### Working cadence once testing starts

1. Test one source/account/month at a time; do not bulk-approve around an
   unresolved discrepancy.
2. Record the source evidence and graph node before changing code or rules.
3. Add the failing case to the fixture pack first, then fix the owning layer,
   then replay the affected period.
4. Re-run the complete deterministic suite before advancing to the next month.

## Release-readiness completion pass

Before the first representative-company run, finish these small but important
quality gates:

1. Use the same inspect-number contract from every displayed statement,
   reconciliation, consolidation, close, forecast, and allocation figure.
2. Maintain one redacted end-to-end fixture harness: source inputs → typed
   rows → approved mappings → posted journals → controls → statements → graph
   lineage. Each material testing discrepancy adds a fixture before its fix.
3. Add adapters only for source-file shapes present in the representative run;
   retain page/row provenance and reject ambiguous columns.
4. Allocation analysis belongs in the journal graph. An approved allocation
   must first produce a deterministic analysis/control node that reconciles
   allocated cost to its originating spend and identifies payer, bearer,
   source, policy/decision, and outstanding due-from/due-to balance. It cannot
   alter statements until an approved allocation posting template creates the
   corresponding balanced, immutable allocation journal entry. The posted
   entry then becomes the only allocation impact on entity statements.

Work outside the single-company readiness boundary is tracked separately in
[Local multi-company](local-multi-company.md); hosted operation is outside
the scope of this repository.
