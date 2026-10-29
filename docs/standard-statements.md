# Standard statements and the model timeline

Open **Accounting → Statements** and switch between **Ledger** and **Standard**.

The Standard Financial Model export connects statement mapping, categories, the timeline, driver patterns, live workbook formulas, and returned-edit proposals. See the [implementation review](standard-model-review.md) for corrections and remaining support boundaries.

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
| Get Started | Model structure (company, currency, periods, fiscal year end, actuals through, minimum cash, runway), the check summary, and the seasonality profiles and company escalation the drivers read |
| Summary | Annual totals by fiscal year, all formulas over Statements; balances take each fiscal year's last month |
| Forecast | Operating metrics and drivers in the Standard model's driver columns, each month a live formula, with Balsa's own amounts below ([forecast drivers](forecast-drivers.md#in-the-workbook)). Only when there are drivers or metrics |
| Model | Balsa's forecast model, one row per variable and coordinate: inputs to edit, formulas compiled from Balsa's. Only when the company has a forecast model |
| Statements | Monthly Standard statements with actual and forecast months marked |
| Plan, Budget | The pinned plan, and plan versus actuals over a month range the reader sets. Only when a plan has been pinned |
| Scenarios | Each active scenario's net income and cash beside the base, the differences as formulas, and its runway. Only when there are scenarios; Get Started's Active scenario dropdown switches the whole model to one ([forecast drivers](forecast-drivers.md#in-the-workbook)) |
| Mapping | Each account's line, category and mapping status |
| Lineage | The accounts behind every line figure, by month |
| Checks | The workbook's totals against Balsa's, month by month, plus the balance check, the cash flow check, the mapping status, whether the driver formulas reproduce Balsa's amounts and whether any driver has an exception |

Line and category figures are values Balsa calculated (blue). A forecast month of a line a driver moves is Balsa's figure plus that driver's change on Forecast (green), which is zero in the downloaded file. Subtotals, totals, the Summary, Budget and every check are formulas (black, or green for a link to another sheet), so the file recalculates when a reader edits it. Checks expose mapping, forecast, balance, and parity gaps. Baseline parity does not prove that every subsequent workbook edit reproduces the accounting engine: the workbook adjusts statement values rather than replaying all recognition and settlement journals.

Formulas use only functions that behave the same in Excel, Google Sheets and LibreOffice (`allowedFunctions` in `packages/model-export`); building a workbook with any other function fails. The exporter's tests recalculate a generated workbook in LibreOffice and compare every check, the fiscal-year rollup, the budget and the scenario differences with the engine; a second fixture recalculates every driver basis, then edits an input and checks the change through the statements. They run in `pnpm acceptance` and skip when `soffice` is not installed; on Debian or Ubuntu, install `libreoffice-calc-nogui`. Opening the file in Google Sheets is not yet tested automatically.

### Sending a workbook back

Upload an edited export like any other file (Sources, upload). Balsa recognises its own export by a manifest on a very hidden sheet, which records the company, the export format and every editable cell with the value it was exported with. It compares the cells with the manifest and proposes each edit as a decision, citing the uploaded file: a driver's pattern (initial value, repeats, basis, change, maximums, seasonality, escalation) becomes a pattern change, a new end month ends the driver, a metric's pattern becomes a metric change, and edited months of a Model input become that variable's step inputs. All changed coordinates of a variable share one proposal. Unedited months and the schedule beyond the export are preserved; conflicting cells are reported as notes instead of proposed. Approval checks the current variable against the proposal snapshot and returns a conflict if it has changed. Older workbook input proposals without conflict checks must be recreated from a fresh export. Nothing is applied: review the proposals under Decisions and apply the ones you want, which recalculates the forecast as any decision does.

Some edits are reported as notes on the upload instead of proposed, because a decision cannot express them or they belong elsewhere: a scenario's rows (change the scenario in Balsa), a driver that comes from a decision, a new start month, removing an end month, a formula driver's cadence, values typed over a formula variable on Model, a metric's start when it restarts from its last actuals, and edits to the seasonality profiles or the company escalation on Get Started. A cell that does not hold a number or date is reported and its row is skipped. Only the inputs are read: values typed over Forecast's monthly formulas, and edits to Balsa's figures elsewhere in the file such as Statements, are not.

The hidden manifest is editable file content, not a signed attestation of the original export. A bounded runtime schema validates its structure and supported versions. Malformed recognized exports are refused with a clear error and never sent for generic extraction. Company checks and approval still apply; see the [review](standard-model-review.md) for the implemented conflict checks.

A workbook exported from another company is refused. The same file uploaded twice is recognised as a duplicate and proposes nothing new. A recognised export is not sent to a model for extraction.

Downloads are recorded in the activity log. The file carries ids, account names and figures, never evidence contents or model output.

## Which accounts are cash

One rule decides which accounts are cash, everywhere: the ledger's cash flow and balances, runway, the forecast, reconciliation, coverage, and the Standard Cash line. An asset counts as cash when it is linked to a bank account (a bank identifier or a connected bank account), or when its name or statement line says "cash". **Chart of accounts → Counts as cash** overrides that default per account: Cash, Not cash, or back to the default. The change is audited and recalculates the books and the forecast; it never changes a journal.

The Standard view and the workbook's Checks sheet still verify that net cash flow equals the change in the Cash line, and report it if a mapping and the cash rule ever disagree.

## Limits

- The cash flow section is the ledger's operating, investing and financing summary, not the Standard model's indirect method.
- The view shows the company's base currency and the consolidated company; entity and scenario selection are not in the Accounting modal yet.
- Agent proposals for mappings and categories are not yet available.
- Supported driver and Model rows are live. Unsupported or nonmatching formulas fall back to exported values, with their reason shown; the base Model sheet does not compile scenario-specific model overrides.
- Drivers with prepaid/accrual recognition or reviewed settlements are fixed values, labelled with their reason, and excluded from live statement deltas and returned-driver proposals. Recalculate these changes in Balsa.
- Model input approvals are atomic per variable and conservatively reject any intervening change to that variable. Separate variable proposals remain separate decisions.
- Snapshot, Sources & Uses, and Breakdown sheets remain deferred. Google Sheets recalculation is not covered by an automated test.
