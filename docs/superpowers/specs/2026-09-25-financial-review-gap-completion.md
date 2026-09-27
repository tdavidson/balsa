# Financial review gap completion

Scope authorized: complete product gaps 1–5 and the smaller goal/scenario gaps identified in the goal-directed model review. Real-user validation, browser visual QA and multi-user pilot exercises are excluded. Automated verification, accounting acceptance and company isolation remain required.

## Delivery checklist

- [x] Opening cash: deterministic account-by-account tie to approved, identity-reviewed statement balances at the exact boundary; missing/conflicting evidence and differences remain visible; preserve inputs and results in reviews.
- [x] Unified progress: primary goal and plan, current cash/gap, plan and previous-review changes, account coverage, overdue expectations and prioritized actions on one page.
- [x] Practical inspection: drill from month-end cash and changes into journal lines, expectations, decisions and evidence; link to scoped correction controls with preview/reason and preserved history.
- [x] Recurring review: approve bounded history-based schedules with source lineage and duplicate/overlap review; renewal/pause; conservative match suggestions; ambiguity and overdue obligations stay explicit.
- [x] Import changes: classify new/duplicate/corrected/superseded evidence and show supported financial effects before approval, with saved before/after review and exceptions for unsupported effects.
- [x] Goal workflow: draft goals and a persisted company primary-goal selection; immutable revisions and current-version checks.
- [x] Decision detail: per-change attribution with a documented ordering and residual; extend supported formula/accounting scenarios through the existing journal engine, with parity checks and explicit unsupported cases.
- [x] Documentation, migrations and regression tests; verify, acceptance and isolation gates.

Revenue/profit goals still depend on verified projected statements and recognition schedules. Provider integrations, ERP replacement, autonomous decisions and daily-liquidity guarantees remain outside the original release scope.

## Acceptance

Opening controls cannot pass with a mismatched amount, wrong account/currency/entity, ambiguous mapping, unapproved identity, wrong statement date, changed supporting evidence or omitted cash account. Complete zero-activity periods are valid when evidenced. Existing saved snapshots stay unchanged.

A founder can enter through the progress view, select a persistent primary goal, identify a cash gap and its largest changes, inspect a supporting item and reach its correction workflow. Financial outputs remain server-calculated.

History-derived schedules require explicit approval and preserve source inputs/rule version. Repeated capture and imports do not duplicate projections. Shared amount/account shape never proves obligation identity. Unsupported or ambiguous changes remain visible.

Every mutation remains company-scoped, audited, version checked and idempotent where retryable. Financial mutation, revision and calculation-outbox writes commit together. No model call occurs within these database transactions.

## Verification record — 2026-09-26

Implemented all scoped gaps above. `pnpm run verify` passed 531 tests and the
production build; `pnpm acceptance` passed Company Zero; lint passed. HTTP tests
covered draft activation and primary selection, progress inspection, rollback-only
import previews, approval retry, saved lineage and rendered routes. `pnpm isolation`
passed 18 checks in local auth-disabled mode, including the new progress/import
surfaces. The unprivileged PostgreSQL regression suite covers the new review and
preference tables. Local auth-disabled mode has one operator identity, so the
second-user exercise remains excluded with real-use validation.

See [goal review controls](../../goal-reviews.md) for explicit recognition/import
bounds. FX import effects, recurring/formula recognition and schedules requiring
unproven past opening balances remain visible exceptions; verified month-to-month continuity is added in the [continuous-review plan](2026-09-26-continuous-financial-review.md). Broader recognition and revenue/profit goals remain outside the release scope.
