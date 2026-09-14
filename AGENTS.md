# Nevermodel agent guide

This file is the operating contract for coding agents working in this repository.
Read it before changing code. More detailed setup instructions live in
[`docs/agent-setup.md`](docs/agent-setup.md).

## First run

1. Run `pnpm run setup`. It creates `.env` without overwriting existing values,
   generates blank local secrets, prepares storage, installs dependencies,
   starts the local PostgreSQL service when applicable, and applies migrations.
2. Run `pnpm run doctor` and address every failure. Warnings may be acceptable for
   private local development; read them rather than suppressing them.
3. Run `pnpm dev` and open <http://localhost:3000>.

Never print, paste, commit, or replace a user's secrets. `.env` and `.env.local`
are private. When configuration is missing, name the variable and point to
`.env.example`; do not ask the user to disclose its value.

## Commands

- `pnpm run setup` — idempotent first-run setup. Use `--dry-run`, `--no-install`,
  `--no-docker`, or `--no-migrate` when appropriate.
- `pnpm run doctor` — read-only environment, storage, database, and migration checks.
- `pnpm run verify` — the standard release gate: doctor, typecheck, tests, and build.
- `pnpm acceptance` — Company Zero end-to-end accounting acceptance checks.
- `pnpm isolation` — company-isolation checks against a running application.
- `pnpm db:generate` / `pnpm db:migrate` — generate and apply schema migrations.

Run `pnpm run verify` before handing off a substantial change. Also run acceptance
for ingestion, accounting, reconciliation, or calculation changes, and isolation
for auth, company selection, company-scoped routes, or row-level security changes.

## Architectural invariants

- Models interpret evidence, suggest mappings, and draft explanations.
  Deterministic code validates journals and owns every reported calculation.
- Preserve the boundaries between evidence, company state, and financial state.
- Actual, forecast, and scenario entries use one journal/calculation engine and
  carry explicit state; do not introduce a parallel event engine.
- Every financial result must retain formula version, inputs, output, and source
  lineage. Unsupported results remain visibly unverified.
- Transfers never become revenue merely because cash moved. Debits equal credits,
  the balance sheet balances, and cash roll-forwards reconcile.
- Core accounting and forecasting rules are universal. Company knowledge stores
  only sourced, scoped, approved company facts, policies, mappings, and drivers.
- Every database access and mutation must remain company-scoped and auditable.

## Change safety

- Preserve unrelated work in a dirty tree. Never reset or discard changes you do
  not own.
- Never use real company data in tests or fixtures. Use synthetic or fully
  redacted examples.
- Schema changes require checked-in migrations, migration tests where material,
  and backward-aware error handling. Do not hide a missing migration in app code.
- Do not weaken auth, authorization, input validation, provenance, or audit logs
  to make a test pass.
- Bound model output and user-visible errors. Do not expose prompts, credentials,
  stack traces, raw provider responses, or sensitive source contents.
- Add a regression test for every accounting correction or security defect.

## Definition of done

A change is complete when its behavior is implemented, relevant tests cover it,
documentation and configuration examples agree with it, migrations are included
when needed, and the appropriate verification commands pass. Report any checks
that could not run and why.
