# Demo Lumenloop: a reusable SaaS onboarding company

Every company, customer, person, account, document, transaction and amount in this
folder is invented for Balsa. Never replace any part of it with real company data. Stripe is the name of the
payment processor being simulated; these are simplified fictional exports, not
downloads from a real Stripe account. No credentials or usable account numbers exist.

The intended product is a **single-company installation**. Use a fresh disposable
installation/database for the demo, with `DEFAULT_COMPANY_NAME=Demo Lumenloop`.
Do not mix these uploads into an existing company's books. Resetting or deleting a
database is intentionally not automated here.

## Company and story

Lumenloop sells client-reporting software to design studios. Four employees serve
monthly, annual prepaid and invoiced enterprise customers. The pack contains nine
complete months, January–September 2026, plus three selected October settlements.
Use **October 1, 2026** as the historical review date, then **October 15** for the
follow-up. The files have fixed dates so the same inputs remain reproducible.
Balsa may use today's date for forecasting; check its as-of period explicitly.
Do not assume uploading the files changes the application clock or closes months.

The September review asks whether to hire a customer success manager in November
or wait until January. Growing recurring revenue coexists with losses, annual
prepayments, a late enterprise collection and a processor payout in transit.

Q1 starts with four monthly customers in January, adds two in February and two
in March, and reaches $12,000 MRR before the first annual contract in April.
The opening $250,000 contribution is dated December 31, 2025. Earlier operating
activity flows into later cash balances and retained earnings. April–September
service amounts and the original collection/reconciliation exercises are retained.
This is nine months of year-to-date history, not a complete calendar year.

If you already imported the earlier April–September pack, reset the demo company
before loading this version. The opening date and cumulative balances changed;
the new files are not an incremental upload onto the old opening balances.

## What is here

| Folder | Contents | Purpose |
| --- | --- | --- |
| `00-company` | Profile, opening balances, accounting policies, chart of accounts | Establish identity, opening capital, units and treatment |
| `01-onboarding` | Customer roster and subscription/vendor agreements | Establish sourced recurring terms and proposed forecast drivers |
| `02-history/bank` | Checking and savings CSVs, monthly statement summaries | Import actual cash movements and check coverage/balances |
| `02-history/stripe` | Charges, fees, refund, payout IDs and paid payouts | Explain gross-to-net collections and processor clearing |
| `02-history/billing` | Customer invoices, unpaid vendor invoice, source receipts | Review revenue timing, receivables, payables, prepaids and fixed assets |
| `02-history/people` | Aggregate payroll summary | Distinguish gross expense, net pay and remittances |
| `02-history/performance` | SaaS metrics and founder update | Review MRR, ARR, churn, cash and the hiring decision |
| `02-history/accounting-reference` | Balanced ledger, monthly trial balances, P&L, balance sheet, cash flow | Alternate import path and accounting comparisons |
| `03-october-update` | Partial bank extract, Stripe payout confirmation, collection notes | Settle existing balances without creating new income or expense |
| `04-edge-cases` | Overlapping bank extract and conflicting sales note | Exercise duplicate review and evidence conflicts separately |
| `expected` | Reconciliation guide and exact JSON results | Check answers; do not upload these as evidence |

CSV amounts are decimal USD, not thousands or cents. Negative bank amounts are
withdrawals. Negative Stripe amounts are refunds. Ledger debits and credits are
positive in separate columns. `expected-results.json` uses **integer cents**.
All identifiers start with `demo_`; emails use `example.test`. The customer roster
records baseline prices, and its related terms document records the September
downgrade. Financial statements contain monthly activity or month-end balances,
never year-to-date totals disguised as monthly values.

## A short first demo

1. Start a fresh company. Upload the profile, opening balances and accounting
   policies from `00-company`. Review the $250,000 opening cash/equity once.
2. Upload the two bank transaction CSVs from `02-history/bank`. The statements
   are optional corroborating summaries; they contain no extra transactions.
   Identify internal transfers and the $100,000 founder contribution correctly.
3. Upload the Stripe files and subscription agreements. Review the relationship
   between customer collections, fees, processor clearing and bank payouts.
   **A Stripe payout is not a second sale.** Do not bulk-approve interpretations
   that duplicate the bank receipts or mistake annual cash collections for one
   month's service revenue.
4. Add customer invoices, source receipts, payroll and the September unpaid vendor
   invoice. Review any required adjustments for revenue recognition, prepaids,
   depreciation, receivables and payables. Unsupported treatments should stay
   visibly unresolved; the reference answer must not conceal a product gap.
5. Add the customer roster, metrics and founder update. Ask for September
   performance and the hiring alternatives below. Compare with `expected` after
   Balsa has produced its own answer.
6. Add `03-october-update` only after the September review. Confirm the late
   collection and delayed payout settle existing balances. Keep October marked
   incomplete: the update is only three selected bank transactions.

For a faster **accounting-import demo**, use a second fresh installation and the
reference general ledger (which already includes opening entries and adjustments)
instead of building postings from bank/Stripe sources. Do not also post opening
balances or import all trial balances and statements as new ledger activity.
Use them as comparisons. Choose one posting path; the files are intentionally
overlapping representations of the same business, not additive datasets.

Markdown/text and CSV are supported evidence formats. The pack intentionally
avoids special seed APIs or live provider credentials. Import classification,
AI interpretation, accrual support and duplicate recognition still need review;
the existence of these fixtures does not establish that every workflow passes.

## Questions and expected behavior

| Exercise | What to check |
| --- | --- |
| “What changed in September MRR?” | $21,500 opening + $4,000 enterprise − $500 downgrade = $25,000; one-time refund is separate |
| “Why is revenue different from cash collections?” | Annual prepayments, enterprise receivable, fees, refunds and payout timing retain distinct treatment |
| “How much cash do we have at September 30?” | Checking plus savings; processor clearing disclosed separately; trace to statement balances |
| “Was June profitable because of the $100,000 deposit?” | Contribution is financing/equity and does not improve income |
| “What remains uncollected or unpaid?” | $4,000 enterprise AR and $1,800 vendor AP at September 30 |
| “Can we hire in November?” | Compare $8,250 recurring employer cost plus $3,000 recruiting cost with waiting; proposal stays unapproved |
| “What if enterprise collection is another month late?” | Change collection timing, preserve earned service revenue and source lineage |
| “Did October's deposit create new revenue?” | September receivable settlement and processor transfer, no new revenue |
| “Can we close October?” | No: selected transactions do not establish complete coverage |
| Re-upload the same bank file | Review idempotency; balances and income must not increase again |
| Upload `04-edge-cases/overlapping-checking-extract.csv` | Different bytes with overlapping activity; surface duplicate candidates or require explicit review rather than approve duplicate postings |
| Upload `04-edge-cases/conflicting-sales-note.md` | Flag unsupported $29,000 MRR / already-paid assertion; preserve sourced state pending review |

For the hiring comparison, use the same baseline in both alternatives. Assume no
new hiring-driven revenue, retention benefit or financing unless explicitly
proposed and approved. Ask for limitations on runway rather than treating a
simple cash/burn ratio as a complete forecast.

## Repeatable maintenance

From the repository root:

```sh
node fixtures/demo-saas/generate.mjs
node fixtures/demo-saas/generate.mjs --check
```

The generator uses only Node built-ins, integer-cent accounting and fixed dates;
it never connects to a database, calls a provider or reads private configuration.
Edit the specification in `generate.mjs`, then regenerate. `--check` writes
nothing: it recomputes the pack, checks stored bytes, and validates balanced
journals, balance sheets, cash flow, Stripe clearing and MRR/customer bridges.
Unexpected files in this folder fail verification so stale outputs are visible.

`manifest.json` lists each generated source/expected file, its role, byte count and
SHA-256. The hand-maintained README, generator and manifest itself are excluded
from the hash list. No generated timestamp changes between runs.

Keep a private demo-session checklist outside this fixture folder: app revision,
model/provider, upload order, observed outputs, discrepancies and screenshots.
The synthetic pack can be tracked; real customer uploads and application dumps
must never be added here. A fixture check proves internal consistency, not an
end-to-end Balsa onboarding result.
