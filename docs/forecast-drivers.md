# Forecast drivers

Open **Accounting → Drivers**.

Every confirmed driver can take a pattern from the Hemrock Standard Financial Model's forecasting drivers instead of a fixed amount. Balsa's engine calculates each month from the pattern; the projection, statements, runway, scenarios and the exported workbook use those amounts exactly as they use a fixed amount. The design is in the [Standard model export spec](superpowers/specs/2026-10-05-standard-model-export-design.md), part 1.

## Patterns

| Input | Meaning |
| --- | --- |
| Changing based on | Nothing (a fixed amount), **% of** a line, metric or driver, **# per** unit of one, **% change**, **# change**, or **logarithmic growth** |
| Starting amount, percent or amount per unit | The first period's value; for "% of", the percentage; for "# per", the amount per unit |
| Repeats every N months | 1 monthly, 3 quarterly, 12 yearly, 0 once |
| Changes every N months, changing by | How often a % or # change applies and by how much; for logarithmic growth, the exponent |
| Using | What a "% of" or "# per" driver multiplies |
| For a maximum of N months | Stops after N months from the start |
| To a maximum value of | Caps any one month |
| Seasonality | A profile the driver follows |
| Escalation | None, the company default, or the driver's own terms |

The driver's start month and end month still come from the driver itself.

The calculation follows the Standard model's Forecast formula. Each occurrence carries the previous occurrence forward and applies the change on change months. Logarithmic growth is `initial × round(months since start ÷ N + 1)^exponent`, so an exponent between 0 and 1 grows fast and flattens. Every month is rounded to cents, half away from zero, as a spreadsheet's ROUND does.

## Linking drivers

The driver founders use most is a cost or revenue tied to something else: hosting at 4% of revenue, support at $12 per customer, a commission at 10% of total revenue. **Using** can name:

- an **operating metric** (below) or a forecast model variable, summed over its dimensions;
- a **statement line**, meaning every driver whose posting template's income or expense account is mapped to that Standard line (see [Standard statements](standard-statements.md));
- another **driver**.

References resolve in dependency order. A driver that refers back to itself, directly or through other drivers or a line it belongs to, is an exception on every driver in the loop and produces nothing until fixed. A reference to something that does not exist is an exception that names it. Neither is ever treated as zero.

## Operating metrics

Customers, headcount, orders, units: forecast series that drivers can be a percentage of or an amount per unit of. A metric has a name drivers use to refer to it, a label, a unit, a start and end month, and the same pattern inputs as a driver, so it can grow on its own or follow another metric. Metrics never post to the books. A metric that a driver or another metric uses cannot be removed until they change.

### Actuals

A metric takes actual values by month, typed into its **Actuals** grid or cited from an approved fact (a customer count read from a billing export, say). An actual can cite evidence or an approved fact; a fact still awaiting review cannot supply one. A recorded actual always wins over the pattern for its month. A pattern that grows on its own (fixed, % change, # change, logarithmic) continues from the last actual: it restarts in that month at the actual value, so the first forecast month is one step on from it. A metric that follows another metric keeps following it and only takes the actuals for months that have them.

## Seasonality

A profile is twelve calendar-month deviations from an average month, in percent, that sum to zero, so a year's total is unchanged. Each driver picks its own profile, or none. Seasonality shapes the output; growth compounds on the unseasoned value, so seasonality never compounds into growth.

## Escalation

A rate, a cycle of any number of months, and where the cycle is counted from: the driver's own start (like a lease anniversary) or a calendar month. It compounds once per cycle. Set a company default under **Default escalation** and opt drivers into it, or give a driver its own terms. A driver that uses the company default when none is set is an exception.

## From actuals

The **From actuals** section of the Drivers tab reads the last six months of actual income-statement history (the API takes 2 to 24) and proposes a pattern for each line, in this order of preference:

- **A share of revenue**, for anything but revenue, when revenue and the line both moved and the share held steady (its spread is at most 15% of its mean). Hosting that ran at 5% of revenue becomes "5% of total revenue".
- **Compound growth**, when a log-linear fit explains the history well (R² at least 0.8) and the rate is at least half a percent a month. The starting amount is projected one step past the last actual, so the forecast continues the trend instead of repeating last month.
- **The average**, otherwise.

Fewer than three months of history repeats the latest month, marked low confidence. Each suggestion shows its rationale, the history behind it and a confidence.

A line with no driver yet gets a new driver that posts to that account and settles through the account that settled it in the books: the cash account it was paid from, or the main cash account for a line booked through receivables or payables. A line with no cash side at all, like depreciation, is shown without a proposal. An existing driver gets a new pattern unless it is already linked (a % of or # per), which is never replaced by a statistic; the suggestion is shown beside it for comparison. A metric with actuals gets a suggestion the same way.

**Propose** creates a proposed decision citing the history; nothing changes until it is applied. Once proposed, **Apply** applies it from the same row. Applying every suggestion is enough to generate a full forecast from actuals alone.

## The agent

The agent proposes; Balsa calculates. It reads the drivers, metrics and their resolved months (`get_drivers`), each line's history with Balsa's suggestion ready to propose (`get_driver_history`), and approved facts (`read_facts`). It proposes changes as decisions with a structured effect, which preview and apply exactly like any other decision:

- a pattern or link on a driver (`set_item_pattern`), including links Balsa's statistics would not find, such as support at $12 per customer;
- a new driver from an account's history (`add_item` with a pattern);
- a metric, or a metric's actuals cited from approved facts (`set_metric`, `set_metric_actuals`);
- a driver that fits no pattern, as a formula over model variables (`set_dimension`, `set_variable`, `set_item_formula`).

One-off events (a fundraise, an office move, a price change in March) are ordinary decisions with a start month, so the Standard model's event and custom flags are not implemented: the agent proposing a dated decision does the same job with lineage.

## Rules that protect the forecast

- A driver has a pattern or a formula, never both.
- A pattern that would produce a negative amount is an exception; use the other direction instead.
- A pattern that has not been resolved for a window (plan pinning, projection previews) is never posted at its starting value.
- When a decision or scenario changes a patterned driver's amount from some month, a growing pattern restarts from the new amount; a "% of" or "# per" driver becomes the stated fixed amount.
- Every change to a pattern, metric, profile or the default escalation is audited and recalculates the forecast.

## In the workbook

The export's **Forecast** sheet lists the operating metrics and then each driver, grouped by statement line, in the Standard model's driver columns: initial value, starts in, ends in, repeats every N months, changing based on, changes every N months, changing by, using, a maximum number of months, a maximum value, seasonality and escalation (rate, cycle, and the calendar month it is counted from, blank for the driver's own start).

Each monthly cell is a formula over those columns implementing the same rules as the engine, so the blue inputs on a pale fill can be edited: change a growth rate, a start month or a seasonality profile and the driver, everything that refers to it, Statements, Summary and Checks recalculate. A helper row per driver, lower on the sheet, holds the value before seasonality, escalation and caps, because growth compounds on the unseasoned value. Seasonality profiles and the company escalation are inputs on Get Started; a driver picks its profile by name.

How an edit reaches the statements: each statement row a driver moves (its income or expense line and category, the account that settles it, net income not yet closed, and the cash flow section) gets a row under **Changes from Balsa**, the sum of each driver's live amount less Balsa's, cumulative for balances. A forecast month on Statements is Balsa's figure plus that change, so the downloaded file matches Balsa exactly and an edit settles the way the driver's entry does, in the same month. Balsa's own driver amounts are kept under **Balsa's driver amounts**, and Checks reports whether the formulas still reproduce them.

What "using" points at is fixed in the file: a `% of` or `# per` driver refers directly to the row it multiplies, shown by name in the Using column. Repoint it in Balsa and export again. (A spreadsheet lookup over rows that include the formula's own row is a circular reference in Excel and LibreOffice, which is why this one input is not editable in the file.)

**Formula drivers and the Model sheet.** The forecast model is its own sheet, **Model**: one row per variable and coordinate (headcount for eng, headcount for sales), one column per month from the as-of month to the horizon. Input variables are editable monthly values; a step input shows its value in every month it applies. Formula variables are cell formulas compiled from Balsa's formula language: references with selectors become cell references, `sum`, `avg`, `min` and `max` become the same spreadsheet functions over the coordinates they collapse, `prev()` reads the previous month (the as-of month reads itself, as in Balsa), and `round()` is ROUND. Multiplication and division are wrapped in `ROUND(…, 6)`, because Balsa computes in six decimal places. A formula driver on Forecast is a live formula over the Model sheet, rounded to cents, never below zero, and emitted on its own start, end and repeat inputs, so editing a headcount input moves every driver built on it. A model variable a pattern driver uses is the variable's total from the Model sheet. A variable whose compiled formula would not reproduce Balsa's values, or would be too long for a cell, is written as Balsa's values, and its dependents read those.

A scenario that changes the forecast model (an input or a formula) is not modelled on the Model sheet, which holds the base model: its formula drivers are written as Balsa's values for that scenario, so it still reconciles.

Some rows are written as Balsa's values, with the reason in the Source column: a driver with dated amounts, a driver Balsa reports an exception for, a growing driver that starts before the first month in the file, and any row whose formula would not reproduce Balsa's amounts to the cent. The exporter evaluates every formula the way a spreadsheet does before writing it (`simulateForecast` in `packages/model-export`), so a live row always matches Balsa when the file is downloaded. A model variable a driver uses is a values row beside the metrics.

**Scenarios.** Get Started has an **Active scenario** dropdown listing Base and every exported scenario. A scenario's drivers are rows of their own on Forecast, tagged in the Scenario column, for every driver the scenario adds and every driver whose pattern or amounts it changes, including one that only moves because something it is linked to moved. A scenario that changes an amount from a month shows as two rows, before and after. The In use column says which rows count for the active scenario: a base row steps aside while a scenario that replaces or ends it is active, and a scenario's row counts only while its scenario is. A reference to a driver sums all of that driver's rows, so links follow the active scenario too. Statements and the Balsa side of Checks pick the active scenario's figures, so switching the dropdown recalculates Forecast, Statements, Summary and Checks for that scenario, and every check reads "yes" in each one. The Scenarios sheet still shows every scenario's net income and cash side by side, as Balsa calculated them.

Escalation compounds exactly and rounds once to six places, as `ROUND((1 + rate)^n, 6)` does in a spreadsheet, so the engine and the file agree.
