# Financial calculation graph completion plan

## Goal

Nevermodel's model interprets evidence and proposes accounting treatment. The
financial calculation graph is the deterministic authority for every reported
financial figure. It must make a number reproducible, inspectable, sourced,
and explicit about uncertainty.

```text
evidence + approved company rules + financial state
                       ↓
             deterministic calculation graph
                       ↓
 figures, statements, forecasts, invariants, and traceability
```

The engine must never turn model output, a source summary, a scenario, or an
unverified balance into an asserted financial fact.

## Guiding rules

- Models interpret documents, suggest mappings, and draft explanations; they
  do not perform the reported arithmetic.
- The same financial state, formula version, and as-of date always produce the
  same result.
- Every reported base-case figure has a persisted calculation run, formula
  version, inputs, output, and provenance.
- A result without adequate support is marked provisional, unverified, or an
  exception; it is not silently presented as actual.
- Scenarios are explicit overlays of assumptions, never mutations of actual
  company state or the base calculation run.
- Company learning remains sourced, scoped, approved, and re-applied.

## Current state

Completed:

- Pure deterministic engine for cash, P&L, balance sheet, cash flow, matching,
  allocation, intercompany activity, and basic scenario inputs.
- Immutable calculation runs and calculation graph nodes with input hashes and
  formula versions.
- Base-case graph trace in the forecast UI, including run history and links to
  supporting documents.
- Source-backed statement opening positions and fact-level lineage for cash
  events and schedule items, including source location, account, and period.
- Invariant nodes for cash roll-forward, month continuity, balance-sheet
  equality, transfer exclusion and pairing, duplicate source facts, allocation
  totals, intercompany netting, and statement-cash variance.
- Integer-cent accounting arithmetic, including deterministic distribution of
  fractional cents across recognition periods. Currency decimals only appear at
  the engine input/output boundary.
- Safe scenario overlays and a side-by-side base/simulated forecast response;
  scenarios never become base-case truth.
- A local `@nevermodel/accounting-evals` package with stage-level metrics, JSON
  output, and regression tests for extraction, reconciliation, statements,
  forecasting, and provenance.
- A distinct journal-ledger calculation graph with source journal-line,
  account-balance, conventional statement-line/total, trial-balance,
  balance-sheet, source-to-ledger, and account-reconciliation nodes. It is
  persisted by formula version and financial-state revision. The former
  schedule/cash graph is migration input only; its outputs are never compared
  to, displayed beside, or used to certify the entry graph.

Operational follow-up:

- Add a redacted gold fixture whenever a material CFO correction or production
  incident occurs. The baseline corpus establishes the gate; it will grow with
  real accounting outcomes.
- Schedule calculation-outbox recovery before moving to multi-instance or
  asynchronous workers, as described below.

## Completion sequence

### 1. Authoritative calculation protocol

Add a monotonic `financial_state_revision` for each company and a durable
calculation outbox. Every committed mutation that can change included company
financial state increments the revision and queues base-case recalculation in
the same transaction. A calculation run records the revision it calculated.

Report endpoints resolve the newest completed run for the current revision. If
one is unavailable, the UI names the result as a live preview or pending
calculation; ordinary report reads must not silently write state.

The worker is idempotent by company, revision, engine version, and input hash;
it supports retry and makes stale state observable.

**Deployment follow-up:** before relying on multi-instance or asynchronous
recovery, schedule an authenticated periodic `POST` to
`/api/calculations/process` using `Authorization: Bearer $CRON_SECRET`.
Single-player use continues to calculate inline; the scheduler is recovery for
queued or failed jobs, not a prerequisite for ordinary use.

### 2. Complete the graph and lineage

Represent opening positions, account balances, recognized revenue, working
capital, cash-flow sections, eliminations, and statement lines as explicit
nodes with dependencies. Persist provenance at evidence, source, fact,
location/page/row, approval, account, and period granularity.

### 3. Exact accounting arithmetic

Use integer minor units or a decimal representation internally. Currency and
precision must be attached to amounts; formatting and rounding occur only at
the display boundary.

### 4. Full invariant suite

Add month continuity, duplicate-source prevention, transfer pairing, currency
completeness, closed-period immutability, account-level statement-to-ledger
reconciliation, allocation-total, and intercompany-elimination invariants.

### 5. Scenario overlays

Version assumptions, calculate scenario overlays separately, show changed
nodes and drivers beside the base case, and prevent scenario values from
appearing as actuals.

### 6. Evaluation and regression loop

Implement the local `accounting-evals` corpus described in
`accounting-evaluation-loop.md`: gold fixtures, stage-specific metrics, CI
execution, and a workflow that turns material CFO corrections into regression
cases.

**Implemented:** `pnpm --filter @nevermodel/accounting-evals eval` emits a
JSON report and fails on a regression. The package test runs with the normal
workspace test suite.

## Definition of done

A CFO can open any reported figure and see its formula, formula version,
current financial-state revision, inputs, exact source facts and approvals,
invariant results, and whether it is verified. Replaying the same approved
state yields the same figure. A pending or unsupported figure is visibly not
asserted as fact.
