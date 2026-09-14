# Local multi-company plan

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

The missing work is selection, creation, consistent propagation, and isolation
testing.

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
scoping, but PostgreSQL row-level security and a company transaction wrapper
should follow before the same code is exposed as a hosted service. Implementing
them during this pass is preferred because they detect missing company filters
while the surface is still small. Hosted launch treats them as mandatory.

## Acceptance gate

Local multi-company is complete when one user can create two clean companies,
switch between them repeatedly, run ingestion and calculations concurrently,
restart the application, and observe no state or file leakage between them.
This must pass in both disabled and Better Auth modes.

## Explicitly deferred

- invitations and separate human accounts;
- member administration and role-specific permissions;
- email delivery and account recovery operations;
- S3-compatible storage;
- distributed workers and rate limiting;
- hosted billing, quotas, support tooling, and tenant operations;
- public multi-tenant deployment.

