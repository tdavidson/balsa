# Accounting evaluation and improvement loop

## Idea

Nevermodel should improve from real accounting outcomes without becoming an
unsupervised system that invents company policy. Its durable financial brain is
the combination of accounting fundamentals, deterministic controls,
evidence-backed company knowledge, and a measured feedback loop.

```text
accounting fundamentals + deterministic controls
          +
approved, sourced company knowledge
          +
evaluation of outcomes and regressions
```

The model interprets evidence and proposes conclusions. The accounting system
validates those conclusions, the CFO approves company-specific policies, and
evaluation shows whether a change actually made the system more reliable.

## Learning loop

1. Ingest evidence and produce typed facts, transactions, and hypotheses.
2. Cross-check the results against other sources and accounting invariants.
3. Ask the CFO only grouped, material questions that remain unresolved.
4. Save an approved answer as a company rule with evidence, scope, effective
   date, confidence, and approval history.
5. Re-run the affected classifications, reconciliation, statements, and
   forecast.
6. Record whether the result was correct; turn material mistakes into permanent
   regression cases.

Company learning must never be promoted solely because a model inferred it once.
It requires evidence or a CFO decision, remains reviewable, and can be revised
or retired as the business changes.

## Evaluation suite

Build a versioned `accounting-evals` package in the repository. It should run
in CI whenever extraction, classification, reconciliation, accounting rules,
prompts, or model configuration changes.

The suite should contain redacted, gold-standard fixtures for:

- Source identification and extraction: document type, entity, period,
  accounts, balances, currency, and transaction rows.
- Classification: revenue, expense, transfer, investment, financing, and
  excluded summaries.
- Reconciliation: opening cash + classified activity = ending cash; cross-source
  matches; duplicate prevention; and month-to-month roll-forwards.
- Financial statements: cash flow, P&L, and balance-sheet integrity, including
  `assets = liabilities + shareholders' equity` when complete source data is
  present.
- Forecasting: forecasts continue before close; actual activity supersedes the
  forecast as evidence arrives; and forecast drivers are not created from cash
  transfers.
- CFO workflow: one answer resolves related outstanding questions, questions
  remain traceable, and company rules apply only inside their approved scope.
- Security and safety: document text cannot override instructions, publish
  accounting policy, or execute an unauthorized action.

Each fixture records the source inputs, expected typed output, expected ledger
and statement result, and the reason the case matters. A production error or a
CFO correction creates a candidate regression fixture before the underlying
logic is changed.

## Metrics

Track quality separately by stage rather than relying on a single score:

- extraction accuracy and source-location coverage;
- classification precision/recall, especially for transfers and revenue;
- reconciliation pass rate and unexplained-difference amount;
- financial-statement invariant pass rate;
- duplicate-question rate and CFO correction rate;
- forecast error as actual evidence replaces forecast;
- cost and latency per successful intake/review run.

## OpenAI Evals

OpenAI Evals can be useful later to run structured datasets, compare models and
prompt/configuration variants, and apply model-based graders to qualitative
tasks. They complement—not replace—the local deterministic accounting evals.
The authoritative pass/fail checks for arithmetic, provenance, policy scope,
and financial-statement invariants should remain in Nevermodel's own test suite.

## First slice

Create a small local corpus from failures already encountered in the first
company: consolidated versus individual statements, automatic-investment and
bank-product transfers, opening-balance extraction, duplicate/YTD summary
prevention, partial-date reporting, and balance-sheet classification. Add an
eval runner that reports each stage's result and fails CI on regression.

## Implemented baseline

`packages/accounting-evals` is the local deterministic evaluation package.
It provides:

- `pnpm --filter @nevermodel/accounting-evals test` for the CI quality gate;
- `pnpm --filter @nevermodel/accounting-evals eval` for JSON output with
  overall and stage-level fixture, pass, fail, and pass-rate metrics.

The initial corpus covers transaction-row extraction, source currency and row
location retention, investment transfers excluded from revenue, duplicate
source-fact and unpaired-transfer exceptions, sourced opening-cash
roll-forward, forecast generation before close, and exact penny-level prepaid
recognition. Each material CFO correction should now add the next fixture.
