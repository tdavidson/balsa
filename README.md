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
- An interpretation step that turns approved facts into typed agreements and
  obligations (dates, cadence, category, treatment, counterparty), drafted for
  CFO confirmation
- Bank imports categorized against known counterparties first and the model
  second, with counterparties remembered as entities
- A deterministic engine (`packages/finance-engine`) that expands confirmed
  items on their own calendar, settles them with matching actuals, rolls cash
  from the opening balance's month, and produces P&L by category, outstanding
  receivables and payables, intercompany balances from allocations, and a
  trace for every figure
- Rolling 12-month forecast with contractual and assumed lines shown apart,
  closed-period guards, and reconciliation against statement balances
- Decisions with structured effects (add, end, or change an item; categorize a
  counterparty) that run when applied, and an in-memory simulation for
  what-if questions
- Three statements per legal entity and consolidated: the engine posts every
  line to a ledger, so the balance sheet balances and the cash flow statement
  ties to the income statement by construction, with intercompany P&L
  eliminated between consolidated entities

The controlled agent reads a summary from the engine and uses engine-backed
tools: financials by month, a trace for any figure, obligations, allocations,
and simulation. It proposes decisions with effects; nothing changes until the
CFO applies them. The plan behind this layer is in
`docs/plans/financial-engine.md`.

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

### Optional scanned-PDF OCR

For image-only or weak-text PDFs, install an `ocrmypdf`-compatible executable
in the deployment and set `NEVERMODEL_OCR_COMMAND=ocrmypdf`. Hemrock will use
its text sidecar only when normal PDF extraction is weak, retain OCR page
references, and flag OCR-derived facts for review. Without this setting, weak
PDFs remain blocked for review rather than being guessed.

### Background reconciliation

Set `CRON_SECRET` in the deployment to enable the protected processing drain.
On Vercel, `vercel.json` invokes `/api/jobs/reconciliation` every five minutes;
the route drains durable extraction and reconciliation runs through the same
idempotent handlers used by the interactive app. The endpoint rejects callers
without `Authorization: Bearer $CRON_SECRET`.

## Test the monthly workflow

1. Sign in and type `opening cash 2026-09 $10000` in the composer.
2. Attach one or more evidence files (`.pdf`, `.xlsx`, `.xls`, `.csv`, `.md`,
   `.txt`, or notes). Files are processed independently, even when they cover
   different months.
3. Review extracted facts, confidence, questions, and source metadata. Approving
   runs the interpretation step: agreements and obligations appear under
   **Interpreted items** for confirmation, transactions and balances are
   recorded directly. Confirmed items drive the forecast.
4. Attach a bank or transaction CSV/XLSX/QBO/OFX. Rows use their own dates; debit and
   credit columns are normalized, each row is categorized, and known
   counterparties are reused. Re-uploading the same file is ignored by hash.
5. Select a month to inspect forecast versus actuals. To close a period, type
   `close month 2026-09`; later imports or approvals referencing that month are
   rejected. Use `open month 2026-09` to reopen a period for correction.
   Persist CFO judgment with `decision: How should contractor invoices be treated? => Cash basis` or
   `policy: Contractor timing => Recognize on payment date`.
6. Ask `How much cash will we have in December?` to run the controlled agent.
   Ask `Why is professional services $18,500 in October?` for a trace, or
   `What if Fund II stops paying next year?` for a simulation. Tell it
   `Assume we hire a finance contractor at $6,000 a month from January` and it
   proposes a decision with an effect; applying it adds an assumed line to
   the forecast. Any proposed decision appears in Needs your input and must
   be explicitly applied or rejected.

7. Describe the structure once for entity and consolidated statements:
   `entity: Acme Management LLC`, `account: Chase 4432 => Acme Management LLC`,
   and `opening position Acme Management LLC 2026-01 cash=482314, prepaid=6000,
   payables=12500, investments=250000`. An entity is consolidated unless you add
   `(standalone)`. Bank imports resolve their account from the note typed with
   the upload or the file name. The entity selector next to the period switches
   the statements between each entity and the consolidated group; the balance
   sheet and cash flow tabs are derived from the same lines as the income
   statement. The plan is in `docs/plans/consolidated-statements.md`.

Migrations `0035` and `0036` add the schedule, category, settlement, entity,
account, and opening position columns. The
`drizzle/meta` snapshots are not committed, so run `pnpm db:migrate` to apply
the checked-in SQL, or `pnpm db:generate` on a machine with the snapshots to
regenerate an equivalent migration.

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

The financial engine plan lives in `docs/plans/financial-engine.md`, the
consolidated statements plan in `docs/plans/consolidated-statements.md`, and
the multi-tenant hosted plan in `docs/plans/multi-tenant-hosted.md`.
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
