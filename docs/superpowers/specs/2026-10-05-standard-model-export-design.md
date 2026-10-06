# Standard Financial Model export and driver extensions

Date: 2026-10-05
Status: phases 1 (mapping, categories, Standard view and timeline), 2 (values workbook) and 3 (driver patterns) implemented; see [Standard statements](../../standard-statements.md) and [forecast drivers](../../forecast-drivers.md). Phase 4 implemented: live driver rows, their flow through the statements, and the active-scenario selector, with LibreOffice parity tests; the Google Sheets job is not yet built. Phases 5–6 not started. Deviations from this text: `Using` references compile to direct cell references rather than a lookup by label, because a lookup over a range containing the formula's own row is circular in Excel and LibreOffice; seasonality profiles store deviations from an average month and multiply the output (growth compounds unseasoned), rather than the Standard workbook's ratio of consecutive index values; event and custom flags are dropped in favour of dated agent decisions; drivers can be generated from actuals and proposed by the agent, and metrics take actuals (see forecast drivers). Rulings from review on 2026-10-05 are marked **Ruling**.
Audience: product and engineering.
Builds on: [driver formulas](2026-09-18-driver-formulas-design.md), [forecast scenarios](2026-09-18-forecast-scenarios-design.md), [goal-directed financial model](2026-09-25-goal-directed-financial-model-design.md).

## Intent

Give every Balsa company a downloadable workbook that looks and works like the Hemrock Standard Financial Model: the same sheet names, the same three-statement layout, the same annual rollups and the same driver columns. A founder or CFO who knows the Standard model should be able to open the export and find their way around without instructions. Someone who has never seen Balsa should be able to read it as an ordinary financial model.

The references are `content/_models/standard-model-sheet-map.md`, the workbook it describes (`content/_models/Standard Financial Model, by Foresight.xlsx`), and the driver documentation at `content/content/docs/drivers.md`. The export follows their format and structure, not their exact rows.

Two pieces of work come out of this, and the second is useful on its own:

1. **An export** of the outlook, plan, actuals and scenarios into a Standard-shaped workbook that opens in Excel and Google Sheets.
2. **Standard-model drivers in Balsa.** Above all, a cost or revenue can be set as a % of or # per an operating metric or another revenue or cost line. The rest of the Standard driver columns (change by %, # or logarithmically, change cadence, caps, seasonality, escalation) come too. All of them become structured fields on Balsa's forecast drivers, computed by Balsa's engine. That gives founders the patterns they already know from the Standard model without writing a formula, and it means most exported rows can be live formulas rather than pasted values.

Balsa stays the system of record and its engine stays the calculator for every reported figure. The workbook is a faithful, editable copy of a point-in-time outlook, and any number Excel or Sheets recalculates must equal what Balsa reported when the file was produced.

## Rulings

- **Ruling: sheets.** Revenues, Hiring Plan, Key Metrics and Unit Economics are out of scope, not deferred. They model growth units, cohorts and headcount, which is a different context from Balsa's evidence-backed agreements and obligations.
- **Ruling: account mapping.** The user sets the mapping from chart accounts to Standard statement lines inside Balsa. Balsa suggests defaults; the user's choice is authoritative and audited.
- **Ruling: drivers.** Extend Balsa's drivers with the Standard model's driver set. Linking a cost or revenue to an operating metric or another cost or revenue is the priority.
- **Ruling: log change** is logarithmic growth, defined by the Standard formula below.
- **Ruling: escalation** runs on whatever cycle the user sets.
- **Ruling: seasonality** is per driver, not one company profile.
- **Ruling: statement views.** The statements page offers both the ledger-native view and the Standard layout, and the user swaps between them. Ledger is the default until the mapping has no unmapped accounts; the user's own choice always wins once made.
- **Ruling: categories** live in Balsa: revenue and expense categories and the Standard line layout are a statement view inside Balsa, not only an export format.
- **Ruling: cash.** A bank-linked account counts as cash by default, and the user can override any account (cash or not cash).
- **Ruling: timeline.** Not fixed. The user sets the model timeline in Balsa, and the export uses it.
- **Ruling: scenarios.** One file holds the base and every exported scenario.
- **Ruling: Google Sheets.** The file must work in Google Sheets as well as Excel, including recalculation after edits.

## Part 1: Standard drivers in Balsa

### What exists today

`ForecastDriver` has a fixed `amountMinor`, a `cadence` (once / monthly / quarterly / annual), `effectiveFrom` and `effectiveTo`. Driver formulas add an optional `amountFormula` over model variables and dimensions, which is the general escape hatch: anything the Standard drivers can express, a formula can, but it asks the user to write one.

### The key driver: linking a line to another line

**Ruling:** the most important thing to bring over is the ability to set a cost or a revenue as a function of something else: an operating metric (customers, orders, headcount, units shipped), another cost, or another revenue. Hosting at 4% of revenue, support at $12 per customer, payroll taxes at 9% of salaries, a commission at 10% of new bookings. In the Standard model this is `Changing based on` = `% of` or `# per` plus `Using Driver`; it is the driver founders use most, and it is what makes a forecast move together when one assumption changes.

Balsa needs three things for it:

- **Operating metrics as forecast lines.** Balsa's model variables of kind `number` already hold non-money series (headcount, customers). They become first-class "operating metrics" in the driver editor: named, dated, editable, forecast with the same patterns as money drivers (a metric can grow 5% a month or be `# per` another metric), and listed alongside revenue and cost lines as things a driver can reference. A metric can also be fed from actuals where evidence supports it (a customer count from a billing export), with lineage, like any other fact.
- **References.** A driver's reference can name another driver, an operating metric, or a mapped report line (total revenue, total COGS, a revenue category). The Standard model reads the referenced line from its Actuals + Forecast block for the same period; Balsa does the same, so in a month that has actuals, "4% of revenue" uses actual revenue.
- **Ordering and cycles.** References resolve in dependency order with the existing formula resolver. A cycle is an exception on the driver, shown in the editor and on Checks; the driver produces nothing until it is fixed. Never a silent zero.

### The rest of the Standard driver set

Read from the Standard workbook's Forecast formula (row 37 onward), so Balsa and the export compute the same thing. `t` is the period number, `K` the initial value, `L` the start period, `M` repeats every N months, `O` changes every N months, `P` the change, `R` max N months, `S` max value.

| Basis | Standard behaviour |
| --- | --- |
| Fixed (none) | `K` in period `L`; then the value from `M` periods earlier, so the amount repeats every `M` periods; `M` = 0 means once |
| `% change` | The value from `M` periods earlier, multiplied by `(1 + P)` in periods where `(t − L)` is a multiple of `O`, unchanged otherwise. Salary at 5% every 12 months |
| `# change` | Same, adding `P` instead of multiplying |
| `log change` | Logarithmic-shaped growth: `K × ROUND((t − L) / O + 1, 0) ^ P`. The step count rises every `O` periods and is raised to `P`; a `P` between 0 and 1 gives fast early growth that flattens, the usual shape for downloads or early adoption |
| `% of`, `# per` | `K ×` the referenced line in the same period, on periods matching the repeat cadence from `L`, zero before `L` |
| Max N months (`R`) | Zero after period `L + R − 1`; 0 means no limit |
| Max value (`S`) | Per-period cap: the result is `MIN(value, S)` |
| Timeline flag | Zero outside the model timeline |
| Seasonality | Multiplies by `(1 + s_t) / (1 + s_{t−1})`, the ratio of the seasonality index between consecutive periods, so it shifts *when* the amount lands, not the annual total. The Standard model has one profile; Balsa makes it per driver (below) |

### Escalation

**Ruling:** escalation follows whatever cycle the user sets. In the Standard workbook the escalation, event and custom flags are placeholders (a per-period series that defaults to 1 and only gates the cap), so Balsa defines escalation properly:

- `rate` (decimal, may be negative for deflation or deceleration), `everyMonths` (the cycle: 1, 3, 6, 12, 18, anything), and an anchor: either the driver's own start (anniversary escalation, like a lease) or a calendar month (every January, the fiscal year start).
- Compounds once per cycle: the multiplier steps to `(1 + rate)^k` at the k-th cycle boundary after the anchor.
- A company default (say 3% every 12 months from the fiscal year start) that drivers opt into, and a per-driver override for contracts with their own terms. Both versioned and audited.

The export writes the escalation multiplier as a per-period row on Forecast (the Standard row 17 position) computed from rate, cycle and anchor by formula, so changing the rate or cycle in the spreadsheet flows through.

Event and custom flags become optional named per-period multiplier series (default 1), opt-in per driver. Low priority; kept so the Standard columns all have a meaning.

### Proposed driver fields

Add an optional `pattern` to `ForecastDriver`. A driver with no pattern behaves exactly as today, so existing drivers, projections and idempotency keys are unchanged.

```ts
type DriverPattern = {
  initialValue: string;           // decimal; money in major units, or the rate / per-unit amount for pct_of / per_unit
  repeatsEveryMonths: number;     // replaces `cadence` when present; 0 = once
  change?:
    | { basis: "pct_change" | "abs_change" | "log_change"; everyMonths: number; by: string }
    | { basis: "pct_of" | "per_unit"; ref: DriverRef };
  maxMonths?: number;             // derived from effectiveTo when absent
  maxValueMinor?: string;         // per-period cap
  seasonality?: { profileId: string };   // a named profile; per driver
  escalation?: "company" | { rate: string; everyMonths: number; anchor: "driver_start" | { calendarMonth: number } };
  flags?: string[];               // named event / custom multiplier series
};

type DriverRef =
  | { kind: "driver"; driverId: string }
  | { kind: "metric"; name: string; coords?: Record<string, string> }   // an operating metric (model variable)
  | { kind: "report_line"; line: StandardLine };                         // e.g. total revenue
```

`pattern` and `amountFormula` are mutually exclusive; validation rejects a driver with both. `amountMinor` stays as the display fallback, as it is for formula drivers.

### Company-level settings

| Setting | Shape | Notes |
| --- | --- | --- |
| Seasonality profiles | Named sets of 12 calendar-month weights ("Retail holiday", "Summer slow", "Q4 enterprise close") | Each driver picks a profile or none. Profiles are reusable so twenty drivers with the same shape share one definition, and editing it moves all of them. A driver with a one-off shape gets its own profile. Validation enforces the Standard model's sum check on every profile, so the annual total is unchanged. A model may suggest a profile from a line's monthly actuals history, as a proposal |
| Default escalation | Rate, cycle in months, anchor | Above |
| Flag series | Named per-month multipliers | Optional |
| Timeline | First period, last period, fiscal year end month | Part 3 |

These live in company state, versioned and audited like other forecast assumptions, and their edits bump the forecast revision because they change the base forecast.

### Engine

A new pure module, `finance-engine/src/driver-patterns.ts`, expands a patterned driver into `amountByMonth`, the field formula drivers already fill. Everything downstream (`buildProjectedEntries`, settlement, recognition, statements, runway, scenarios, consequences) is unchanged, because it already consumes per-month amounts.

- Arithmetic in the model's scaled `bigint` decimals, rounded to minor units per period with the same half-even rule formulas use. `log change` with a fractional exponent needs a bounded, deterministic power function on scaled decimals; it is tested against the spreadsheet's results to the minor unit.
- References resolve together with formula drivers in one dependency graph; operating metrics are evaluated first, then money drivers in topological order.
- Bounds match the existing model limits (value cap, month count).
- The formula version string increments; projected entries for patterned drivers carry the pattern in their idempotency version so an edit re-projects.

Tests: one per basis against hand-computed fixtures; a parity fixture taken from the Standard workbook's Forecast sheet (same inputs, same per-period outputs, recalculated in LibreOffice); reference chains (cost % of revenue, revenue # per metric, metric % change); cycles; caps; seasonality preserves annual totals for every profile, and two drivers on different profiles move independently; escalation on 6-, 12- and 18-month cycles with both anchors; a scenario that changes a pattern.

### Product surface

The driver editor gets a "Pattern" section with plain labels ("Grows 5% every 12 months", "4% of revenue", "$12 per customer") and a picker for the referenced line that lists metrics, revenue lines and cost lines. Operating metrics get their own list beside revenue and costs. The agent can propose patterns and links through the existing decision flow ("make hosting 4% of revenue" becomes a proposed change, reviewed like any other). Formula drivers remain for anything a pattern can't say.

## Part 2: account mapping

The Standard model has a fixed statement line set. Balsa's `statementLine` on chart accounts is free text. The export needs a fixed vocabulary; so does any Standard-layout view inside Balsa.

**Vocabulary.** `StandardLine`, an enum in `finance-engine`, mirroring the Standard Statements sheet:

- Income statement: Revenue, COGS, SG&A (R&D), SG&A (Sales & Marketing), SG&A (G&A), SG&A (Misc), Depreciation, Amortization, Interest Income, Interest Expense, Other Income, Other Expense, Taxes.
- Assets: Cash, Accounts Receivable, Inventory, Prepaid Expense, Other Current Assets, PP&E, Accumulated Depreciation, Other Assets, Accumulated Amortization.
- Liabilities: Accounts Payable, Inventory AP, Deferred Revenue, Accrued Liabilities, Corporate Tax Payable, VAT Payable, Working Capital Loan, Convertible Notes and SAFEs, Debt Financing, Accrued Interest.
- Equity: Owners Equity, Equity Investment, SAFE Investment, Retained Earnings.

**Categories.** Under each line, the user can define named categories: revenue categories (Standard has Rev Cat 1–3; Balsa allows as many as the user wants, such as Subscriptions, Services, Hardware) and expense categories under COGS and each SG&A bucket (Hosting, Contractors, Rent). An account maps to a line and optionally a category; a category rolls up to its line for totals. Categories are company state, created and renamed in Balsa, audited, and usable as `% of` / `# per` references ("payment fees at 3% of Subscriptions").

**Where it's stored.** A nullable `report_line` column on chart accounts holding only the user-confirmed line (suggestions are computed, never stored), and a nullable `report_category_id` with a same-company foreign key to `report_categories`. Migration, audit event on change, company-scoped like every chart-account field.

**How it's set.** A "Report mapping" page under the chart of accounts: one row per account, its current balance, a dropdown of `StandardLine`, and the suggestion shown beside it. Bulk accept for suggestions. The agent can propose mappings through the existing mapping review flow; nothing is applied without approval.

**Suggestions** are deterministic first, from fields Balsa already has: `accountType`, `statementSection`, `balanceTiming`, `cashFlowCategory`, `workingCapitalCategory` (`receivables` → Accounts Receivable, `payables` → Accounts Payable, `deferred_revenue` → Deferred Revenue, `prepaids` → Prepaid Expense, `inventory` → Inventory). A model may suggest the rest (which SG&A bucket a vendor-expense account belongs in). Anything unmapped falls to the "Other" line for its section and is listed as an exception on the mapping page and on the export's Checks sheet. Nothing is dropped.

The mapping changes presentation, never accounting: journals, balances and the ledger-native statements are untouched, and the mapping can be edited at any time without re-posting anything.

**Standard-layout statements in Balsa.** The mapping drives a statement view inside Balsa in the Standard layout: income statement by line and category, balance sheet and cash flow on the Standard rows, with actual and forecast months side by side and the same annual rollup as the Summary sheet. It is built from the same `buildJournalStatements` output, regrouped by `report_line` and category, so its totals tie to the ledger-native statements exactly (a test asserts it). Every figure drills down to its accounts, journal lines and evidence, like the existing statements. This view is what the export writes, so what a user sees in Balsa and what they download are the same numbers in the same shape.

**Swapping views.** The statements page has a view switch: *Ledger* (the current account-based statements) and *Standard* (line and category layout). The switch keeps the period, as-of month, scenario and entity selection, and a drill-down opened in one view lands on the matching accounts in the other. The last choice is remembered per user and company. Until the mapping is complete, the Standard view shows a banner with the count of unmapped accounts and a link to the mapping page, and their amounts appear on the "Other" lines rather than disappearing. Reports, reviews and the agent can name either view ("show me the Standard P&L for Q3").

## Part 3: timeline

Today `horizonMonths` and `asOfMonth` describe the forecast. The Standard model has a model timeline: first period, number of periods, fiscal year end.

Add a company **model timeline** setting: `firstPeriod` (may reach back into actuals history), `lastPeriod`, and `fiscalYearEndMonth`. Validation: first ≤ as-of ≤ last, length within the existing model month limit. The forecast horizon becomes "as-of to `lastPeriod`", so the forecast and the export always agree. Periods outside the timeline are zeroed (the Standard Timeline Flag), and Summary columns follow fiscal years, with partial first and last years labelled as such.

Existing companies get a default: first actual month with posted activity, the current horizon, and a December fiscal year end; the setting page shows it as defaulted until the user saves it.

## Part 4: the workbook

### Sheets

Standard model order. "Formula" means spreadsheet formulas in the file; "values" means Balsa-computed constants.

| Sheet | Contents | Cells |
| --- | --- | --- |
| README | What the file is, company, as-of month, timeline, exported scenarios, Balsa formula version, export time, colour key, credit to the Standard model (Apache 2.0) | Text |
| Get Started | Model structure (company, monthly timescale, first period, number of periods, fiscal year end), opening cash, currency, minimum cash, **active scenario selector**, seasonality profiles (one row of 12 weights each), default escalation (rate, cycle, anchor) with its per-period multiplier row, event and custom flag series, Model Checks summary | Inputs |
| Summary | Annual rollup by fiscal year: income statement, cash flow, balance sheet, via SUMIFS over Statements | Formula |
| Snapshot | Single-period cash view with a selectable as-of period | Formula |
| Forecast | Operating metric rows, then driver rows, both with the Standard driver columns; Forecast by Category, Actuals by Category, Actuals + Forecast; burn and runway | Mixed, below |
| Statements | Monthly income statement, balance sheet and cash flow on the Standard row layout, balance check row | Formula |
| Budget | Latest saved plan versus actuals, selectable month range | Formula over values |
| Sources & Uses | Funding and spending over a selectable range | Formula |
| Breakdown | Statement by legal entity, when the company has more than one | Formula |
| Scenarios | Side-by-side comparison of base and each scenario | Values, below |
| Lineage | One row per figure group: line, month, account and node ids, journal line count, evidence ids, verification status | Values |
| Checks | Balance sheet balances; cash ties; Excel results equal Balsa results for the active scenario; no unmapped accounts; no driver exceptions | Formula |
| Glossary, Changelog | Balsa terms (actual, expectation, outlook, plan, scenario) and export format version | Text |

Formatting follows the Standard model: inputs blue on a pale fill, formulas black, cross-sheet links green; monthly columns starting where the Standard model starts period 1; frozen label columns; period header rows (period number, date, fiscal year, actual/forecast flag, timeline flag) on every time-series sheet.

### Forecast sheet

**Driver rows.** One row per confirmed driver, grouped by mapped statement line, with Balsa columns on the left (driver id, label, direction, account, scenario) and the Standard driver columns to the right, filled from `pattern` (or from `cadence`, `effectiveFrom`, `effectiveTo` for a driver without one). The monthly cells are a single formula per row implementing the Standard driver logic, so editing any driver input in the spreadsheet changes the forecast the way it does in the Standard model. `pct_of` / `per_unit` references use the Standard model's own lookup: the referenced line's label in `Using Driver`, resolved by `INDEX`/`MATCH` against the Actuals + Forecast block, so a user can repoint a driver by changing the label. Operating metrics sit in their own block above the money drivers and are referenceable the same way. Seasonality: each profile gets a per-period index row on Forecast, written as plain formulas rather than the array formula the Standard workbook uses so it behaves the same in Sheets and Excel. Each driver row has a `Seasonality profile` column (a dropdown of profile names) in place of the Standard TRUE/FALSE, and its formula picks its profile's index row by `INDEX`/`MATCH`, so changing a driver's profile, or a profile's weights, flows through.

Driver rows are grouped by line and then category, with category subtotals, matching the Standard-layout view in Balsa.

**Rows written as values**, with the driver columns left blank and a note giving the reason:

- Formula drivers. The resolved `amountByMonth` is exported; the formula text goes in a cell note. Translating Balsa's formula language into spreadsheet formulas is a later phase.
- Drivers whose recognition or settlement timing differs from the amount month (`recognitionStart`/`recognitionEnd`, `expectedDay` with settlement rules). The pattern's amounts stay live; the timing shift is values.
- The open month, which combines month-to-date actuals with unresolved forecasted closes.

**Actuals by Category** is values: posted actual journal lines summed by `report_line` and month. **Actuals + Forecast** picks actuals at or before the as-of period and forecast after, Balsa's `projected` rule. Statements read only from that block.

### Scenarios in one file

Scenarios in Balsa are sets of driver changes against the base. The file mirrors that:

- Scenario changes are extra driver rows (added drivers) or override rows (changed drivers), each tagged with its scenario in a Balsa column. An `Active scenario` dropdown on Get Started lists Base and every exported scenario. Each row's monthly formula multiplies by an include flag: base rows are included unless the active scenario overrides them; scenario rows only when their scenario is active.
- Changing the dropdown recalculates Forecast, Statements, Summary and everything else for that scenario, live, in both Excel and Sheets.
- The **Scenarios** sheet holds Balsa's own results for every scenario side by side (ending cash, net income, runway, cash-out month, and delta to base, monthly and annual) as values, because a live side-by-side would need the whole model computed once per scenario. Checks compares the live model with the matching Scenarios column for whichever scenario is active.

### Google Sheets compatibility

The file is built for the intersection of Excel and Google Sheets:

- Functions limited to a tested allowlist that behaves the same in both: `SUM`, `SUMIFS`, `SUMPRODUCT`, `INDEX`, `MATCH`, `IF`, `AND`, `OR`, `MIN`, `MAX`, `ROUND`, `EDATE`, `EOMONTH`, `YEAR`, `MONTH`, `MOD`, `LN`, `EXP`, `IFERROR`. No `LET`, `LAMBDA`, dynamic arrays, `XLOOKUP`, structured table references, macros or external links. The workbook builder rejects any formula outside the allowlist at build time.
- Dropdowns as data validation against ranges on the same workbook; checkboxes as TRUE/FALSE validation, which Sheets renders and Excel accepts.
- Named ranges for the global inputs (timeline, scenario, seasonality, flags), which import into Sheets.
- Simple conditional formatting only (fill on a formula condition).
- Sheet count and size within Sheets' limits; the timeline limit keeps the column count well under them.

## Parity and verification

The export is only trustworthy if recalculation reproduces Balsa's numbers.

- **In the file.** Checks compares the live model's ending cash, net income and total assets per month with Balsa's results for the active scenario. A user who edits a driver will see these go to "differs from Balsa outlook", which is labelled as a difference, not an error.
- **Excel / LibreOffice in CI.** A test builds the workbook for Company Zero and synthetic companies (every driver basis, seasonality, escalation on several cycles, flags, a cap, `% of` and `# per` chains through operating metrics, a formula driver, recognition timing, an open month, two scenarios), recalculates headlessly with LibreOffice (installed in the dev container), reads it back with ExcelJS, switches the active scenario, and asserts every Checks row and every statement figure equals the engine to the minor unit. Runs with `pnpm acceptance`.
- **Google Sheets.** An opt-in job with a service account uploads the file with conversion to Sheets, sets the active scenario through the Sheets API, reads values back, and runs the same assertions. Skipped when credentials are absent; required before a release that changes the exporter. Until it exists, a written manual checklist covers the same cases.
- **Driver parity.** The driver-pattern engine and the spreadsheet driver formula are tested against the same fixtures, so Balsa, Excel and Sheets agree on every basis.

Balsa computes in integer minor units; spreadsheets in floating point. Driver formulas round with `ROUND(…, 2)` per period, matching the engine's per-period rounding; the parity tests are the proof.

## Where the code goes

- `packages/finance-engine`: `StandardLine`, `DriverPattern`, `driver-patterns.ts`, and the timeline type. Pure, no new dependencies.
- `packages/database`: migrations for `report_line`, driver `pattern`, operating metrics (if model variables need extra fields such as display unit and actuals source), and company model settings (timeline, seasonality, default escalation, flags). Grant and company-scoping as every other table.
- `packages/model-export`: new package depending on `finance-engine` and `exceljs`. Input is data, output is bytes: forecast run, selected journal lines, statements per month, mapped accounts, plans, scenarios and settings in; workbook out. One builder per sheet, row numbers as named constants, the formula allowlist check.
- `apps/web`: report mapping page, timeline and model settings page, pattern section in the driver editor, `api/exports/standard-model` (company-scoped, audited, with `scenarioId` repeatable), a "Download model" action on the outlook and review pages, and an agent tool.

The file never includes evidence contents, prompts or provider output. Lineage carries ids and labels only.

## Phases

1. **Mapping, categories and timeline.** `report_line` and categories with suggestions and the mapping page; the Standard-layout statement view in Balsa; model timeline setting replacing the bare horizon. Useful in Balsa before any export exists.
2. **Values workbook.** Standard layout with line items as values from Balsa, totals and rollups as formulas, every exported scenario on the Scenarios sheet. Exact parity by construction; ready to send to a board. Opens in Excel and Sheets.
3. **Driver patterns in Balsa.** Operating metrics and `% of` / `# per` links first, then the change bases, caps, seasonality and escalation. Engine, settings, editor, agent proposals, parity fixtures against the Standard workbook.
4. **Live drivers and scenario switching.** Forecast driver rows as formulas, the active-scenario selector, LibreOffice and Sheets parity jobs.
5. **Formula drivers in the spreadsheet.** Translate Balsa's model variables and formulas into a Model sheet, removing most remaining value-only rows.
6. **Round trip.** Balsa already ingests XLSX as evidence. A re-uploaded export is recognised by its README metadata, diffed against the drivers it was built from, and turned into proposed scenario or driver changes for review. Edits never apply directly.

Phases 1 and 3 are independent of the export and can run in parallel with 2.

## Open questions

