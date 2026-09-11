# Financial engine plan

This plan closes the gap between what ingestion now captures and what the
financials use. Ingestion produces sources, observations, statement metadata,
facts, and review questions with provenance. The forecast and P&L read almost
none of it: they compute from bank-style cash rows through description regexes,
and the economic-state layer that the V0 specification centers on (agreements
with terms, obligations with due dates, assumptions, scenarios, allocations,
entities) is stored but never read by any calculation.

The plan has seven workstreams:

1. Rebuild the deterministic engine around dated schedule items.
2. Route every financial endpoint through one loader and one engine call.
3. Add an interpretation step between approved facts and Company State.
4. Resolve counterparties to entities and remember their treatment.
5. Make decisions, assumptions, and scenarios executable.
6. Apply allocations inside the engine.
7. Give the agent engine-backed tools and a lineage trace.

File paths are relative to the repository root.

## Starting point

Two calculation defects exist today, confirmed against the Company Zero fixture:

- `isDetailedFinancialEvent` in `apps/web/src/lib/financial-events.ts` gates
  which cash events enter the forecast and P&L. It requires brokerage-statement
  vocabulary, so ordinary bank descriptions such as "Customer payment",
  "Contractor invoice", and "ADP PAYROLL" are excluded from both.
- `buildMonthlyCash` in `packages/finance-engine/src/index.ts` adds forecast
  net and actual net together. A month with a 12,500 receipt that was both
  expected and received ends 25,000 higher than it started.

Beyond those, the forecast starts recurring items from the current calendar
month rather than their contractual months, opening cash is applied to the
earliest event month rather than the month it belongs to, facts become economic
items by regex, P&L categories are guessed from description text, policies and
decisions never change a number, assumptions and scenarios are written but never
read, allocations never reduce an expense, obligations settle by substring
match, and the agent reasons over a pre-computed array with simulated tools.

## Workstream 1: the engine

### Model

The engine is a pure function in `packages/finance-engine`. It has no
dependency on Next.js, the database, or a model provider.

```ts
type Month = string;                       // YYYY-MM
type Category =
  | "management_fee" | "other_revenue"
  | "salary" | "contractor" | "professional_services" | "software" | "insurance" | "other";
type Cadence = "once" | "monthly" | "quarterly" | "annual";
type Basis = "contractual" | "assumed";

type ScheduleItem = {
  id: string; label: string;
  counterparty?: string; counterpartyEntityId?: string;
  direction: "receipt" | "spend"; amount: number; category: Category;
  cadence: Cadence; effectiveFrom: Month; effectiveTo?: Month;
  accountingTreatment: "cash" | "accrual" | "prepaid";
  recognitionStart?: Month; recognitionEnd?: Month;
  basis: Basis; scenarioId?: string;
  provenance: { evidenceId?; sourceName?; decisionId?; policyId?; assumptionId? };
};

type ActualEvent = {
  id: string; month: Month; date?: string; description: string;
  amount: number; direction: "receipt" | "spend";
  activity: "operating" | "transfer" | "investment" | "financing";
  category?: Category; counterpartyEntityId?: string; settlesItemId?: string;
  accountingTreatment?; recognitionStart?; recognitionEnd?;
  provenance: { evidenceId?; sourceName? };
};

type AllocationRule = {
  id: string; eventId?: string; itemId?: string; counterpartyEntityId?: string;
  bearerEntityId: string; bearerName?: string; percentage?: number; amount?: number;
};

type EngineInput = {
  openingCash?: { month: Month; amount: number };
  asOfMonth: Month;
  horizon: { start: Month; end: Month };
  items: ScheduleItem[]; actuals: ActualEvent[]; allocations: AllocationRule[];
  closedMonths: Month[]; scenarioId?: string;
  statementBalances?: { month: Month; opening?: number; ending?: number }[];
};
```

### Rules

- **Expansion.** Each schedule item expands into expected events on its own
  calendar: once at `effectiveFrom`; monthly, quarterly, or annually from
  `effectiveFrom` to `effectiveTo` or the horizon end. A quarterly fee that
  starts in February lands in February, May, August, and November.
- **Scenario filter.** Items with no `scenarioId` are the base case. Items
  tagged with a scenario are included only when the input names that scenario.
- **Matching.** An actual settles an expected event when a persisted
  `settlesItemId` names the item, or, failing that, when it is in the same
  month with the same direction and either the same counterparty entity or an
  amount within half a percent. Each expected event is settled at most once.
- **History versus open months.** A month before `asOfMonth`, or a closed
  month, is history: cash moves only on actuals, and unsettled expected events
  become outstanding receivables or payables. An open month projects cash as
  opening plus actuals plus unsettled expected events. Nothing is counted
  twice.
- **Opening cash.** The roll starts at the month the opening balance belongs
  to. Earlier months still get a P&L but no cash balance.
- **Cash activity.** Transfers never move consolidated cash. Investment and
  financing activity move cash but never enter operating P&L.
- **P&L.** Operating actuals and unsettled expected events produce lines by
  category. Accrual and prepaid items spread evenly over their recognition
  range; everything else lands in its cash month. Revenue categories are
  `management_fee` and `other_revenue`.
- **Allocations.** An approved allocation that matches a spend line by event,
  item, or counterparty splits it: the allocated share leaves the company's
  expense and becomes a receivable due from the bearer, tracked as a running
  intercompany balance per entity.
- **Trace.** Every month carries its lines: actual, expected, recognized, and
  allocation entries with amount, category, basis, the item or event they came
  from, what settled them, and their provenance. This is the input for the
  agent's trace tool and the UI's "calculated from" panel.

Output per month: status, opening and ending cash, expected and actual
receipts and spending, contractual versus assumed totals, variance, P&L
totals by category, outstanding receivables and payables, intercompany
balances, statement balance difference when a statement exists, and lines.

## Workstream 2: one loader, one call

Add `apps/web/src/lib/financials.ts` with `loadFinancialInput(companyId, options)`
and `computeFinancials(companyId, options)`. The loader maps rows to the
engine model in one place:

- `economic_items` to schedule items, using the new date and category
  columns, with label-based fallbacks only for rows created before this plan.
- `cash_events` to actuals, using `category` as the activity class and the new
  `financial_category` column for the P&L category. Rows created by the old
  approval path from balance or summary facts are excluded by label; new
  approvals never create such rows.
- `allocations`, `reporting_periods`, and statement balances from `evidence`.
- Cross-source duplicates are collapsed once here by the existing event key,
  and the duplicate count is reported to reconciliation.

The forecast, P&L, months, obligations, reconciliation, and agent routes call
`computeFinancials` and shape its output. The description-vocabulary gate,
the regex category function, and the per-route dedup are deleted.

### Schema

Migration `0028`:

```text
economic_items
  + effective_from text, effective_to text
  + category text
  + basis text not null default 'contractual'
  + counterparty_entity_id uuid -> entities
  + scenario_id uuid -> scenarios, assumption_id uuid -> assumptions, decision_id uuid -> decisions
  + confidence text, rationale text

cash_events
  + financial_category text
  + counterparty_entity_id uuid -> entities
  + settles_item_id uuid -> economic_items

allocations
  + item_id uuid -> economic_items
  + counterparty_entity_id uuid -> entities

assumptions
  + scenario_id uuid -> scenarios, decision_id uuid -> decisions
  + effective_from text, effective_to text

decisions
  + effect text (JSON)
```

The `drizzle/meta` folder is not committed, so the SQL is written by hand in
the same style as the earlier migrations. Running `pnpm db:generate` on a
machine that has the snapshots produces the same statements.

## Workstream 3: interpretation

Approval today turns a fact such as `Fund I management fee: $75,000 quarterly`
into an economic item by matching "pay" or "bill" to decide direction and a
dollar sign to find the amount. The model already understood the fact; the
code throws that away and guesses again.

Replace the regex block in the evidence `PATCH` handler with one structured
model call, `interpretEvidence`, in `apps/web/src/lib/interpretation.ts`. Its
input is the approved facts and summary, the active policies, the knowledge
documents, the known entities with their categories, and the reporting month.
Its output is typed:

```text
items[]        label, counterparty, direction, amount, cadence, effectiveFrom,
               effectiveTo, category, accountingTreatment, recognitionStart,
               recognitionEnd, basis, confidence, rationale, appliedPolicy
transactions[] date, description, amount, direction, activity, category, counterparty
balances[]     kind (opening | ending), date, amount
questions[]
```

Items are inserted as `draft` with their confidence and rationale, and appear
in **Needs your input** as proposed items with confirm and reject actions and
a confirm-all action. The engine uses confirmed items only, so model inference
never silently becomes a forecast line. Transactions become actual cash events
with their category and counterparty already set. Balances set the reporting
period's opening cash and the statement balance for reconciliation; they never
become cash events.

Bank and OFX imports get the same treatment through `categorizeTransactions`:
a deterministic pass first matches descriptions against known entity aliases
and reuses that entity's category; only unmatched descriptions go to the
model, in batches. The result is persisted on each cash event. When the model
is unavailable the import still succeeds with the activity class only, and the
P&L shows those rows as uncategorized.

## Workstream 4: counterparty memory

Every categorized transaction or item names a counterparty. The loader and
interpretation code resolve that name to an `entities` row (type `vendor`,
`customer`, or `fund`), creating one when it is new, and store the matched
description as an alias in the entity's attributes along with its category.
A decision that recategorizes an entity updates the entity and every event
that points at it. The standing "how should these be broken out" review
question is retired; the first transaction from an unknown counterparty with a
low-confidence category asks one question about that counterparty instead.

## Workstream 5: decisions, assumptions, scenarios

A decision gains a structured `effect`:

```text
add_item       a full schedule item with basis 'assumed'
end_item       itemId, effectiveTo
change_amount  itemId, amount, effectiveFrom (ends the old item, adds a new one)
set_category   entityId, category
```

Applying a decision, whether from the review buttons or from the agent's
`resolvedDecisions`, executes its effect and records the decision id on the
resulting rows. The agent's `proposedDecisions` may carry an effect, so
"assume a finance contractor at $6,000 a month from January" becomes a
proposal whose approval creates an assumed schedule item that the forecast
shows separately from contractual lines.

Scenarios are a tag on schedule items. The forecast route accepts a scenario
id, and the agent gets a `simulate` tool that runs the engine in memory with a
list of effects and returns the base and simulated months side by side, so
"what if Fund II stops paying next year" is answered by the engine rather than
by the model's arithmetic.

## Workstream 6: allocations

Approved allocations already exist as rows. The engine applies them
(workstream 1), and the allocations route reports due-from balances from the
engine's intercompany output rather than by summing rows. A recurring rule is
an allocation row with a `counterparty_entity_id` and a percentage and no
event, which the engine applies to every matching spend.

## Workstream 7: agent tools and lineage

The agent route stops pasting two hundred events and a pre-computed array into
the prompt. It receives a compact summary from the engine (twelve months of
cash and P&L totals, outstanding items, open questions) and real tools:

```text
get_financials(startMonth, endMonth)   engine months with totals
trace_value(month, category | label)   the lines behind one figure, with provenance
get_obligations()                      outstanding payables and receivables
simulate(effects[])                    engine run with hypothetical effects
read_evidence(query)                   relevant source excerpts
```

The approval handler stops appending fact dumps to the forecast knowledge
document. Applied decisions with effects append one line under an
**Assumptions** heading there instead, which keeps that document about
methodology and assumptions as the specification intended.

## Delivery order

1. **Engine and loader** (workstreams 1, 2, 6). Fixes the two defects, moves
   calculation out of routes, applies allocations. Every existing screen keeps
   working with corrected numbers.
2. **Interpretation and counterparty memory** (workstreams 3, 4). Typed items
   with dates and categories start flowing into the engine.
3. **Decisions, scenarios, and agent tools** (workstreams 5, 7).

Each step is a separate commit that leaves the application working.

## Decisions taken in this plan

- Expected events are never counted alongside the actuals that settle them.
  When no link exists, the engine matches by month, direction, and either
  counterparty or amount. A persisted link always wins.
- A month before the current month is history. Its cash is actuals only.
- Categories are fixed to the specification's income statement lines. New
  categories are a schema change, not a free-text field.
- Interpreted items are drafts until the CFO confirms them.
- The transaction categorizer is one model call per import batch, with a
  deterministic alias pass first, so repeat counterparties never cost a call.
- Scenario runs are in-memory; a scenario is persisted only when a decision
  tags items with it.
