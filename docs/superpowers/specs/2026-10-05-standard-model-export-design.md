# Standard Financial Model export and driver extensions

Date: 2026-10-05
Status: design; nothing implemented. Rulings from review on 2026-10-05 are marked **Ruling**.
Audience: product and engineering.
Builds on: [driver formulas](2026-09-18-driver-formulas-design.md), [forecast scenarios](2026-09-18-forecast-scenarios-design.md), [goal-directed financial model](2026-09-25-goal-directed-financial-model-design.md).

## Intent

Give every Balsa company a downloadable workbook that looks and works like the Hemrock Standard Financial Model: the same sheet names, the same three-statement layout, the same annual rollups and the same driver columns. A founder or CFO who knows the Standard model should be able to open the export and find their way around without instructions. Someone who has never seen Balsa should be able to read it as an ordinary financial model.

The references are `content/_models/standard-model-sheet-map.md`, the workbook it describes (`content/_models/Standard Financial Model, by Foresight.xlsx`), and the driver documentation at `content/content/docs/drivers.md`. The export follows their format and structure, not their exact rows.

Two pieces of work come out of this, and the second is useful on its own:

1. **An export** of the outlook, plan, actuals and scenarios into a Standard-shaped workbook that opens in Excel and Google Sheets.
2. **Standard-model drivers in Balsa.** The Standard model's driver columns (change by % or #, % of / # per another line, change cadence, caps, seasonality, escalation) become structured fields on Balsa's forecast drivers, computed by Balsa's engine. That gives founders the patterns they already know from the Standard model without writing a formula, and it means most exported rows can be live formulas rather than pasted values.

Balsa stays the system of record and its engine stays the calculator for every reported figure. The workbook is a faithful, editable copy of a point-in-time outlook, and any number Excel or Sheets recalculates must equal what Balsa reported when the file was produced.

## Rulings

- **Ruling: sheets.** Revenues, Hiring Plan, Key Metrics and Unit Economics are out of scope, not deferred. They model growth units, cohorts and headcount, which is a different context from Balsa's evidence-backed agreements and obligations.
- **Ruling: account mapping.** The user sets the mapping from chart accounts to Standard statement lines inside Balsa. Balsa suggests defaults; the user's choice is authoritative and audited.
- **Ruling: drivers.** Extend Balsa's drivers with the Standard model's driver set (below).
- **Ruling: timeline.** Not fixed. The user sets the model timeline in Balsa, and the export uses it.
- **Ruling: scenarios.** One file holds the base and every exported scenario.
- **Ruling: Google Sheets.** The file must work in Google Sheets as well as Excel, including recalculation after edits.

## Part 1: Standard drivers in Balsa

### What exists today

`ForecastDriver` has a fixed `amountMinor`, a `cadence` (once / monthly / quarterly / annual), `effectiveFrom` and `effectiveTo`. Driver formulas add an optional `amountFormula` over model variables and dimensions, which is the general escape hatch: anything the Standard drivers can express, a formula can, but it asks the user to write one.

### What the Standard model adds

From `docs/drivers.md`, each Forecast row has:

| Standard input | Meaning |
| --- | --- |
| Initial Value | Starting amount; or the % / # used with a driver when changing based on `% of` / `# per` |
| Starts in period # | First period |
| Repeats every N months | Cadence; 1 monthly, 6 semiannual, 0 once |
| Changing based on | `% change`, `# change`, `log change`, `% of`, `# per` |
| Changes every N months | When the change applies; a monthly salary that changes every 12 |
| Changing by % or # | Rate or step for `% change`, `# change`, `log change` |
| Using Driver | Another revenue, expense or operating-metric line, for `% of` / `# per` |
| For a max of N months | Duration |
| To a max value of | Per-period cap |
| Use Seasonality | Applies the global 12-month seasonality profile; redistributes *when*, not *how much* |
| Use Event Flag, Use Custom Flag | Opt in to a globally defined per-period flag |
| Use Escalation Factor | Opt in to the global escalation / inflation factor |
| Timeline Flag | Global; zeroes every row outside the model timeline |

### Proposed driver fields

Add an optional `pattern` to `ForecastDriver`. A driver with no pattern behaves exactly as today, so existing drivers, projections and idempotency keys are unchanged.

```ts
type DriverPattern = {
  /** Integer months; replaces `cadence` when present. 0 = once. */
  repeatsEveryMonths: number;
  change?: {
    basis: "pct_change" | "abs_change" | "log_change";
    everyMonths: number;          // Changes every N months
    by: string;                   // decimal; a rate for pct/log, major units for abs
  } | {
    basis: "pct_of" | "per_unit";
    driverRef: DriverRef;         // what the initial value is a % of, or # per
  };
  maxMonths?: number;             // derived from effectiveTo when absent
  maxValueMinor?: string;         // per-period cap
  useSeasonality?: boolean;
  useEventFlag?: boolean;
  useCustomFlag?: boolean;
  useEscalation?: boolean;
};

type DriverRef =
  | { kind: "driver"; driverId: string }
  | { kind: "variable"; name: string; coords?: Record<string, string> }   // a model variable
  | { kind: "report_line"; line: StandardLine };                           // e.g. total revenue
```

`amountMinor` keeps its meaning as the initial value (or the rate, for `pct_of` / `per_unit`, held as a decimal string in a new `initialValue` field so a percentage is not forced into minor units). `pattern` and `amountFormula` are mutually exclusive; validation rejects a driver with both.

### Company-level settings the flags read

| Setting | Shape | Notes |
| --- | --- | --- |
| Seasonality profile | 12 calendar-month weights summing to zero change over a year | Redistributes a year's amount across months; never changes the annual total. Validation enforces the sum, as the Standard model's R143 check does |
| Escalation factor | Annual rate, applied monthly compounding from the timeline start | One factor per company in v1 |
| Event flag, custom flag | A named per-month multiplier series (default 1) | Lets a user model a one-off event, a shutdown month, a price change |
| Timeline | First period, last period, fiscal year end month | Part 3 below; zeroes every driver outside it |

These live in company state, versioned and audited like other forecast assumptions, and their edits bump the forecast revision because they change the base forecast.

### Engine

A new pure module, `finance-engine/src/driver-patterns.ts`, expands a patterned driver into `amountByMonth`, the same field formula drivers already fill. Everything downstream (`buildProjectedEntries`, settlement, recognition, statements, runway, scenarios, consequences) is unchanged, because it already consumes per-month amounts.

- Arithmetic in the model's scaled `bigint` decimals, rounded to minor units per period with the same half-even rule formulas use.
- `pct_of` / `per_unit` references resolve in dependency order with the formula resolver; a cycle through driver references is an exception on the driver, not a crash, and the driver produces nothing until it is fixed.
- `log_change` follows the Standard model's definition; the reference implementation is the Standard workbook's own formula, read from the file, with a test against its values.
- Bounds match the existing model limits (value cap, month count).
- The formula version string increments; projected entries for patterned drivers carry the pattern in their idempotency version so an edit re-projects.

Tests: one per basis against hand-computed fixtures; a parity fixture built from the Standard workbook's Forecast sheet (same inputs, same per-period outputs); cycle and cap cases; seasonality preserves annual totals; a scenario that changes a pattern.

### Product surface

The driver editor gets the Standard columns as a "Pattern" section, collapsed by default, with plain labels ("Grows 5% every 12 months", "3% of revenue"). The agent can propose patterns through the existing decision flow ("make rent go up 4% every January" becomes a proposed pattern change, reviewed like any other). Formula drivers remain for anything a pattern can't say.

## Part 2: account mapping

The Standard model has a fixed statement line set. Balsa's `statementLine` on chart accounts is free text. The export needs a fixed vocabulary; so does any Standard-layout view inside Balsa.

**Vocabulary.** `StandardLine`, an enum in `finance-engine`, mirroring the Standard Statements sheet:

- Income statement: Revenue, COGS, SG&A (R&D), SG&A (Sales & Marketing), SG&A (G&A), SG&A (Misc), Depreciation, Amortization, Interest Income, Interest Expense, Other Income, Other Expense, Taxes.
- Assets: Cash, Accounts Receivable, Inventory, Prepaid Expense, Other Current Assets, PP&E, Accumulated Depreciation, Other Assets, Accumulated Amortization.
- Liabilities: Accounts Payable, Inventory AP, Deferred Revenue, Accrued Liabilities, Corporate Tax Payable, VAT Payable, Working Capital Loan, Convertible Notes and SAFEs, Debt Financing, Accrued Interest.
- Equity: Owners Equity, Equity Investment, SAFE Investment, Retained Earnings.

Revenue may be split into named revenue categories (Standard has Rev Cat 1–3) that the user defines; each maps to Revenue for totals.

**Where it's stored.** A nullable `report_line` column on chart accounts, plus `report_line_source` (`user` / `suggested`). Migration, audit event on change, company-scoped like every chart-account field.

**How it's set.** A "Report mapping" page under the chart of accounts: one row per account, its current balance, a dropdown of `StandardLine`, and the suggestion shown beside it. Bulk accept for suggestions. The agent can propose mappings through the existing mapping review flow; nothing is applied without approval.

**Suggestions** are deterministic first, from fields Balsa already has: `accountType`, `statementSection`, `balanceTiming`, `cashFlowCategory`, `workingCapitalCategory` (`receivables` → Accounts Receivable, `payables` → Accounts Payable, `deferred_revenue` → Deferred Revenue, `prepaids` → Prepaid Expense, `inventory` → Inventory). A model may suggest the rest (which SG&A bucket a vendor-expense account belongs in). Anything unmapped falls to the "Other" line for its section and is listed as an exception on the mapping page and on the export's Checks sheet. Nothing is dropped.

The mapping is presentation only. It never changes journals, balances or Balsa's own statements.

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
| Get Started | Model structure (company, monthly timescale, first period, number of periods, fiscal year end), opening cash, currency, minimum cash, **active scenario selector**, seasonality profile, escalation factor, event and custom flag series, Model Checks summary | Inputs |
| Summary | Annual rollup by fiscal year: income statement, cash flow, balance sheet, via SUMIFS over Statements | Formula |
| Snapshot | Single-period cash view with a selectable as-of period | Formula |
| Forecast | Driver rows with the Standard driver columns; Forecast by Category, Actuals by Category, Actuals + Forecast; burn and runway | Mixed, below |
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

**Driver rows.** One row per confirmed driver, grouped by mapped statement line, with Balsa columns on the left (driver id, label, direction, account, scenario) and the Standard driver columns to the right, filled from `pattern` (or from `cadence`, `effectiveFrom`, `effectiveTo` for a driver without one). The monthly cells are a single formula per row implementing the Standard driver logic, so editing any driver input in the spreadsheet changes the forecast the way it does in the Standard model. `pct_of` / `per_unit` references become references to the referenced row.

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
- **Excel / LibreOffice in CI.** A test builds the workbook for Company Zero and synthetic companies (every driver basis, seasonality, escalation, flags, a cap, a `pct_of` chain, a formula driver, recognition timing, an open month, two scenarios), recalculates headlessly with LibreOffice (installed in the dev container), reads it back with ExcelJS, switches the active scenario, and asserts every Checks row and every statement figure equals the engine to the minor unit. Runs with `pnpm acceptance`.
- **Google Sheets.** An opt-in job with a service account uploads the file with conversion to Sheets, sets the active scenario through the Sheets API, reads values back, and runs the same assertions. Skipped when credentials are absent; required before a release that changes the exporter. Until it exists, a written manual checklist covers the same cases.
- **Driver parity.** The driver-pattern engine and the spreadsheet driver formula are tested against the same fixtures, so Balsa, Excel and Sheets agree on every basis.

Balsa computes in integer minor units; spreadsheets in floating point. Driver formulas round with `ROUND(…, 2)` per period, matching the engine's per-period rounding; the parity tests are the proof.

## Where the code goes

- `packages/finance-engine`: `StandardLine`, `DriverPattern`, `driver-patterns.ts`, and the timeline type. Pure, no new dependencies.
- `packages/database`: migrations for `report_line`, driver `pattern` and `initialValue`, and company model settings (timeline, seasonality, escalation, flags). Grant and company-scoping as every other table.
- `packages/model-export`: new package depending on `finance-engine` and `exceljs`. Input is data, output is bytes: forecast run, selected journal lines, statements per month, mapped accounts, plans, scenarios and settings in; workbook out. One builder per sheet, row numbers as named constants, the formula allowlist check.
- `apps/web`: report mapping page, timeline and model settings page, pattern section in the driver editor, `api/exports/standard-model` (company-scoped, audited, with `scenarioId` repeatable), a "Download model" action on the outlook and review pages, and an agent tool.

The file never includes evidence contents, prompts or provider output. Lineage carries ids and labels only.

## Phases

1. **Mapping and timeline.** `report_line` with suggestions and the mapping page; model timeline setting replacing the bare horizon. Useful in Balsa before any export exists.
2. **Values workbook.** Standard layout with line items as values from Balsa, totals and rollups as formulas, every exported scenario on the Scenarios sheet. Exact parity by construction; ready to send to a board. Opens in Excel and Sheets.
3. **Driver patterns in Balsa.** Engine, settings, editor, agent proposals, parity fixtures against the Standard workbook.
4. **Live drivers and scenario switching.** Forecast driver rows as formulas, the active-scenario selector, LibreOffice and Sheets parity jobs.
5. **Formula drivers in the spreadsheet.** Translate Balsa's model variables and formulas into a Model sheet, removing most remaining value-only rows.
6. **Round trip.** Balsa already ingests XLSX as evidence. A re-uploaded export is recognised by its README metadata, diffed against the drivers it was built from, and turned into proposed scenario or driver changes for review. Edits never apply directly.

Phases 1 and 3 are independent of the export and can run in parallel with 2.

## Open questions

- Seasonality per company or per driver group? Standard has one profile; v1 follows it.
- Escalation compounding: monthly from the timeline start, or stepped each fiscal year? Check the Standard workbook's formula before choosing, and match it.
- Should `report_line` revenue categories also drive a Standard-layout statement view inside Balsa, or stay export-only at first?
