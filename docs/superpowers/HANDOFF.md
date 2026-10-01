# Handoff: forecast consequences, scenarios, driver formulas

Last updated: 2026-09-18. Work stopped at a usage limit. Everything below is
committed. `main` was fast-forwarded locally to the feature branch (b656078),
so `main` and `feature/forecast-consequences` point at the same commit.
Nothing has been pushed. Continue the remaining work on a branch off `main`.

## Where these documents live

The user authorized copying the active handoff, scenario plan/spec, and
driver-formulas plan/spec back into this repository on 2026-09-18 so the
remaining work can be completed in one writable workspace. Their working
paths are under `docs/superpowers/`. Code paths inside them remain relative
to the repository root.

## The goal

When anything is approved, Balsa shows what it does to future cash,
burn, and runway. It shows this **before** approval as a preview and
**after** approval as a stored consequence, traced to the evidence that
caused it. The build sequence:

1. Record the cause of every revision.
2. Recalculate the forecast on every revision.
3. Diff runs into consequence records.
4. Preview before approval.
5. Scenarios on the same machinery.
6. Driver formulas with dimensions.

| Area | Status | Spec | Plan |
|---|---|---|---|
| Steps 1–4 (slice 1) | Done, reviewed | `specs/2026-09-18-forecast-consequences-design.md` | `plans/2026-09-18-forecast-consequences.md` |
| Follow-ups Group A (bulk attribution, monthly rollover, formula version .2, consolidated label, as-of echo, forecast trace, company-filter hardening) | Done, reviewed | (bounded, no spec) | — |
| Group B (actuals summary engine, 76× faster and proven equivalent; compact inputs; serialized jobs; cheap preview; forecast loaded once per request) | Done, reviewed | `specs/2026-09-18-forecast-performance-concurrency-design.md` | `plans/2026-09-18-forecast-performance-concurrency.md` |
| C1 traceability (source document named and linked; whole-document preview) | Done, reviewed | `specs/2026-09-18-consequence-traceability-design.md` | (executed from spec) |
| **C2 scenarios (step 5)** | **Done, reviewed; uncommitted in this sandbox** | `specs/2026-09-18-forecast-scenarios-design.md` | `plans/2026-09-18-forecast-scenarios.md` |
| **C3 driver formulas (step 6)** | **Done; Tasks 1–8 built and reviewed** | `specs/2026-09-18-driver-formulas-design.md` | `plans/2026-09-18-driver-formulas.md` |

Spec and plan paths in this table are relative to `balsa-site/internal/`.

## To do, in order

### 1. Scenarios: finish Tasks 3–6 of `plans/2026-09-18-forecast-scenarios.md`

- [x] Task 1: pure scenario changes (`apps/web/src/lib/scenario-changes.ts`). Commit eb88f96.
- [x] Task 2: migration 0074, storage, and the loaders. `loadForecastBase` is in `apps/web/src/lib/forecast-base.ts`; `loadScenarioForecast` is in `apps/web/src/lib/forecast-scenarios.ts`; `loadActiveScenario` and `ScenarioNotFound` are in `apps/web/src/lib/scenarios.ts`. Commit 0ae8587. Migration 0074 is applied to the local dev DB.
- [x] Task 3: scenario routes, CRUD, promotion, and from-decision. Includes serialized name claims, atomic audits, and decision-application idempotency.
- [x] Task 4: agent `simulate` and system prompt.
- [x] Task 5: dashboard scenario switcher, overlay bars, "vs base", editor, and "Try as scenario". Failure paths and repeat destructive actions are guarded.
- [x] Task 6: planner and implementation rulings recorded in the local scenarios spec.

### 2. Driver formulas: complete

- [x] Completed and reviewed Tasks 6–8 and the F1–F7/type/placeholder self-review in `plans/2026-09-18-driver-formulas.md`.
- [x] Reconciled the plan with landed scenario code and used migration `0075_forecast_model.sql`.
- [x] Executed Tasks 1–8: deterministic decimal formulas and cubes, dimensions/variables/inputs, forecast integration and lineage, model storage/APIs, atomic revision/outbox handling, decision and scenario effects, promotion, and the Model UI.
- [x] Applied migration 0075 locally. `pnpm run doctor` reports 76 migrations and current schema.
- [x] Final release gate: `pnpm run verify` passed with 142 finance-engine tests, 213 web tests, recursive typecheck, and production build.
- [x] Lint remains at the documented baseline of 10 errors and 13 warnings, with no new findings.
- [ ] `pnpm acceptance` reaches the Company Zero smoke script, then fails because committed `scripts/company-zero-smoke.ts` imports legacy `runEngine`, which is already absent at `HEAD`. Ingestion (15) and finance-engine (142) acceptance tests pass before that pre-existing failure.

### 3. Before merge

- [x] Final integrated blocker review of C1, C2, and C3 found no release-blocking/high correctness, security, company-isolation, accounting, transaction, API/UI, or migration issue. Base remains `c58df26^`, i.e. 905d560, for the eventual commit review.
- [ ] **Manual browser walkthrough by the user.** No agent could log in, so none of the UI has been seen in a browser. Check:
  - dashboard Runway figure, "What changed", and source links
  - draft item and document preview lines
  - Company settings: minimum cash
  - calculation trace for forecast figures
  - scenario switcher and editor
  - Model panel: dimensions, variables, dated inputs, dry-run samples, and saved/draft item Formula fields
- [x] Fast-forwarded into `main` locally (2026-09-18, at the user's request). Pushing to `origin` is still up to the user.

## Deferred items (not blocking)

- Nothing schedules `/api/calculations/process`, so failed calculation jobs are retried only by the next revision or the rollover. This is a deployment decision for the user.
- Residual race: a mutation commits its data and bumps the revision in separate transactions. The window is milliseconds. The full fix is to bump inside each of the ~24 callers' transactions.
- Library-level updates that filter by id only in `journal-posting.ts`, `apply-evidence.ts`, `decision-effects.ts`, `company-knowledge.ts`, and `calculation-outbox.ts`. The ids are already company-scoped by an earlier select; this is a defense-in-depth gap only.
- Minor UI polish:
  - trace values are unformatted
  - the trace opens the node list rather than the specific node
  - the Cash figure has no "consolidated" label
  - the `ledger/calculations` GET as-of can drift
- C1b: the group header has a fallback branch that can never be reached. Batch sources are ordered by DB row order.

## How the work is run (process and conventions)

- Specs, then plans, then subagent-driven development: `superpowers:subagent-driven-development`.
  - Each task gets an implementer, then a task reviewer (spec compliance plus quality).
  - Fix rounds are scoped re-reviews.
  - Each feature ends with a final whole-branch review on the most capable model.
  - Decisions made on the user's behalf are recorded as "Ruling: <what> — <why> — <cost if wrong>".
- The user has authorized autonomous execution for C1–C3, so don't check in between tasks.
- Task briefs come from the skill scripts:
  - `…/skills/subagent-driven-development/scripts/task-brief <plan> N`
  - review packages: `scripts/review-package <plan> BASE HEAD`
  - Both write into a git-ignored workspace under `.superpowers/sdd/<plan-name>/`.
  - The progress ledgers there (`c-series/progress.md`, `2026-09-18-forecast-scenarios/progress.md`) hold the full ruling history. Everything that matters is summarized in this file.
- Environment facts:
  - The local dev Postgres is `postgresql://localhost:5432/finance`, set via `.env`. DB-backed tests run against it; this is approved. Each test creates and deletes its own company.
  - The dev connection pool has **1 connection**. Nothing inside `runForecastJob`'s transaction may call `getDatabase()`, or it deadlocks.
  - Migrations are handwritten SQL plus a `drizzle/meta/_journal.json` entry, in the 0072 style: new tables get RLS. Apply with `pnpm --filter @finance/database db:migrate`.
  - Verify with:
    - `pnpm test`
    - `pnpm -r typecheck`
    - `pnpm --filter @finance/web lint`, whose baseline is **10 errors / 13 warnings, all pre-existing**. Add none.
  - Latest full release gate (2026-09-19): 142 finance-engine tests and 213 web tests green; recursive typecheck and production build pass.
  - TypeScript runs strict with `exactOptionalPropertyTypes`. Use conditional spreads.
  - Money is minor units as strings or bigint.
  - `forecastFormulaVersion` = `"forecast-run-2026-09-18.2"`. Don't bump it unless the output changes.
  - Commit trailers name the model that wrote the commit.
