# Balsa

**Evidence-backed financial modeling and decisions.**

Balsa turns company evidence into auditable books, driver-based forecasts, and
reviewable operating decisions. Upload bank activity, invoices, contracts,
spreadsheets, or accounting exports; review what the system learned; then explore
what could happen, approve changes, and compare expectations with outcomes.

Review the model through statements, driver tables, charts, calculation traces,
and editable Excel exports. [Standard statements](docs/standard-statements.md)
and [forecast drivers](docs/forecast-drivers.md) connect the accounting model to a
formula-bearing workbook; supported returned edits become proposals for review.

[Operating models](docs/operating-models.md) let AI draft a decision-specific
structure of assumptions, relationships, and alternatives. Deterministic runs,
conditional policies, and bounded simulations help compare those alternatives.
[The decision workspace](docs/decision-workspace.md) brings saved drafts, assumptions,
cash comparisons, calculation details, and outcome tracking into five views.
Start with guided hiring inputs or describe a different decision.
[Goals & reviews](docs/goal-reviews.md) connect the outlook to cash targets,
preserved plans, approvals, and outcome reviews.
[The workspace](docs/review-and-workspace.md) places charts and statements beside
the chat in resizable columns.

Language models interpret meaning. Deterministic code owns the ledger, schedules,
calculations, controls, and statements. The model is never the calculator and
never the database.

> Balsa is under active development. It is ready for local evaluation and
> contribution, not unattended production accounting. Review all outputs before
> relying on them.

## Why Balsa

A CFO already has everything a financial model needs: evidence, context,
policies, assumptions, and judgment. The expensive part is translating all of
that into a spreadsheet—and keeping the spreadsheet alive as the business
changes.

Balsa is built around a different operating loop:

```text
evidence → extracted observations → CFO review → company state
         → journal and calculation graph → statements and forecast
         → alternatives → approval → observed outcomes → review
```

When the treatment is clear, the system does the work. When it requires
judgment, Balsa asks a precise question. The answer becomes a durable
decision or policy instead of disappearing into a chat transcript.

The aim is an adaptable operating model: analysts describe the mechanics that
matter for a decision, inspect the assumptions and consequences, and revise the
model as evidence changes. AI drafts the structure and explanations; controlled
application code validates, calculates, reconciles, and reports. Spreadsheet
exports extend that review surface. They are snapshots, with supported edits
returning through approval rather than live synchronization.

## What it does

- **Ingests the source material you already have.** PDF, CSV, XLSX, XLS, QBO,
  OFX, Markdown, text, and direct notes are retained with hashes and source
  metadata.
- **Turns evidence into reviewable accounting.** Extracted facts retain their
  source locations, confidence, and lineage. Models draft; people approve.
  [Review by confidence](docs/review-and-workspace.md) asks only about what falls
  below the owner's chosen level and keeps every assumption visible and reversible.
- **Maintains a real ledger.** Posting proposals pass deterministic validation
  before becoming authoritative journal entries.
- **Closes the books with controls.** Reconciliation, period-aware processing,
  coverage checks, and close gates make exceptions visible before a period is
  locked.
- **Builds three statements from one graph.** Income statement, balance sheet,
  and cash flow derive from the same journal and calculation path.
- **Forecasts from economic reality.** Contractual obligations, recurring
  schedules, assumptions, and actual settlements remain distinct and traceable.
- **Makes assumptions inspectable.** Linked drivers, operating metrics, growth,
  seasonality, escalation, and model variables expose how the forecast is built.
- **Compares operating decisions.** AI-drafted models, named cases, conditional
  policies, sampled outcomes, and saved experiments support review before a
  scenario changes the approved forecast. Simulation results depend on supplied
  assumptions; they are not automatically calibrated predictions.
- **Exchanges editable workbooks.** Standard-shaped exports carry live formulas,
  checks, and lineage. Supported returned inputs become proposed decisions;
  [round-trip controls and limits](docs/standard-model-review.md) define the supported scope.
- **Handles multi-entity finance.** Legal entities, allocations, intercompany
  balances, eliminations, consolidation, and foreign-currency translation share
  the same accounting foundation.
- **Answers questions with evidence.** Ask what changed, why a number exists, or
  what happens in a scenario; answers use approved state and engine-backed tools.
- **Learns company judgment.** Decisions, policies, mappings, and knowledge
  documents make future processing more consistent without silently turning an
  inference into fact.

## The trust model

Balsa separates three kinds of state:

1. **Evidence** — what a source said: a transaction, invoice, contract, export,
   or message, retained with provenance.
2. **Company state** — what the business believes exists or happened: entities,
   agreements, facts, obligations, decisions, policies, and assumptions.
3. **Financial state** — what follows mathematically: journals, balances,
   schedules, statements, reconciliations, and forecasts.

AI can interpret evidence and propose changes to company state. It cannot bypass
authorization, silently confirm its own inference, or perform the authoritative
financial math. A reported figure can be traced back through its formula and
posted lines to the source and human judgment that produced it.

Read [the security model](docs/security.md) for the current application
boundary.

## Current status

The repository contains a working Next.js application, PostgreSQL data layer,
evidence-ingestion pipeline, controlled finance agent, deterministic accounting
engine, operating-decision tools, and a local accounting evaluation suite with
synthetic fixtures. Standard statement mapping, driver patterns, a live workbook
export, and approval-based workbook return are implemented. These are bounded
workflows, not a universal business simulator or an unattended accounting service.
See the [Standard model review](docs/standard-model-review.md) for corrections,
support boundaries, and the distinction between exported formulas and engine replay.

## Deployment model and direction

Balsa is being built from a focused single-player product into a shared
financial system without weakening its company boundaries or audit trail.

| Mode | Users | Companies | Status |
| --- | --- | --- | --- |
| Private local | One | One | Available now, with optional no-login mode |
| Authenticated self-hosted | One | One | Available now with Better Auth |
| Local multi-company | One | Many | Available now; one operator switches between and creates separately scoped companies from the account menu, or declares them in `COMPANIES` |
| Self-hosted multi-user | Many | Many | Available now; every registered user can open every company, and an activity log records who changed what |

“Multi-company” and “multi-user” are deliberately separate concerns. Local
multi-company means one operator can manage several companies from a private
installation; it does not imply collaboration or public network exposure.
Self-hosted multi-user means everyone admitted by the sign-up code works across
all of the installation's companies. Per-company membership, invitations,
and hosted tenant operations are outside the scope of this repository.

## Quick start

Balsa includes an automated, non-destructive setup command. It creates the
local environment file when needed, generates blank application secrets,
prepares file storage, installs dependencies, starts local PostgreSQL, and
applies all checked-in database migrations. Existing configuration and secrets
are preserved.

### Requirements

- Node.js 22+
- pnpm 10+
- Docker
- An OpenAI or OpenRouter API key

```bash
git clone https://github.com/tdavidson/balsa.git
cd balsa
pnpm run setup
pnpm run doctor
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

See the [Balsa getting-started guide](https://www.balsamodel.com/docs/getting-started)
for detailed installation, configuration, authentication, and deployment
instructions.

For the shortest private local setup, set `AUTH_MODE=disabled` in `.env` and
configure `LOCAL_OWNER_EMAIL`. That address names the installation owner
permanently: in disabled mode it is the operator identity, and in Better Auth
mode the account registered with it owns the original company and its data.
Disabled auth does not protect the application from the network: use it only on
a trusted device or behind a VPN or access-controlled reverse proxy. Production
use also requires `ALLOW_AUTH_DISABLED=true`.

To start with more than one company, list them in `COMPANIES` as `Name` or
`Name:CUR` entries separated by commas, for example
`COMPANIES=Acme Holdings:USD,Beta GmbH:EUR`. They are created for the owner on
first sign-in, the first one becoming the default; names added to the list later
are created on the next sign-in, and editing or removing an entry never renames
or deletes a company. The account menu's **New company** does the same thing
interactively.

For email/password authentication, keep `AUTH_MODE=better-auth`, generate a
secret with `openssl rand -base64 32`, set `BETTER_AUTH_SECRET`, and set
`BETTER_AUTH_URL` to the application URL. Set `AUTH_ALLOW_SIGN_UP=true` only
while provisioning intended users; production sign-up is otherwise disabled.
Whenever sign-up is enabled on a reachable host, also set `AUTH_SIGN_UP_CODE`:
every registrant must type that code, so registration stays closed to everyone
who has not been given it.

To work with other people, give each of them that code so they can register.
Everyone who registers on a self-hosted installation can open every company,
including companies created later, and can create companies of their own.
**Activity** in the account menu lists what changed, who changed it, and when,
newest first. No mail is ever sent: the sign-up code alone decides who may
register, and registration decides who may work in the installation.

Set `NEXT_PUBLIC_SITE_URL` to the address of a public site carrying the product
documentation, and the application header shows a **How Balsa works** link
to it; leave it unset and no link is shown.

The complete configuration surface, including model providers, file storage,
OCR, auth migration, and background reconciliation, is documented inline in
[`.env.example`](.env.example).

Coding agents should begin with [`AGENTS.md`](AGENTS.md). The complete automated
workflow, setup flags, diagnostics, and full-app Docker quickstart are in
[`docs/agent-setup.md`](docs/agent-setup.md). To run the entire application in
containers after configuring `.env`, use `docker compose --profile full up --build`.

## Try the operating loop

1. Enter an opening cash balance, such as `opening cash 2026-09 $10,000`.
2. Attach source files. A cash chart draws from the statements right away, in
   pencil until approved. Choose how confident Balsa must be to proceed without
   asking, then decide what remains.
3. Confirm interpreted agreements and obligations so they can drive the forecast.
4. Import bank activity or a general-ledger export and review proposed mappings
   and journals.
5. Inspect forecast versus actuals, reconciliation, and close readiness.
6. Ask `Why is professional services $18,500 in October?` or
   `What if Fund II stops paying next year?` to trace or simulate the result.

Reusable sample inputs live in [`fixtures/company-zero`](fixtures/company-zero).

For a full single-company SaaS onboarding demo, use
[`Demo Lumenloop`](fixtures/demo-saas/README.md): nine months (January–September 2026) of entirely synthetic
bank activity, payment-processor collections and payouts, customer invoices, agreements,
payroll, SaaS metrics and accounting references, followed by a partial October
update. The guide includes upload order, decision exercises and expected results.
Run `pnpm demo:check` to verify the pack or `pnpm demo:generate` to regenerate it.

Financial planning review starts at `/progress`, with `/goals` for draft/primary
goals and preserved plans, `/reconciliation` for expectations and coverage,
`/goal-decisions` for scenario attribution and approval, and `/imports` for
reviewing full or partial evidence changes before financial posting. `/reviews`
adds forecast accuracy, named cases, timing sensitivity, assigned exceptions and
preserved sign-off. The progress page includes a guided first review, recognition
continuity and dated weekly cash. See
[goal reviews](docs/goal-reviews.md) for controls and supported accounting scope.


## Development

```bash
pnpm run setup    # non-destructive first-run setup
pnpm run doctor   # diagnose environment and migration readiness
pnpm run verify   # doctor, typecheck, test, and build
pnpm dev          # start the web application
pnpm build        # create a production build
pnpm typecheck    # typecheck every package
pnpm test         # run package tests
pnpm acceptance   # run the Company Zero acceptance path
pnpm lint         # lint every package
pnpm db:generate  # generate a migration from schema changes
pnpm db:migrate   # apply checked-in migrations
```

### Repository map

```text
apps/web                 Next.js interface and application routes
packages/accounting-evals deterministic accounting evaluation harness
packages/agent           controlled finance-agent boundary
packages/auth            provider-neutral authentication boundary
packages/company-state   canonical company-state types and operations
packages/database        PostgreSQL schema, migrations, and repositories
packages/finance-engine  ledger, calculations, statements, and forecasts
packages/ingestion       evidence ingestion and normalization
packages/model-export    Standard workbook formulas, checks, and edit parsing
packages/model-providers OpenAI and OpenRouter adapters
templates                company knowledge templates
```

The security posture is described in [`docs/security.md`](docs/security.md) and
the design system in [`docs/design-language.html`](docs/design-language.html).

## Contributing

Balsa is early, and contributions that improve correctness, auditability,
documentation, test coverage, or the self-hosted experience are welcome. Start
with [CONTRIBUTING.md](CONTRIBUTING.md). For larger changes, open an issue before
building so the accounting and product model can be discussed first.

Please report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

Balsa is open source under the [Apache License 2.0](LICENSE). You may use,
modify, and distribute it for personal or commercial purposes under its terms.

Built by [Taylor Davidson](https://taylordavidson.com).


## Optional bank connections

Connect selected bank accounts through your own Teller application. Configuration is entirely environment-based; see [Teller setup and testing](docs/teller.md). Bank sync stages transaction evidence for review and does not automatically approve financial postings.
