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

## Seasonality

A profile is twelve calendar-month deviations from an average month, in percent, that sum to zero, so a year's total is unchanged. Each driver picks its own profile, or none. Seasonality shapes the output; growth compounds on the unseasoned value, so seasonality never compounds into growth.

## Escalation

A rate, a cycle of any number of months, and where the cycle is counted from: the driver's own start (like a lease anniversary) or a calendar month. It compounds once per cycle. Set a company default under **Default escalation** and opt drivers into it, or give a driver its own terms. A driver that uses the company default when none is set is an exception.

## Rules that protect the forecast

- A driver has a pattern or a formula, never both.
- A pattern that would produce a negative amount is an exception; use the other direction instead.
- A pattern that has not been resolved for a window (plan pinning, projection previews) is never posted at its starting value.
- When a decision or scenario changes a patterned driver's amount from some month, a growing pattern restarts from the new amount; a "% of" or "# per" driver becomes the stated fixed amount.
- Every change to a pattern, metric, profile or the default escalation is audited and recalculates the forecast.

## In the workbook

The export's **Forecast** sheet lists each driver in the Standard model's driver columns, with the amount Balsa calculated for each forecast month, and the operating metrics. The amounts are values; making the driver rows live spreadsheet formulas is phase 4 of the spec.

## Not yet

- The agent cannot yet propose patterns or links; set them in the Drivers tab.
- Metrics cannot yet be fed from actuals (a customer count from a billing export).
- The Standard model's event and custom flags are not implemented.
