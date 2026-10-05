# Standard Financial Model export

Date: 2026-10-05
Status: design; nothing implemented.
Audience: product and engineering.

## Intent

Give every Balsa company a downloadable Excel workbook that looks and works like the Hemrock Standard Financial Model: the same sheet names, the same three-statement layout, the same annual rollups and the same driver columns. A founder or CFO who knows the Standard model should be able to open the export and find their way around without instructions. Someone who has never seen Balsa should be able to read it as an ordinary financial model.

The reference is `content/_models/standard-model-sheet-map.md` and the workbook it describes (`content/_models/Standard Financial Model, by Foresight.xlsx`). The export follows its format and structure, not its exact rows: Balsa has no cohort revenue engine and the Standard model has no ledger, so a few sheets change shape and a few are Balsa's own.

The export is an output. Balsa stays the system of record, and its engine stays the calculator for every reported figure. The workbook is a faithful, editable copy of a point-in-time outlook, and any number in it that Excel recalculates must equal what Balsa reported when the file was produced.

## Why this fits

The two systems already have the same skeleton:

| Standard model | Balsa today |
| --- | --- |
| Get Started: company, timescale, first period, opening cash | Company settings, `asOfMonth`, `horizonMonths`, currency, opening cash |
| Forecast driver columns K–X: initial value, start period, repeats every N months, max N months | `ForecastDriver`: `amountMinor`, `effectiveFrom`, `cadence` (once / monthly / quarterly / annual), `effectiveTo` |
| Actuals by Category, Forecast by Category, Actuals + Forecast | Posted actual lines, projected lines, and the `projected` reporting view that switches at `asOfPeriod` |
| Statements: income statement, balance sheet, cash flow, balance check | `buildJournalStatements` with `balanced`, `differenceMinor`, cash-flow `ties` |
| Burn / runway block | `ForecastRun.nodes`: net burn, trailing burn, cash-out month, runway months |
| Budget (budget vs actuals) | Saved plans versus actuals and the latest outlook |
| Model Checks | Exceptions, unclassified lines, verification status |

The driver mapping is the important one. Balsa's cadence values are exactly the Standard model's "repeats every N months" (once = 0, monthly = 1, quarterly = 3, annual = 12), and `effectiveTo` is "max N months" expressed as a date. Most fixed drivers can become live Forecast rows with no translation loss.

## Workbook layout

Sheets in Standard model order. "Formula" means Excel formulas in the file; "values" means Balsa-computed numbers written as constants.

| Sheet | Contents | Cells |
| --- | --- | --- |
| README | What this file is, the company, the as-of month, the scenario, the Balsa formula version, export time, and how to read the colour coding | Text |
| Get Started | Model structure block (company name, monthly timescale, period count, first period, fiscal year end), opening cash, currency, minimum cash. Revenue assumption, debt, tax and valuation blocks are omitted until Balsa has those concepts | Inputs |
| Summary | Annual rollup by fiscal year: condensed income statement, cash flow and balance sheet, via SUMIFS over Statements | Formula |
| Snapshot | Single-period cash view with a selectable "as of" month | Formula |
| Forecast | Driver rows with the K–X columns, then Forecast by Category, Actuals by Category, Actuals + Forecast, and the burn/runway block | Mixed, see below |
| Statements | Monthly income statement, balance sheet and cash flow on the Standard row layout, with the balance check row | Formula |
| Budget | Plan versus actuals for a selectable month range, using the latest saved plan | Formula over values |
| Sources & Uses | Funding and spending over a selectable range | Formula |
| Breakdown | Statement by legal entity in place of the Standard model's segments, when the company has more than one entity | Formula |
| Scenarios | One column block per exported scenario: ending cash, net income, runway, and the delta to base | Values |
| Lineage | One row per exported figure group: statement line, month, Balsa node or account ids, journal line count, source evidence ids, verification status | Values |
| Checks | Balance sheet balances, cash ties to Balsa's ending cash every month, Excel totals equal Balsa totals, no unmapped accounts, no driver exceptions. Each returns yes/no, like Get Started's Model Checks | Formula |
| Glossary, Changelog | Balsa terms (actual, expectation, outlook, plan, scenario) and the export format version | Text |

Revenues, Hiring Plan, Key Metrics and Unit Economics are left out of the first version. Balsa forecasts from agreements and obligations, not from growth units, cohorts and churn, so those sheets would be empty shells. Key Metrics comes back when recurring-revenue recognition is verified (the goal-directed spec defers revenue goals for the same reason). Hiring Plan comes back if headcount becomes a model dimension that drivers read.

Formatting follows the Standard model's conventions: inputs in blue on a pale fill, formulas in black, links to other sheets in green, one column per month starting at the same column the Standard model uses for period 1, frozen label columns, and period header rows (period number, date, fiscal year, actual/forecast flag) at the top of every time-series sheet.

## The Forecast sheet

This is where "editable model" is either true or not.

**Driver rows.** One row per confirmed driver (base, or base plus the chosen scenario), grouped by statement category. Columns carry the Standard model's meanings:

| Column | Standard meaning | Balsa source |
| --- | --- | --- |
| K | Initial value | `amountMinor` in major units |
| L | Starts in period # | Period index of `effectiveFrom` |
| M | Repeats every N months | `cadence` → 0, 1, 3, 12 |
| N–Q | Changing based on / by / driver | Empty in v1; Balsa drivers are flat unless they carry a formula |
| R | Max N months | Months from `effectiveFrom` to `effectiveTo` |
| U–X | Seasonality / event / custom / escalation flags | `false` |

Plus Balsa columns to the left of K: driver id, label, direction, category, debit and credit account, and the statement line the template resolves to. The monthly columns are a single formula per row that reproduces `buildProjectedEntries`' expansion, so editing K, L, M or R in Excel changes the forecast the way the Standard model does.

**Drivers Excel can't reproduce faithfully** are written as per-month values in the monthly columns with the K–X block left blank and a note naming the reason:

- Formula drivers (`amountFormula` over model variables). Their resolved `amountByMonth` is exported; the formula text goes in a cell note. Translating Balsa's formula language (`sum`, `avg`, `min`, `max`, `prev`, `round` over dimensions) into Excel is possible and is a later phase.
- Drivers whose recognition or settlement timing differs from the cash month (`recognitionStart`/`recognitionEnd`, `expectedDay` with settlement rules).
- The open month, which combines month-to-date actuals with unresolved forecasted closes.

**Actuals by Category** is values: posted actual journal lines summed by Standard statement line and month. **Actuals + Forecast** is a formula that picks actuals for periods at or before the as-of month and forecast after, the same rule as Balsa's `projected` view. Statements read only from that block, as in the Standard model.

## Mapping accounts to Standard statement lines

This is the one piece of new modelling work. `statementLine` on chart accounts is free text today, and the Standard model has a fixed line set (Revenues, COGS, SG&A split into R&D / Sales / G&A / Misc, Depreciation, Interest, Taxes; Cash, AR, Inventory, Prepaid, PP&E, AP, Deferred Revenue, Accrued Liabilities, SAFEs, Debt, Equity Investment, Retained Earnings).

Proposal: a `standardModelLine` classification resolved per account in this order:

1. An explicit approved mapping on the account (a new nullable column, set in chart-account review, audited like other classifications).
2. A deterministic default from fields Balsa already has: `accountType`, `statementSection`, `balanceTiming`, `cashFlowCategory` and `workingCapitalCategory` (`receivables` → Accounts Receivable, `deferred_revenue` → Deferred Revenue Liability, `prepaids` → Prepaid Expense, and so on).
3. Otherwise the "Other" line for its section (Other Current Assets, Other Expense, and so on), and the account is listed on Checks as unmapped.

A model may suggest mappings, and they go through the existing review flow like any other mapping. Nothing is dropped: every account lands on some line, and the Checks sheet makes the defaulted and "Other" ones visible. The same mapping is reusable inside Balsa for a Standard-layout statement view, which is a reason to put it in company state rather than the exporter.

## Parity and verification

The export is only trustworthy if Excel recalculates to Balsa's numbers. Two guards:

- **In the file.** Checks compares Excel's ending cash, net income and total assets per month against hidden value rows holding Balsa's own results, and flags any difference. A user who edits a driver will see these go to "no", which is correct and is labelled as "differs from Balsa outlook", not as an error.
- **In CI.** A test builds the workbook for the Company Zero fixture and a few synthetic companies (multi-cadence drivers, a scenario, a formula driver, an open month), recalculates it headlessly with LibreOffice (`soffice --headless --convert-to xlsx` recalculates on load), reads it back with ExcelJS, and asserts every Checks row is "yes" and every statement figure equals `buildJournalStatements` / `buildForecastRun` to the minor unit. This lives with `pnpm acceptance`, since it touches calculation output.

Excel works in floating point and Balsa in integer minor units. Monthly driver formulas round to cents with `ROUND(…, 2)` at the line level so totals match; the test is the proof.

## Where the code goes

- `packages/model-export`, a new package depending on `finance-engine` and `exceljs` (already a dependency of `apps/web`). Pure input to bytes: it takes a `ForecastRun`, the selected journal lines, statements per month, accounts with their resolved Standard line, plans, scenarios and company settings, and returns a workbook. No database, auth or React, matching the finance-engine boundary. A sheet builder per sheet, plus a small cell-address helper so row numbers are named constants rather than literals scattered through formulas.
- `apps/web/src/app/api/exports/standard-model/route.ts`, company-scoped and audited like every other route, taking `asOf`, `scenarioId` (optional, repeatable), and `horizon`. Writes an audit event naming who exported what.
- A "Download model (.xlsx)" action on the outlook / reviews pages, and an agent tool so "send me the model" works in chat.

The file never includes evidence contents, prompts or provider output. Lineage carries ids and labels, not source text.

## Phases

1. **Values workbook.** Standard sheet layout with every line item as values from Balsa and only subtotals, totals and rollups as formulas. Statements, Summary, Snapshot, Budget, Scenarios, Lineage, Checks. Exact parity by construction, useful immediately to send to a board or an investor, and it settles the account mapping and the layout.
2. **Live drivers.** The Forecast sheet's driver rows and category blocks become formulas, so editing a driver flows through to Statements and Summary like the Standard model. LibreOffice parity test in CI. Non-reproducible drivers stay as flagged values.
3. **Formula drivers.** Translate Balsa's model formulas and dimensions into Excel (a Model sheet with one block per variable), removing the largest category of value-only rows.
4. **Round trip.** Balsa already ingests XLSX as evidence. Re-uploading an edited export could be recognised by its README metadata, diffed against the drivers it was built from, and turned into proposed scenario changes for review. Edits never apply directly; they become proposals like any other evidence.

## Open questions

- Fixed 72-month horizon like the Standard model, or the company's forecast horizon? Proposal: the actuals history plus the forecast horizon, padded to whole fiscal years so Summary columns are complete.
- One file per scenario, or base plus scenarios in one file? Proposal: base drives Statements; scenarios are summarised on the Scenarios sheet, and the user can export a scenario as its own file.
- Should the export also produce a Google Sheets copy? ExcelJS output opens in Sheets, but data validation and some formatting degrade; worth testing before promising it.
- Licensing and naming: the export borrows the Standard model's structure, which is Apache 2.0. Credit it on README with a link to hemrock.com.
