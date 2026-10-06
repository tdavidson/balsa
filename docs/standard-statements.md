# Standard statements and the model timeline

Open **Accounting → Statements** and switch between **Ledger** and **Standard**.

This is the first slice of the [Standard Financial Model export](superpowers/specs/2026-10-05-standard-model-export-design.md): the mapping, categories, timeline and in-app view the export will write. Nothing is exported yet.

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

## Limits

- The cash flow section is the ledger's operating, investing and financing summary, not the Standard model's indirect method.
- The view shows the company's base currency and the consolidated company; entity and scenario selection are not in the Accounting modal yet.
- Agent proposals for mappings and categories are not yet available.
