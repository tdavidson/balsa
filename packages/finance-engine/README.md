# Finance Engine

Deterministic schedules, cash, P&L, outstanding items, intercompany balances,
and a calculation trace. The package depends on nothing but TypeScript: no
React, Next.js, database, authentication, or model provider.

`runEngine(input)` takes Company State as schedule items (agreements,
obligations, assumptions), actual cash events, allocation rules, the opening
cash balance and its month, closed months, and an optional scenario. It
returns one result per month in the horizon.

Rules the engine enforces:

- Schedule items expand on their own calendar from `effectiveFrom` to
  `effectiveTo`, so a quarterly fee lands in its contractual months.
- Actuals settle the expectations they match: a persisted `settlesItemId`
  first, then same-month counterparty or amount, then a late payment for one of
  the two preceding months. Nothing is counted twice.
- Months before `asOfMonth`, and closed months, move cash on actuals only.
  Unsettled expectations there become outstanding receivables or payables.
  Open months project actuals plus unsettled expectations.
- The cash roll starts at the opening balance's month. Transfers never move
  consolidated cash; investment and financing activity never enters the P&L.
- Accrual and prepaid items spread evenly over their recognition range.
- Approved allocations split a spend line into the company's expense and a
  receivable due from the bearer.
- Every month carries its lines with amount, category, basis (contractual or
  assumed), the item or event behind it, what settled it, and its provenance.

`traceValue(output, { month, category, label })` returns the lines behind one
figure. `summarizeMonths(output, start, end)` returns compact totals for
prompts and summaries.
