# Forecasted closes

The live forecast includes an intra-month estimate for recurring journal events.
These estimates are derived in memory and are never posted as actual journals.

An event qualifies only when the same normalized description, debit account,
credit account, currency, and entity appears exactly once in each of the three
completed months before the open month. The three amounts must all be within
10% of their median. The forecast uses the median amount and median posting day.
Sparse, volatile, zero-value, multi-line, and description-free activity is not
inferred.

The open month's cash projection combines posted month-to-date actuals,
approved forecast drivers, and unresolved forecasted closes. A current-month
actual with the same description and posting accounts settles the expectation;
the forecasted close is then omitted even when the final amount differs. An
approved forecast driver with the same debit and credit shape takes precedence
over an inferred close so the two cannot double-count the same event.

Every inferred line retains its source account metadata and has a
`forecasted_close` entry source plus a deterministic `forecasted-close:` source
location. The forecast run also records actual-to-forecast matches. This keeps
the estimate visibly forecast, traceable to its historical pattern, and
reproducible without introducing a second journal engine.
