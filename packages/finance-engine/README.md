# Finance Engine

Deterministic journals, statements, reconciliation, forecasts, consolidation,
and calculation traces. The package depends on nothing but TypeScript: no
React, Next.js, database, authentication, or model provider.

Posted actuals enter as balanced `PostedJournalLine` values. Trial balances,
financial statements, cash summaries, and forecasts all use those same journal
lines rather than a parallel event engine.

`buildForecastRun(input)` takes a compact actual-cash summary, confirmed
forecast drivers, approved entry templates, active chart accounts, and forecast
settings. It returns monthly cash projections, balanced projected journal lines,
calculation nodes, exceptions, and runway. Projected lines remain derived until
the user explicitly pins them as a plan.

Rules the engine enforces:

- Reported actual cash includes actual, adjustment, and elimination journals;
  posted plan, forecast, and scenario journals never become actuals.
- Confirmed drivers expand from `effectiveFrom` to `effectiveTo` on their own
  monthly, quarterly, annual, or one-time cadence.
- Every driver must resolve to exactly one approved balanced entry template.
  Missing or ambiguous mappings remain visible exceptions.
- The open month combines month-to-date actuals with unresolved forecasted
  closes. Stable historical closes disappear when matching actuals arrive.
- Forecast formulas are deterministic, versioned, bounded, and retain their
  model inputs and source lineage.
- Transfers never become revenue, debits equal credits, balance sheets balance,
  and cash roll-forwards reconcile.

Use `buildTrialBalance`, `buildJournalStatements`, and
`buildJournalCalculationGraph` for reported results. Consolidation, FX,
reconciliation, retained earnings, and allocation modules operate on the same
journal-native types exported from `src/index.ts`.
