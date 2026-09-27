# Continuous financial review — product gap completion

Authorized scope: implement the eight gaps identified after the initial cash
workflow release, plus documentation cleanup. Preserve the single journal engine,
company scope, explicit approval, immutable review history and bounded errors.
Real-user pilots and browser visual validation remain deferred.

- [x] Continuity: carry verified actual payment/recognition into remaining schedules;
  preserve original schedule and exact rounding, with visible unmatched balances.
- [x] Guided review: one sequenced first-review checklist derived from actual state,
  with direct actions and explicit completion requirements.
- [x] Assumption recovery: compare old/current sources and approve a replacement
  schedule while preserving captured obligations and preventing overlap.
- [x] Forecast accuracy: compare immutable pre-event forecasts with reviewed actual
  allocations, separating amount errors, timing errors, unknowns and sample size.
- [x] Uncertainty: explicit named downside/base/upside assumptions, deterministic
  sensitivity and timing limits, preserved evaluations and no invented probability.
- [x] Review ownership: assigned preparer/reviewer and exceptions with due dates,
  scoped sign-off, stale-snapshot detection and enforced membership/authority.
- [x] Weekly cash: dated journal-derived cash roll-forward; expose uncertain dates,
  overdue expectations and unverified coverage rather than guaranteeing liquidity.
- [x] Flexible imports: explicitly mapped row identities and partial/overlapping
  updates without treating absent rows as removals; preserved before/after review.
- [x] Cleanup and verification: reconcile older documentation, migrations and tests;
  verify, lint, accounting acceptance, HTTP flows and company isolation.

Implementation order follows the list, with shared data contracts and helpers
where they reduce duplicate calculation logic. Unsupported FX and complex
recognition remain explicit exceptions; revenue/profit goals and ERP replacement
are not introduced by this release.


## Verification record — 2026-09-26

All eight scoped gaps are implemented. `pnpm run verify` passed 547 tests and the
production build; `pnpm lint` and Company Zero accounting acceptance passed.
Tests ran against a disposable synthetic database with migrations through `0084`.

HTTP checks passed for report preview, idempotent creation, task assignment and
exception acceptance, submission, required self-review acknowledgement, preserved
sign-off, stale company headers, foreign review reads, weekly cash and the guided
checklist. Existing goal, import preview/approval, reversal and rendered-route
checks also passed. `pnpm isolation` passed 18 checks in local auth-disabled mode,
including `/api/financial-reviews`. Unprivileged PostgreSQL tests cover the new
tables; service tests enforce separate member/reviewer permissions and stale
sign-off rejection. The local auth-disabled run has only one operator, so browser
login/multi-user sessions and real-user pilots remain deferred.

Supported bounds remain explicit: one reporting currency, bounded single-payment
recognition with exact linked actuals, completed allocated observations for
accuracy, manually specified scenarios, daily closing cash rather than intraday
liquidity, and explicitly reviewed import identity. Exception acceptance records
management judgement and never upgrades calculation assurance.
