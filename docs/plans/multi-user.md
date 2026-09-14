# Multi-user plan

## Status

Landed on this branch in four slices. The gate is `pnpm isolation` in Better
Auth mode, which now adds a member by email, exercises the member's bounded
rights, removes them, and reads the activity log back.

1. **Roles, direct membership, and the log** — `company_role` widens to
   `owner | member`; `requireCompanyRole` in the auth package and `requireOwner`
   in the web adapter raise `CompanyRoleRequiredError`, which routes answer with
   403. `pending_members` holds an address until it first signs in, and
   provisioning attaches every pending membership before it would create a
   default company. `MemberRepository` adds, re-roles, and removes members, and
   refuses to leave a company without an owner. `audit_log`, `recordAudit`, and
   `listAuditEntries` exist, and the attribution columns are on their tables.
2. **Members and Activity** — `GET`/`POST`/`PATCH`/`DELETE /api/members` and
   `GET /api/activity`, with a **Members** dialog the account menu offers to
   owners and an **Activity** dialog it offers to everyone.
3. **Audit instrumentation and row attribution** — evidence approvals and
   rejections, decisions, review answers, journal posting and reversal, period
   close and reopen, policies, company settings, company creation, knowledge
   edits, and every membership change record their action with the acting user,
   inside the mutation's own transaction wherever one exists. `MemberRepository`
   owns its transactions, so each mutating method takes the audit write as a
   `within` callback and runs it before the commit. The rows listed under
   [Row attribution](#row-attribution) store the user who wrote them, the
   economic items a decision effect or an evidence approval creates included. A
   company reset records nothing: the cascade deletes the company's log with it.
4. **Acceptance and documentation** — the isolation script's membership matrix,
   this status, the roles, audit, and attribution entries in
   [the security model](../security.md), and the README's account-menu section.

## Objective

Let several people work in one company on a self-hosted installation, with
explicit rights, and record which person took each action that changes
financial state. This plan covers:

- member roles and the rights attached to them;
- adding people to a company directly by email, without an email sender;
- an audit log written in the same transaction as the change it describes;
- acting-user attribution on the rows that lacked it;
- an Activity view and tests.

Invitation links, email delivery, and hosted tenant operations stay in the
[hosted multi-company plan](multi-tenant-hosted.md). This plan is the
self-hosted subset that plan builds on.

## Starting point

- Registration requires the configured `AUTH_SIGN_UP_CODE`, so the operator
  decides who can create a sign-in at all.
- `company_members` already separates membership from users and companies and
  carries a `role`, currently the single value `owner`.
- Every request resolves user and company through one boundary, and the
  active company is a verified cookie preference.
- The acting user is already stored on LLM runs and messages, evidence,
  approval events, period closures and promotions, close entries, FX
  remeasurement, elimination entries, and source-row mappings.
- Row level security and `withCompanyTransaction` exist; the audit writer runs
  inside that transaction when the mutation does.

## Roles and rights

`company_role` widens to `owner | member`.

| Right | Owner | Member |
| --- | --- | --- |
| All financial work: evidence, chat, knowledge, journals, close, forecasts | yes | yes |
| Company settings (name, currency, favicon) | yes | no |
| Add, remove, or change members | yes | no |
| Reset (delete) the company | yes | no |
| Create a new company (becomes its owner) | yes | yes |

The auth package exposes `requireCompanyRole(context, role)`, which throws
`CompanyRoleRequiredError`; the web adapter exports `requireOwner()` and routes
map the error to 403. A company always keeps at least one owner: the last owner
cannot be demoted or removed, and cannot remove themselves.

## Adding people directly

An owner opens **Members** from the account menu, enters an email and a role,
and the person is added immediately:

- if a user with that email already exists, the membership is inserted;
- otherwise a `pending_members` row holds the email, role, company, and the
  owner who added it. When someone signs in with that email for the first
  time, provisioning attaches every pending membership before it would create
  a default company, so the person lands in the company that added them rather
  than in an empty one.

Emails are compared lowercased and trimmed. Removing a pending member deletes
the row; removing an active member deletes the membership, and their next
request falls back to another authorized company or, if none remains, to a
newly provisioned empty company. A removed member keeps their sign-in.

## Audit log

```text
audit_log
  id              uuid
  company_id      uuid, not null, cascade
  actor_user_id   uuid, null for worker actions, set null on user delete
  via             text: ui | agent | worker
  action          text  (evidence.approved, decision.applied, journal.posted, period.closed, member.added, ...)
  entity_type     text
  entity_id       uuid, nullable
  summary         text
  before          jsonb, nullable
  after           jsonb, nullable
  request_id      text, nullable
  created_at      timestamptz
index (company_id, created_at)
```

`recordAudit(executor, entry)` inserts one row and accepts either the database
or an open transaction. Mutations that already run in a transaction record the
audit row inside it, so the change and its record commit or roll back together.
Mutations that are single statements record the row immediately after the
write. Agent-proposed writes are attributed to the user who asked, with
`via = agent`. Cron and worker actions have no actor and use `via = worker`.

First-pass audited actions: evidence approved or rejected, decision applied or
rejected, review question answered, journal posted and reversed, period closed
and reopened, policy created or changed, company settings changed, company
created, company reset, member added, role changed, member removed.

## Row attribution

Added so the row itself answers "who", independent of the log:

- `decisions.created_by_user_id`
- `review_items.resolved_by_user_id`
- `economic_items.created_by_user_id`
- `reporting_periods.closed_by_user_id`
- `knowledge_documents.updated_by_user_id`

## Activity view

`GET /api/activity` returns the company's most recent audit entries with the
actor's name and email. The account menu gains **Activity**, which opens a
dialog listing them newest first. Traces that already show an approval or
decision keep showing the actor name where the row records one.

## Tests

- Unit: role check, last-owner protection, email normalization.
- Database: pending membership attaches on first provisioning and suppresses
  the default company; a member cannot be promoted past the rules; audit rows
  land with the right company and actor.
- Acceptance (`pnpm isolation`, Better Auth mode): the owner adds a second user
  by email; that user sees the company in their switcher; the member cannot
  change settings, manage members, or reset the company; the owner removes
  them and their access ends; the activity log lists the actions with actors.

## Explicitly deferred

- invitation links and email delivery;
- an `admin` role or per-feature permissions;
- audit coverage of every remaining mutation (mechanical follow-up);
- per-user model-provider keys, hosted billing, and tenant operations.
