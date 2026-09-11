# Consolidated statements plan

This plan takes the engine from one pool of cash and an income statement to
a full set of statements per legal entity and consolidated: income statement,
balance sheet, and cash flow statement that tie to each other by construction.
It builds on `docs/plans/financial-engine.md`.

Four workstreams:

1. Give every cash event and schedule item a legal entity and an account.
2. Derive balances from the engine's lines with posting rules.
3. Run the engine per entity and consolidated, with intercompany elimination.
4. Capture opening positions beyond opening cash.

File paths are relative to the repository root.

## Starting point

The engine produces, per month, cash movements, P&L by category, outstanding
receivables and payables, intercompany balances from allocations, and a trace
line for every figure. Each line already says whether it moves cash and
whether it is recognized in the P&L, and each actual carries an activity class
(operating, transfer, investment, financing). Evidence records which account a
statement belongs to, and cash events carry a counterparty entity.

What is missing: cash events and schedule items do not know which of the
company's own legal entities they belong to; transfers are excluded rather
than posted between accounts; the balance sheet tab shows cash only; the cash
flow tab shows zero investing and financing; and nothing eliminates a
management fee that one group entity pays to another.

## Workstream 1: entity and account dimension

### Schema

Migration `0029`:

```text
entities
  + owner_entity_id uuid -> entities      (an account's owning legal entity)
  + consolidated char(1) default 'N'      (legal entity included in the group)

cash_events
  + account_entity_id uuid -> entities
  + entity_id uuid -> entities

economic_items
  + entity_id uuid -> entities

opening_positions
  id, company_id, entity_id (nullable), account_entity_id (nullable),
  month text, ledger text, amount text, created_at, updated_at
  unique (company_id, entity_id, account_entity_id, month, ledger)
```

A legal entity is an `entities` row with `type = "legal_entity"`. When a
company has none, the company itself is the single implicit entity and every
row belongs to it.

### Stamping

- Statement imports take the account from the evidence's matched account and
  the entity from that account's owner.
- Bank and OFX imports take the account from an explicit `account` form
  field, from the note typed with the upload, or from an account identifier
  in the file name. When the company has exactly one account, it is the
  default. When the account cannot be resolved and the company has more than
  one, the import succeeds and asks one review question naming the file.
- Interpreted items carry an `entity` name when the evidence names one; the
  loader resolves it to a legal entity, or falls back to the owner of the
  evidence's account, or the default entity.
- Composer commands manage the structure without a settings screen:
  `entity: Synthetic Example Company Advisory LLC`, `account: Chase 4432 => Synthetic Example Company Advisory LLC`,
  and `opening position Synthetic Example Company Advisory LLC 2026-01 cash=482314, prepaid=6000,
  receivables=75000, investments=250000`.

## Workstream 2: posting rules and the balance roll

The engine keeps its lines and adds a balance sheet and a cash flow statement
per month. Balances come from cumulative flows, so the three statements tie.

### Working capital per key

Every recognized or cash line belongs to a key: the expected event it comes
from or settles, or the actual itself when nothing matches. Per key the engine
tracks cumulative recognized amount `R` and cumulative cash `C`:

```text
spend, R > C   accounts_payable (cash-basis item) or accrued_liabilities (accrual)
spend, C > R   prepaid_expenses
receipt, R > C accounts_receivable
receipt, C > R deferred_revenue
```

A prepaid policy paid in September and recognized through December produces a
prepaid balance that runs down monthly. An invoice accrued August to October
and paid in October produces an accrued liability in August and September. An
expected fee not received in a history month is revenue and a receivable.

One rule changes: an unsettled expectation in a history month is now
recognized (it was incurred) and appears as a payable or receivable, rather
than staying out of the P&L. Cash still moves only on actuals.

### Other balances

```text
cash                    opening cash by account + cumulative cash lines by account
due_from_affiliates     cumulative allocations to bearers
investments             opening + investment spend − investment receipts
transfers_in_transit    cumulative transfers (nets to zero once both accounts are imported)
financing               cumulative financing receipts − financing spend (equity side)
retained_earnings       cumulative operating income
opening_equity          opening assets − opening liabilities in the opening month
```

Assets equal liabilities plus equity in every month because each line posts
two sides. The cash flow statement is the indirect method: net income adjusted
for working-capital changes gives operating cash; investing, financing, and
transfers follow their activity classes; the sum equals the change in cash.

## Workstream 3: per-entity and consolidated runs

The loader filters items, actuals, allocations, statement balances, and
opening positions by entity when a view asks for one entity. The consolidated
view includes everything and treats a counterparty that is a consolidated
legal entity as intercompany: its recognized lines move from revenue or
expense to due-from or due-to affiliates, and the consolidated balance sheet
nets due-from against due-to. A fund whose books are not imported should stay
unconsolidated; its fee is then ordinary revenue with a receivable.

Routes take `entity=<id>` or `entity=consolidated`. A new `/api/statements`
returns the three statements per month for one view, and the agent gets
`get_statements`.

## Workstream 4: opening positions

`opening_positions` rows replace the single opening cash figure for balance
sheet purposes. Cash rows are per account; other ledgers (prepaid, receivables,
payables, accrued liabilities, deferred revenue, investments, due from and to
affiliates) are per entity. The month's opening equity is the plug. The
existing `opening cash` command keeps working: it writes a cash position with
no account for the default entity.

## Delivery order

1. Engine: entity and account on lines, posting rules, balance sheet, cash
   flow statement, consolidation with elimination, tests.
2. Schema, loader, stamping in imports and interpretation, entity and
   position routes, composer commands.
3. Statements route, agent tool, entity selector and populated balance sheet
   and cash flow tabs in the UI.

## Decisions taken in this plan

- Consolidation is opt-in per legal entity. Nothing is eliminated unless both
  sides are group entities.
- Balances derive from lines; there is no separate journal table. The trace
  line is the journal.
- Unsettled history expectations are recognized and carried as payables or
  receivables, which is the accrual view the statements need.
- Transfers between own accounts post to a transit balance rather than being
  dropped, so a missing statement shows up as a non-zero transit balance.
- Investments are carried at cost from cash activity and opening positions;
  valuation against statement market values is a later step.
