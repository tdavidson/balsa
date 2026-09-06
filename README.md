# nevermodel — LLM-native finance system

nevermodel is an auditable financial operating system that separates external
evidence, interpreted company state, and deterministic financial calculations.
The interface is conversational; financial math and authorization remain in
controlled application code.

## Current milestone: Monthly close and forecast loop

The repository currently implements the secure product foundation and a testable
monthly close loop:

- Next.js App Router application with a single reading-column page at `/`
- Clerk authentication with a custom email-code sign-in at `/login` (new emails are provisioned on first sign-in)
- internal users, companies, and company memberships in PostgreSQL
- server-side company authorization that never trusts a browser company ID
- first-login user/company provisioning with concurrency protection
- Drizzle schema and SQL migration
- provider-neutral model interface
- OpenAI Responses API and OpenRouter adapters
- local PostgreSQL through Docker and hosted PostgreSQL through `DATABASE_URL`
- Vercel-compatible standalone build
- PDF text extraction, CSV transaction normalization, XLSX worksheet parsing, and QuickBooks/OFX transaction bootstrap
- Source metadata, SHA-256 lineage, raw source retention, and linked cash events
- Evidence review with confidence, unresolved questions, and approve/edit/reject actions
- Confirmed agreement/obligation normalization and deterministic forecast vs. actuals
- Categorized monthly P&L endpoint with calculation traces
- Rolling 12-month forecast, opening cash, new actual imports, and closed-period guards

The controlled agent can read authorized state, query forecasts, trace values,
and propose decisions for review. Canonical state writes include allocation
records and policy provenance. Profile/settings surfaces remain future
milestones.

## Local setup

Requirements: Node.js 22+, pnpm 10+, Docker, a Clerk application, and either an
OpenAI or OpenRouter API key.

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:migrate
pnpm dev
```

Add the Clerk publishable and secret keys to `.env`. Configure email
code sign-in in the Clerk dashboard. The first successful login provisions an
internal application user, a company, and an `owner` membership.

## Test the monthly workflow

1. Sign in and type `opening cash 2026-09 $10000` in the composer.
2. Attach one or more evidence files (`.pdf`, `.xlsx`, `.xls`, `.csv`, `.md`,
   `.txt`, or notes). Files are processed independently, even when they cover
   different months.
3. Review extracted facts, confidence, questions, and source metadata. Approve
   facts to create normalized agreements/obligations and forecast events.
4. Attach a bank or transaction CSV/XLSX/QBO/OFX. Rows use their own dates; debit and
   credit columns are normalized. Re-uploading the same file is ignored by hash.
5. Select a month to inspect forecast versus actuals. To close a period, type
   `close month 2026-09`; later imports or approvals referencing that month are
   rejected. Use `open month 2026-09` to reopen a period for correction.
   Persist CFO judgment with `decision: How should contractor invoices be treated? => Cash basis` or
   `policy: Contractor timing => Recognize on payment date`.
6. Ask `How much cash will we have in December?` to run the controlled agent.
   Any proposed decision appears in Needs your input and must be explicitly
   applied or rejected.

Reusable Company Zero examples are in `fixtures/company-zero/`.

## Commands

```bash
pnpm dev          # web application
pnpm build        # production build
pnpm typecheck    # all packages
pnpm test         # all package tests
pnpm acceptance   # Company Zero ingestion + close/forecast acceptance checks
pnpm lint         # all packages
pnpm db:generate  # generate a migration from schema changes
pnpm db:migrate   # apply checked-in migrations
```

## Security boundary

Clerk IDs identify external sessions only. Financial records will use internal
UUIDs and a required `company_id`. Every server-side company operation must call
the application auth boundary and prove membership before data access. Agent
tools will receive the authorized company from server context, never from model
output or an unverified browser parameter.

## Reference

The V0 build specification and its authentication additions live in
`docs/specs/`. The design language is documented in `docs/design-language.html`.
The in-app version of the manifesto is at `/about`.

## Repository map

```text
apps/web                 Next.js UI and Clerk adapter
packages/auth            provider-neutral auth service and types
packages/database        PostgreSQL schema, migrations, repositories
packages/model-providers OpenAI/OpenRouter boundary
packages/company-state   next milestone boundary
packages/finance-engine  deterministic calculation boundary
packages/agent           controlled finance agent boundary
packages/ingestion       evidence ingestion boundary
templates                company knowledge templates
```
