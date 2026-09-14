# Local multi-company plan

## Status

All six implementation slices below have landed on this branch.

1. **Company repository and API** — `listCompaniesForUser` and a
   single-transaction `createCompanyForUser` in the database auth repository;
   `GET`/`POST /api/companies` and `PUT`/`DELETE /api/companies/active`.
   Responses expose only company id, name, base currency, and the caller's
   role. Company creation is rate limited per user.
2. **Auth-context selection** — `apps/web/src/lib/auth/company-selection.ts`
   reads the `nevermodel_company` cookie and passes it to `createAuthService`
   as a `CompanySelectionStore`. `requireCompanyAccess` re-verifies membership
   on every request and reports `selection.staleSelection` when a stored id is
   no longer authorized. Provisioning creates a company only when the user has
   no membership at all.
3. **Account-menu UX** — the account menu lists every authorized company, marks
   the active one, switches through `PUT /api/companies/active` followed by a
   full reload, and opens a **New company** dialog. The app shell is keyed by
   the active company, and signing out clears the cookie.
4. **Company propagation audit** — foreign keys supplied in request bodies
   (entity owner, scenario, provenance, account, decision, policy, mapping, and
   source-row ids) are verified against the active company before use, and
   follow-up updates constrain the company id instead of matching the record id
   alone. The reconciliation drain claims extraction jobs under the company
   stored on the durable ingestion run rather than the joined evidence row.
5. **Isolation tests** — database-backed tests in `packages/database` cover
   company listing order, creation, provisioning idempotence, denial for a
   second user holding a known company UUID, and row level security enforcement
   inside `withCompanyTransaction`. CI runs them against a migrated Postgres
   service; they skip when no database URL is configured. The end-to-end gate is
   `scripts/multi-company-isolation.ts`, run as `pnpm isolation`.
6. **Defense-in-depth database boundary** — `withCompanyTransaction` sets the
   transaction-local `app.company_id` scope, and migration
   `0070_company_row_level_security.sql` enables and forces row level security
   with a matching policy on every company-bearing table.

What remains:

- Routes adopt `withCompanyTransaction` incrementally. The policies are
  permissive when no scope is set, so a route that has not adopted the wrapper
  still relies on application-level `company_id` filtering alone; it gains the
  database boundary only once its queries run inside the transaction.
- Row level security is enforced only for a non-superuser application role. A
  superuser connection—including the default local `postgres` role—bypasses
  every policy, so the boundary is inert until the application connects as a
  dedicated unprivileged role.
- The acceptance gate is `pnpm isolation` against a running application in both
  `ISOLATION_AUTH_MODE=disabled` and `ISOLATION_AUTH_MODE=better-auth`. It is a
  black-box script against a live instance, so it is not part of CI and must be
  run deliberately.

## Objective

Allow one Nevermodel user to create, operate, and switch among multiple
companies on one local installation. This is a single-player capability and is
supported in both authentication modes:

- `AUTH_MODE=disabled`: one configured local user, several companies.
- `AUTH_MODE=better-auth`: one signed-in user, several companies.

This plan does not add invitations, multiple human users, hosted billing, or
distributed infrastructure. Those belong to the
[hosted multi-company plan](multi-tenant-hosted.md).

## Existing foundation

- `company_members` already represents membership separately from users and
  companies, so one user can belong to several companies.
- Financial and evidence records already carry `company_id`.
- `requireCompanyAccess(requestedCompanyId)` already verifies that the current
  user belongs to a requested company.
- The application-user identity remains stable when switching between disabled
  mode and Better Auth through the one-time email claim setting.
- Local private file storage already prefixes source objects by company.

Selection, creation, consistent propagation, and isolation testing are the work
this plan adds; see **Status** above for what has landed.

## Product behavior

### Company selection

- If the user belongs to one company, open it automatically.
- If the user belongs to several companies, open the last active company.
- Show a compact company switcher in the account menu.
- Switching companies refreshes all company-scoped UI state: conversations,
  documents, knowledge, accounting, calculations, usage, and settings.
- A stale or unauthorized selected company falls back to the user's first
  authorized company and clears the invalid selection.

### Company creation

Add **New company** to the account menu. The initial form requires:

- company name;
- base currency.

Creation inserts the company and an `owner` membership for the current user in
one transaction, selects the new company, and opens its empty onboarding state.
Creating a company must never copy documents, knowledge, mappings, accounts,
journals, assumptions, forecasts, or conversations from another company.

### Active-company state

Store the active company ID in a secure, HTTP-only, same-site cookie. The cookie
is a preference, not authorization. Every server request must resolve the
current identity and verify its membership before using the selected ID.

Background work must persist its company ID when queued and use that stored
company, rather than whichever company is active in the browser later.

## Implementation slices

### 1. Company repository and API

- Add a repository query that lists all companies for an application user.
- Add an owner-only company-creation transaction.
- Add `GET /api/companies` and `POST /api/companies`.
- Add an endpoint that validates and stores the active-company cookie.
- Return only company IDs, names, base currencies, and the current user's role.

### 2. Auth-context selection

- Read the active-company cookie in the application auth adapter.
- Pass its value to `requireCompanyAccess`.
- Keep membership validation server-side.
- Make initial provisioning create a company only when the user has no existing
  membership; an existing multi-company user must never receive an accidental
  empty company.

### 3. Account-menu UX

- Display all authorized companies in the account menu.
- Indicate the active company.
- Add keyboard-accessible switching and **New company**.
- Keep company settings scoped to the active company and user settings scoped
  to the user.
- Close company-specific dialogs and invalidate cached requests after a switch.

### 4. Company propagation audit

Audit every company-bearing surface and operation:

- chat and conversation history;
- documents, source files, extraction, and reprocessing;
- company knowledge and decisions;
- entities, chart of accounts, mappings, journals, and period close;
- forecast templates, scenarios, FX, consolidation, and allocations;
- calculation runs, reconciliation, testing discrepancies, and usage.

No API may accept an unchecked company ID from a request body or model output.
The authorized active company comes from server context. Routes operating on a
stored record must also prove that record belongs to that company.

### 5. Isolation tests

Create one user with two companies and verify:

- both appear in the switcher and selection persists;
- each dashboard contains only the selected company's state;
- documents and downloaded blobs cannot cross companies;
- chat, knowledge, usage, journals, and calculations remain isolated;
- guessed, stale, and manually modified company cookies are rejected;
- queued processing continues under its originating company after a browser
  switch;
- deleting or changing one company does not alter the other.

Add a second user in test fixtures to prove that knowing another company UUID
does not grant access, even though multi-user product workflows remain out of
scope.

### 6. Defense-in-depth database boundary

The local feature can function through verified `company_id` application
scoping alone, but PostgreSQL row-level security and a company transaction
wrapper are installed during this pass, because they detect missing company
filters while the surface is still small. Policies are permissive when no scope
is set, so routes adopt the wrapper incrementally without breaking. Enforcement
requires the application to connect as a non-superuser role; hosted launch
treats both the wrapper and that role as mandatory.

## Acceptance gate

Local multi-company is complete when one user can create two clean companies,
switch between them repeatedly, run ingestion and calculations concurrently,
restart the application, and observe no state or file leakage between them.
This must pass in both disabled and Better Auth modes.

`scripts/multi-company-isolation.ts` (`pnpm isolation`) checks the gate against
a running application: set `BASE_URL` and run it once per
`ISOLATION_AUTH_MODE`.

## Explicitly deferred

- invitations and separate human accounts;
- member administration and role-specific permissions;
- email delivery and account recovery operations;
- S3-compatible storage;
- distributed workers and rate limiting;
- hosted billing, quotas, support tooling, and tenant operations;
- public multi-tenant deployment.

