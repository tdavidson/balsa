# Intra-month expectations and settlement

Open **Reconcile expectations** from Goals & reviews, or visit `/reconciliation`.
The current outlook combines posted actuals through today's UTC date with the
remaining approved expectations, using the existing journal calculation engine.
Forecast lines never become actual journals merely because time passes.

## Review workflow

1. Review current-month driver occurrences and historical suggestions. Historical
   suggestions require the same description, debit/credit accounts, currency and
   entity in each of three completed months, with amounts within 10% of their
   median. Numeric identifiers remain distinct. Suggestions retain source line IDs
   and do not affect the outlook until approved.
2. Capture an occurrence after confirming that it represents an independent
   obligation, rather than duplicating an existing driver or expectation.
3. Allocate actual cash to the occurrence. Partial receipts reduce only the
   allocated amount; multiple receipts can settle one expectation, and a combined
   receipt can be allocated across expectations without using the same cash twice.
4. Revise the remaining timing or expected total with a reason. This changes this
   occurrence without changing the recurring driver for subsequent months.
   Explicit final settlement records a shortfall against the original expected
   amount. Incorporate an excess payment by revising the total first.
5. Cancel an expectation or revoke an allocation when needed. History remains.
   Reversed actuals invalidate their allocations and reopen the remaining amount.

An explicitly approved automatic rule is available for a one-off driver tied to
one approved source fact. After actual posting, the forecast job allocates only
whole, unallocated actual entries whose every line identifies that exact fact
and whose accounts, entity, and currency match. The fact and evidence must still
be approved. Duplicate expectations for the fact, excess amounts, reversed
entries, and unsupported treatment require manual review. Description or account
similarity alone never removes an expectation. Worker allocations are audited
and retries do not duplicate them. A reviewer-revoked match is not automatically restored.

## Approved recurring capture

Use **Capture recurring expectations automatically** to approve an existing
fixed-amount monthly, quarterly or annual cash driver. Review its source,
accounts and schedule, confirm that it is an independent obligation, and choose
an end month within 24 months of the current month. Formula drivers and
historical pattern policies are not yet supported by this automation.

Approval preserves an exact driver/treatment/source fingerprint. The forecast
worker creates each due occurrence using the shared projection engine and the
same canonical driver/month identity used by manual capture. Retries and manual
captures therefore cannot create duplicates. A missed worker interval is caught
up within the approved window, even if the worker returns after the window ends.
No occurrence is created before the approval's starting month or after its end.
Future months continue to use live driver projections until they become due.

The existing protected `/api/jobs/reconciliation` scheduled job refreshes forecasts
at month rollover and runs this capture step. Normal financial mutations also run
it. Deployments must schedule that endpoint for unattended rollover; it is not
an in-process timer. A read before the worker runs shows pending capture as an
exception rather than pretending that history was already preserved.

Changing a schedule, amount, template, reporting currency, active accounts, or
supporting source/fact fingerprint makes approval stale. Reapprove the reviewed
schedule from the current month to restart capture. This preserves earlier
occurrences and their allocations, timing revisions and cancellations. Pausing
capture also preserves those records and does not cancel the underlying driver.
Months while paused are not silently backfilled when a new approval starts.

Recurring capture does not enable automatic settlement against a recurring
source fact: one agreement can describe several distinct installments, so each
occurrence still needs explicit actual allocation. The existing one-off exact
source-fact matching rule remains separate.

## Source coverage

For each cash account, record a complete or partial date interval with a reason
and optional approved evidence. Coverage is separate from a zero balance or zero
activity. New or corrected posted lines, staged imports, or source approval/hash
changes make affected assertions stale. Revoke an assertion to withdraw it.
A preview token prevents approving an assertion against changed inputs.

Coverage is a review assertion, not proof of opening-balance reconciliation or a
certified close. Goals remain provisional where verification is incomplete.

## Boundaries

- Only balanced two-line, single-currency cash movements are supported. Transfers,
  FX and split journal treatments are not automatically interpreted as receipts.
- Occurrences without a recurring capture approval still require manual capture
  for durable settlement. Historical patterns remain suggestions until reviewed;
  automatic policy approval and variable-amount recurring capture are future work.
- Overdue captured expectations survive month rollover and remain visible as
  exceptions. They are not silently moved into the current month's cash forecast;
  explicitly reschedule or resolve them.
- Actuals after today's UTC cutoff are excluded. Saved reviews preserve their
  inputs; arbitrary historical knowledge-cutoff queries are not implemented.
- Import-difference review and evidence-backed starting-cash reconciliation are
  available in `/imports` and `/progress`. Complete bank closing reconciliation
  remains outside this release. Dated weekly cash shows daily closing shortfalls
  within each week; it does not establish intraday liquidity.

## Storage and validation

Migration `0078_forecast_recurrence` adds company-scoped, versioned recurring
capture approvals over existing drivers. Their revisions and generated occurrences
are audited, and saved forecast inputs retain the approval snapshot and rule version.
Migration `0077_forecast_settlement` adds company-scoped occurrences, allocations,
coverage records and idempotent command receipts. Mutations require the active
company header, expected occurrence version, reason and request UUID. Audit,
state change and durable forecast refresh enqueue commit together. Saved goals
and reviews retain settlement inputs, coverage, formula versions and results.

`GET /api/forecast-reconciliation` loads review candidates, actuals, expectations,
coverage and exceptions. `POST` supports `capture`, `allocate`,
`revoke_allocation`, `revise_occurrence`, `coverage`, `approve_recurrence` and
`pause_recurrence`. Recurrence approval requires the current definition hash and
expected policy version; renewal never rewrites existing occurrences.

Synthetic regression tests cover partial/full settlement, timing changes,
reversals, cancellation, over-allocation, automatic source-fact policies,
cutoff dates, stale coverage, retries and cross-company rejection. Run the
repository verification, accounting acceptance and company-isolation gates.

### Reviewed historical schedules and match suggestions

A qualifying three-month historical pattern can now become a bounded, explicitly
approved monthly driver with its exact accounting template. Approval stores the
median amount, expected day, supporting line IDs, source hash, document approval
fingerprint and rule version. It uses the existing recurrence worker and canonical
projection identities. Reversing or changing supporting history, or changing its
document approvals, makes capture stale and requires renewed review.

If the current historical occurrence was already preserved, approval leaves it
unchanged and starts the schedule next month. Otherwise it starts this month.
Duplicate approvals cannot create a second driver for the same pattern. Historical
capture never authorizes automatic amount/memo-based settlement.

Match suggestions rank compatible actuals by remaining amount, description words
and date proximity within 90 days. They show available capacity, a proposed partial
amount and competing obligations. These are review aids only: the user still
selects the actual and approves an allocation. Reversed, future, incompatible or
fully allocated actuals are excluded.

Journal reversals retain the original entry relationship, basis, scenario and FX
lineage. Reversing a matched actual reopens the outstanding expectation without
deleting its allocation history.


### Recovering stale assumptions

A stale recurring policy offers an explicit replacement review with original and
current history, amount, payment day and bounded end month. It proposes a manual
assumption, not renewed certification of a historical pattern. The preview shows
before/after cash and preserved obligations. Approval ends the original driver's
future schedule, pauses its policy and creates an approved replacement after the
last already captured original month. Existing obligations and allocations stay
unchanged. Changes to the source or forecast scope invalidate the preview.

`preview_recurrence_replacement` and `replace_recurrence` require a current
replacement hash. Approval additionally records acknowledgement, reason and a
request UUID. Reviewed payment days clamp to the last day of shorter months.
