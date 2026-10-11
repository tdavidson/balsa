# Review by confidence, and the three-column workspace

The home page puts the chat on the left, charts in the middle, and statements on
the right. Review asks only about what needs a person; everything Balsa assumed
stays listed and reversible.

## Decide what Balsa may assume

Under **Needs your input**, the owner chooses one level:

> Proceed without asking when Balsa is at least **Always ask · 95% · 90% · 80%** confident.

**Always ask** is the default and keeps today's behavior: every source and every
extracted fact waits for a person. Choosing a level is itself the decision: from
then on, Balsa accepts what it can check at that level and asks about the rest.
Only the company owner can change the level. Every change is audited
(`company.review_confidence_changed`).

### How confidence is assessed

The extraction model reports its own confidence for each fact. Deterministic code
then checks the fact, and each failed check caps the score:

| Check | Cap | Reason shown |
| --- | --- | --- |
| The accounting role is `unknown` | 40% | The source does not establish an accounting role |
| A balance, transaction, revenue, expense, transfer, investment, or financing value is not a readable amount | 50% | The value is not a readable amount |
| The amount (or text value) is not found in the stored source text | 60% | The amount was not found in the source text |

The lowest level the owner can choose is 50%, so a fact with no accounting role is
never assumed. A source's identity is assessed from intake classification: a
high-confidence recognized source with a reporting period scores 95%, medium
80%, and low 50%. Unrecognized sources, sources without a period, and reference
models always need a person.

### What the review shows

- **Confirm these sources.** Sources whose identity falls below the level. Their
  facts are not listed until the source is confirmed.
- **Your decision · largest first.** Facts below the level, ranked by amount and
  then by lower confidence, each with the one reason it needs a person. One click
  accepts the fact and its treatment as the two audited approval layers. A fact
  without an accounting role needs a treatment chosen first. The first five are
  shown; the rest are one click away.
- **Less important.** Facts below the level whose amount is under 1% of the
  document's largest amount. They are collapsed, and still need acceptance before
  the document publishes. **Accept all with a treatment** accepts those with a
  known accounting role as a person's decision.
- **Assumed.** Sources and facts Balsa accepted under the level, with the
  checked confidence and the level at the time. **Ask me instead** returns a fact
  to review; Balsa never assumes that fact again.

Accepting under the level uses the same approval events and publication path as
a manual approval. Each approval event records `basis: "confidence_threshold"`,
the level, the score, and the reasons, and an `evidence.assumed` audit row is
written. Publication still runs only when every fact in a document carries an
approved treatment. If publication fails after acceptance (for example, because
the model provider is unavailable), the acceptances remain and the response says
`publication: "failed"`; the document publishes on its next approval or retry.

The automatic pass runs from the open workspace through
`POST /api/evidence/:id/accept` with `{ "scope": "assumed" }`. It requires the
`x-company-id` header to match the selected company. Each document is attempted
once per state, so a fact the server declines never causes a request loop.

## Charts from the first upload

The middle column always has a chart. Before anything is approved, it draws a
**cash balance** line from the ending balances that extraction read from
statements: one balance per account per month, the most recently loaded
statement winning, in the company's base currency only. Months whose balances are
not all approved are drawn in pencil and labeled *extracted, not yet approved*;
they are presentation of evidence, not reported results. The statements column
lists the same balances as a table.

Once the journal engine reports cash, its results replace the extracted line:

- **Cash balance:** ending cash each month, actual in ink and forecast in
  pencil, with an optional scenario line.
- **Net cash flow:** by the chosen cadence, with scenario outlines.
- **Revenue and expenses:** side by side on one axis.

The charts cover the whole timeline from its first month with cash or activity.
The selected period is highlighted, and selecting a month or bar inspects it. The
figures above the charts and the statements on the right follow the selected
period. The workspace opens on the latest closed month.

## Resize the columns

Drag the line between two columns to resize them. A handle can also be focused
and moved with the arrow keys, and double-clicking or pressing Enter restores
the defaults. Widths are remembered in this browser. Each column keeps a minimum
width and scrolls on its own. Below the `lg` breakpoint the columns stack: chat,
then charts, then statements.

## Storage

Migration `0098_review_confidence.sql` adds `companies.review_confidence_threshold`
(nullable text, 0.5 through 1; null means always ask). Apply it with
`pnpm db:migrate`. Without it, the policy and acceptance routes return a 503 that
names the command.
