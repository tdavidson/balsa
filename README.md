# Nevermodel

**An open-source financial operating system you talk to—and that never does the math by talking.**

Nevermodel turns the evidence a company already produces into an auditable,
continuously maintained financial model. Upload bank activity, invoices,
contracts, spreadsheets, or accounting exports; review what the system learned;
then ask questions, close periods, and change the forecast in plain language.

Language models interpret meaning. Deterministic code owns the ledger, schedules,
calculations, controls, and statements. The model is never the calculator and
never the database.

> Nevermodel is under active development. It is ready for local evaluation and
> contribution, not unattended production accounting. Review all outputs before
> relying on them.

## Why Nevermodel

A CFO already has everything a financial model needs: evidence, context,
policies, assumptions, and judgment. The expensive part is translating all of
that into a spreadsheet—and keeping the spreadsheet alive as the business
changes.

Nevermodel is built around a different operating loop:

```text
evidence → extracted observations → CFO review → company state
         → journal and calculation graph → statements and forecast
```

When the treatment is clear, the system does the work. When it requires
judgment, Nevermodel asks a precise question. The answer becomes a durable
decision or policy instead of disappearing into a chat transcript.

This is not Excel in a browser: there is no grid and no collection of formulas
to maintain. It is not a chatbot wrapped around accounting software either:
the AI proposes meaning and treatment, while controlled application code posts,
calculates, reconciles, and reports.

## What it does

- **Ingests the source material you already have.** PDF, CSV, XLSX, XLS, QBO,
  OFX, Markdown, text, and direct notes are retained with hashes and source
  metadata.
- **Turns evidence into reviewable accounting.** Extracted facts retain their
  source locations, confidence, and lineage. Models draft; people approve.
- **Maintains a real ledger.** Posting proposals pass deterministic validation
  before becoming authoritative journal entries.
- **Closes the books with controls.** Reconciliation, period-aware processing,
  coverage checks, and close gates make exceptions visible before a period is
  locked.
- **Builds three statements from one graph.** Income statement, balance sheet,
  and cash flow derive from the same journal and calculation path.
- **Forecasts from economic reality.** Contractual obligations, recurring
  schedules, assumptions, and actual settlements remain distinct and traceable.
- **Handles multi-entity finance.** Legal entities, allocations, intercompany
  balances, eliminations, consolidation, and foreign-currency translation share
  the same accounting foundation.
- **Answers questions with evidence.** Ask what changed, why a number exists, or
  what happens in a scenario; answers use approved state and engine-backed tools.
- **Learns company judgment.** Decisions, policies, mappings, and knowledge
  documents make future processing more consistent without silently turning an
  inference into fact.

## The trust model

Nevermodel separates three kinds of state:

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
engine, and local accounting evaluation suite. The current development focus is
deepening the month-close workflow, calculation graph, and representative
real-company test corpus.

## Deployment model and direction

Nevermodel is being built from a focused single-player product into a shared
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
all of the installation's companies. A hosted service with per-company
membership, invitations, and tenant operations is developed separately and is
not part of this repository.

The accounting core is already company-scoped; local company creation and
switching, shared multi-user access, and the audit log are in place. The path
forward is to finish the single-company close and forecast loop, then harden the
worker, storage, and authorization paths. The plans are documented separately in
[local multi-company](docs/plans/local-multi-company.md) and
[multi-user](docs/plans/multi-user.md).

## Quick start

### Requirements

- Node.js 22+
- pnpm 10+
- Docker
- An OpenAI or OpenRouter API key

```bash
git clone https://github.com/tdavidson/nevermodel.git
cd nevermodel
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:migrate
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

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
documentation, and the application header shows a **How Nevermodel works** link
to it; leave it unset and no link is shown.

The complete configuration surface, including model providers, file storage,
OCR, auth migration, and background reconciliation, is documented inline in
[`.env.example`](.env.example).

## Try the operating loop

1. Enter an opening cash balance, such as `opening cash 2026-09 $10,000`.
2. Attach source files and review the extracted facts, confidence, questions,
   and provenance.
3. Confirm interpreted agreements and obligations so they can drive the forecast.
4. Import bank activity or a general-ledger export and review proposed mappings
   and journals.
5. Inspect forecast versus actuals, reconciliation, and close readiness.
6. Ask `Why is professional services $18,500 in October?` or
   `What if Fund II stops paying next year?` to trace or simulate the result.

Reusable sample inputs live in [`fixtures/company-zero`](fixtures/company-zero).

## Development

```bash
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
packages/model-providers OpenAI and OpenRouter adapters
templates                company knowledge templates
```

Architecture and implementation notes live in [`docs/plans`](docs/plans), the
original build specification is in [`docs/specs`](docs/specs), and the design
system is documented in [`docs/design-language.html`](docs/design-language.html).

## Contributing

Nevermodel is early, and contributions that improve correctness, auditability,
documentation, test coverage, or the self-hosted experience are welcome. Start
with [CONTRIBUTING.md](CONTRIBUTING.md). For larger changes, open an issue before
building so the accounting and product model can be discussed first.

Please report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

Nevermodel is open source under the [Apache License 2.0](LICENSE). You may use,
modify, and distribute it for personal or commercial purposes under its terms.

Built by [Taylor Davidson](https://taylordavidson.com).
