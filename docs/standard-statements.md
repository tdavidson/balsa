# Standard statements and the model timeline

Open **Accounting → Statements** and switch between **Ledger** and **Standard**.

This is the first slice of the [Standard Financial Model export](superpowers/specs/2026-10-05-standard-model-export-design.md): the mapping, categories, timeline and in-app view, and the workbook export built on them.

## Two views of the same numbers

**Ledger** is the existing account-based statements. **Standard** regroups the same accounts into the Hemrock Standard Financial Model layout: Revenues, COGS, gross margin, SG&A in four buckets, EBITDA, below-the-line items, taxes and net income; a balance sheet on the Standard rows; and a cash flow summary. Months are columns, marked actual or forecast, with fiscal-year totals under **Annual**.

The Standard view is a regrouping, not a calculation. It reads the per-account amounts the ledger statements use (`buildAccountPresentationBalances`), and every month carries checks that net income, total assets, and total liabilities and equity equal the ledger statements to the minor unit. A failed check is shown above the table.

Both views share the period and the **Actuals / With forecast** choice. Clicking a Standard figure lists the accounts behind it; **Show in Ledger view** opens the Ledger view at that month with those accounts highlighted.

Ledger is the default until every account in use has a confirmed line. Once the mapping is complete the default becomes Standard. A choice made with the switch is remembered per company in this browser and always wins.

## Statement mapping

**Accounting → Statement mapping** places each account on a Standard line and, optionally, in a category under it.

- An account's line must be in its own statement section; a contra account takes the section it offsets.
- Accounts without a confirmed line use a deterministic suggestion from the working capital category, a linked bank account, and the account name. An account no rule recognises falls to the "Other" line for its section and is marked as needing a choice. Nothing is dropped.
- **Accept suggestions** confirms every suggested line at once; each row can also be confirmed or changed individually, or cleared back to its suggestion.
- Categories split a line, such as Subscriptions and Services under Revenues. Accounts on the line without a category appear as Uncategorized. Removing a category leaves its accounts on the line, uncategorized.

The mapping changes presentation only. Journals, balances and the ledger statements never change, so an account with posted lines can be remapped at any time. Every change is recorded in the activity log.

## Model timeline

**Company settings → Model timeline** sets the first month, last month and fiscal year end.

- The Standard view spans the timeline, and fiscal-year totals follow the fiscal year end. A year with fewer than twelve months in the timeline is labelled as partial.
- The forecast runs from the as-of month to the last month, up to 120 months. Changing the last month is a revision and recalculates the forecast.
- Unset, the timeline is twelve months of history before the as-of month and the rolling 24-month forecast, with a December year end. **Use the rolling default** returns to it.

## Export

**Download model (.xlsx)** in the Standard view saves the outlook as a workbook in the Standard Financial Model's shape, over the model timeline:

| Sheet | Contents |
| --- | --- |
| README | What the file is, the as-of month, versions and the colour key |
| Get Started | Model structure (company, currency, periods, fiscal year end, actuals through, minimum cash, runway) and the check summary |
| Summary | Annual totals by fiscal year, all formulas over Statements; balances take each fiscal year's last month |
| Forecast | Each driver in the Standard model's driver columns with Balsa's monthly amounts, and the operating metrics ([forecast drivers](forecast-drivers.md)). Only when there are drivers or metrics |
| Statements | Monthly Standard statements with actual and forecast months marked |
| Plan, Budget | The pinned plan, and plan versus actuals over a month range the reader sets. Only when a plan has been pinned |
| Scenarios | Each active scenario's net income and cash beside the base, the differences as formulas, and its runway. Only when there are scenarios |
| Mapping | Each account's line, category and mapping status |
| Lineage | The accounts behind every line figure, by month |
| Checks | The workbook's totals against Balsa's, month by month, plus the balance check, the cash flow check and the mapping status |

Line and category figures are values Balsa calculated (blue). Subtotals, totals, the Summary, Budget and every check are formulas (black, or green for a link to another sheet), so the file recalculates when a reader edits it. In the downloaded file every check reads "yes" except where Balsa itself reports a gap: an unconfirmed mapping, or a cash flow that does not explain the change in cash.

Formulas use only functions that behave the same in Excel, Google Sheets and LibreOffice (`allowedFunctions` in `packages/model-export`); building a workbook with any other function fails. The exporter's tests recalculate a generated workbook in LibreOffice and compare every check, the fiscal-year rollup, the budget and the scenario differences with the engine. They run in `pnpm acceptance` and skip when `soffice` is not installed; on Debian or Ubuntu, install `libreoffice-calc-nogui`. Opening the file in Google Sheets is not yet tested automatically.

Downloads are recorded in the activity log. The file carries ids, account names and figures, never evidence contents or model output.

## Which accounts are cash

One rule decides which accounts are cash, everywhere: the ledger's cash flow and balances, runway, the forecast, reconciliation, coverage, and the Standard Cash line. An asset counts as cash when it is linked to a bank account (a bank identifier or a connected bank account), or when its name or statement line says "cash". **Chart of accounts → Counts as cash** overrides that default per account: Cash, Not cash, or back to the default. The change is audited and recalculates the books and the forecast; it never changes a journal.

The Standard view and the workbook's Checks sheet still verify that net cash flow equals the change in the Cash line, and report it if a mapping and the cash rule ever disagree.

## Limits

- The cash flow section is the ledger's operating, investing and financing summary, not the Standard model's indirect method.
- The view shows the company's base currency and the consolidated company; entity and scenario selection are not in the Accounting modal yet.
- Agent proposals for mappings and categories are not yet available.
- The workbook's driver rows are not live yet: editing a forecast assumption means editing it in Balsa and exporting again. Live driver formulas are phase 4 of the spec.
