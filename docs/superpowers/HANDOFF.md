# Handoff: forecast consequences, scenarios, driver formulas

Last updated: 2026-09-18. Work stopped at a usage limit. Everything below is
committed. `main` was fast-forwarded locally to the feature branch (b656078),
so `main` and `feature/forecast-consequences` point at the same commit.
Nothing has been pushed. Continue the remaining work on a branch off `main`.

## The goal

When anything is approved, Nevermodel shows what it does to future cash,
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
| **C2 scenarios (step 5)** | **Tasks 1–2 of 6 done** | `specs/2026-09-18-forecast-scenarios-design.md` | `plans/2026-09-18-forecast-scenarios.md` |
| **C3 driver formulas (step 6)** | **Plan incomplete (Tasks 1–5 of 8 written); nothing built** | `specs/2026-09-18-driver-formulas-design.md` | `plans/2026-09-18-driver-formulas.md` |

All paths are under `docs/superpowers/`.

## To do, in order

### 1. Scenarios: finish Tasks 3–6 of `plans/2026-09-18-forecast-scenarios.md`

- [x] Task 1: pure scenario changes (`apps/web/src/lib/scenario-changes.ts`). Commit eb88f96.
- [x] Task 2: migration 0074, storage, and the loaders. `loadForecastBase` is in `apps/web/src/lib/forecast-base.ts`; `loadScenarioForecast` is in `apps/web/src/lib/forecast-scenarios.ts`; `loadActiveScenario` and `ScenarioNotFound` are in `apps/web/src/lib/scenarios.ts`. Commit 0ae8587. Migration 0074 is applied to the local dev DB.
- [ ] Task 3: the scenario routes: CRUD, `GET /[id]/forecast`, `POST /[id]/promote`, and `POST /from-decision`. The first attempt was killed before it wrote anything, so start fresh.
- [ ] Task 4: re-enable the agent `simulate` tool and update the system prompt.
- [ ] Task 5: dashboard scenario switcher, overlay bars, the "vs base" line, the scenario editor dialog, and "Try as scenario" on proposed decisions.
- [ ] Task 6: write the planner's rulings into the scenarios spec.

### 2. Driver formulas: finish the plan, then build it

- [ ] Finish `plans/2026-09-18-driver-formulas.md`. It currently ends at Task 5. Append these, **writing each task to the file as soon as it's complete**, because two planner runs died mid-write:
  - Task 6: new decision effects `set_variable`, `set_dimension`, and `set_item_formula`, plus generalizing `projectDecisionEffectOnDrivers` into `projectDecisionEffect(input, effect)`, a preview parity DB test, and the agent prompt grammar.
  - Task 7: scenario change kinds `set_input` and `set_formula`, with `applyScenarioChanges` working at the input level, and promotion to `set_variable`.
  - Task 8: the Model panel (accounting modal tab) with a dimensions editor, a variables editor with a debounced `/validate` dry run, and an inputs grid, plus the item "Formula" field.
  - Then a self-review: a spec coverage table for F1–F7, a placeholder scan, and a type-consistency check.
- [ ] Before executing, check the plan against the scenarios code as it actually landed (`scenario-changes.ts`, `forecast-base.ts`, `forecast-scenarios.ts`, the promote route) and the migration numbering. Scenarios took 0074, so formulas gets 0075 or the next free number.
- [ ] Execute Tasks 1–8 with per-task reviews, then a final whole-branch review.

### 3. Before merge

- [ ] Final whole-branch review of C1, C2, and C3 together, on the most capable model. Base: `c58df26^`, i.e. 905d560, the C1 spec commit.
- [ ] **Manual browser walkthrough by the user.** No agent could log in, so none of the UI has been seen in a browser. Check:
  - dashboard Runway figure, "What changed", and source links
  - draft item and document preview lines
  - Company settings: minimum cash
  - calculation trace for forecast figures
  - scenario switcher and editor
  - Model panel
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
  - Last full run: 274+ tests green. Web is at 164 after C2 Task 2.
  - TypeScript runs strict with `exactOptionalPropertyTypes`. Use conditional spreads.
  - Money is minor units as strings or bigint.
  - `forecastFormulaVersion` = `"forecast-run-2026-09-18.2"`. Don't bump it unless the output changes.
  - Commit trailers name the model that wrote the commit.
