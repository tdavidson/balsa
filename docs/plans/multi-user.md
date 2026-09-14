# Multi-user plan

## Objective

Let several people work on one self-hosted installation of Nevermodel, and
record which person took each action that changes financial state.

The model is deliberately the smallest one that is honest about a self-hosted
host: the operator decides who may create a sign-in at all, and everyone who
holds that right works on everything the installation holds.

- **Admission is the whole gate.** `AUTH_SIGN_UP_CODE` is what admits a person.
  Registration without it is refused server-side, so the people who can reach
  the host are exactly the people the operator handed the code to.
- **Everyone belongs to every company.** A user admitted today joins every
  company that exists, as an owner, and every company created afterwards joins
  every user. Nobody is added to a company, so nobody has to be: the company
  switcher, **New company**, and `COMPANIES` all keep working, and a second
  person sees the same list as the first.
- **The default company is the installation's oldest.** Each membership carries
  its company's `created_at`, so the company a person opens on their first
  request is the one the installation started with, not one provisioned for
  them. A default `DEFAULT_COMPANY_NAME` company is created only when the
  installation has no company at all.
- **Isolation is the company's, not the person's.** Row level security and
  `withCompanyTransaction` keep every read and write inside the active company.
  That boundary is unchanged by who is signed in; what changed is that the set
  of people who may select a given company is now everyone on the host.
- **The log says who.** Every change that matters records its acting user, and
  the rows that record a person's judgment carry that person.

## Roles

`company_role` is `owner | member`, and `requireCompanyRole` in the auth package
enforces it as a lattice: an owner satisfies every requirement, a member only
its own. `requireOwner` in the web adapter is what owner-only routes call, and
routes map `CompanyRoleRequiredError` to 403.

| Right | Owner | Member |
| --- | --- | --- |
| All financial work: evidence, chat, knowledge, journals, close, forecasts | yes | yes |
| Company settings (name, currency, favicon) | yes | no |
| Reset (delete) the company | yes | no |
| Create a new company | yes | yes |

In this repository every membership is an owner membership, so the member row
of that table is never reached in practice. The enum, the check, and the
owner-only routes stay because they are the mechanism a deployment needs the
moment membership stops being installation-wide — and because a right that is
only hidden in the interface is not a right at all.

## Audit log

```text
audit_log
  id              uuid
  company_id      uuid, not null, cascade
  actor_user_id   uuid, null for worker actions, set null on user delete
  via             text: ui | agent | worker
  action          text  (evidence.approved, decision.applied, journal.posted, period.closed, ...)
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

Audited actions: evidence approved or rejected, decision applied or rejected,
review question answered, journal posted and reversed, period closed and
reopened, policy created or changed, company settings changed, company created,
knowledge edited. A company reset records nothing: the cascade deletes the
company's log with it.

## Row attribution

Added so the row itself answers "who", independent of the log:

- `decisions.created_by_user_id`
- `review_items.resolved_by_user_id`
- `economic_items.created_by_user_id`
- `reporting_periods.closed_by_user_id`
- `knowledge_documents.updated_by_user_id`

## Activity view

`GET /api/activity` returns the active company's most recent audit entries with
the actor's name and email. The account menu offers **Activity**, which opens a
dialog listing them newest first. Traces that already show an approval or a
decision keep showing the actor name where the row records one.

## Hosted

Per-company membership — adding a specific person to a specific company,
invitations, pending addresses, and role administration — is developed
separately for the hosted service and is not part of this repository. Nothing
here depends on it: the roles enum, `requireCompanyRole`, `requireOwner`, the
audit log, and row attribution are the pieces that model would build on.

## Status

Implemented on this branch:

- `ensureInstallationMemberships` joins a provisioning user to every company on
  the installation, and `createCompanyForUser`, the `COMPANIES` top-up, and the
  first-company bootstrap each give the new company to every user, in one
  statement, with the company's `created_at` as the membership timestamp.
- A default company is created only for an installation that has none.
- `company_role` widens to `owner | member`; `requireCompanyRole`,
  `CompanyRoleRequiredError`, and `requireOwner` are enforced server-side.
- `audit_log`, `recordAudit`, `listAuditEntries`, `GET /api/activity`, and the
  **Activity** dialog.
- Attribution columns on the rows listed under [Row attribution](#row-attribution),
  the economic items a decision effect or an evidence approval creates included.
- Tests: the auth package's role checks; database tests for installation-wide
  membership, the default-company rule, the `COMPANIES` top-up, local-owner
  adoption, and the audit log; and `pnpm isolation` in Better Auth mode, where a
  second user admitted by the sign-up code sees the same companies with no
  default company of their own, opens one of them, and still reads nothing of
  the other.

## Explicitly deferred

- per-company membership, invitations, and role administration (hosted);
- an `admin` role or per-feature permissions;
- audit coverage of every remaining mutation (mechanical follow-up);
- per-user model-provider keys, hosted billing, and tenant operations.
