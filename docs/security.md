# Security posture and deployment checklist

## Current application controls

- Every application route resolves an identity through the app-owned auth
  boundary and scopes records through `requireCompanyAccess`.
- Access to this installation is installation-wide, and `AUTH_SIGN_UP_CODE` is
  the gate on it: everyone admitted by that code is an owner of every company on
  the host, existing and future, and no invitation, mail, or link grants access
  to anything narrower. Treat admitting a person as handing them every company's
  financial data, and use separate installations where that is not intended. The
  audit log is what distinguishes the people who share that access: every change
  that matters names the person who made it. Membership still carries a role and
  `company_role` still has `owner` and `member`, so an owner-only route is
  enforced on the server and answered with 403 rather than merely hidden in the
  interface; per-company membership and role administration are developed
  separately for the hosted service and are not in this repository.
- Every change that matters is recorded in `audit_log`: the acting user, how
  the change arrived (`ui`, `agent` for a change the agent made on a user's
  behalf, `worker` for unattended work, which has no actor), the action, the
  affected entity, a summary, and before/after values. A mutation that already
  runs in a transaction writes its audit row inside it, so the change and its
  record commit or roll back together. `GET /api/activity` returns the active
  company's entries, newest first, to that company's members and no one else.
- Rows record their author as well as the log: decisions, resolved review
  items, economic items, closed reporting periods, and knowledge documents
  carry the acting user, so a row answers "who" without depending on the log.
- The active company is stored in an HTTP-only, same-site cookie. It is a
  preference, never authorization: membership is re-verified on every request,
  and a stale or unauthorized value falls back to the user's first authorized
  company and is reported so the client can repair the cookie.
- Record ids supplied in a request body—accounts, entities, scenarios,
  provenance, decisions, policies, mappings, and source rows—are verified to
  belong to the active company before use, and follow-up updates constrain the
  company id rather than matching the record id alone.
- Migration 0070 installs row level security policies on every company-bearing
  table, keyed to the transaction-local `app.company_id` scope that
  `withCompanyTransaction` sets. Policies are permissive when no scope is set,
  so routes adopt the wrapper incrementally; enforcement applies only to a
  non-superuser database role.
- `AUTH_MODE=disabled` is explicit, never a fallback. Production requires
  `ALLOW_AUTH_DISABLED=true` and must sit behind a VPN, reverse proxy, or
  equivalent network access control.
- Better Auth uses an explicit base URL and trusted-origin allowlist. Public
  registration is disabled by default in production; enable it only while
  provisioning an owner.
- When `AUTH_SIGN_UP_CODE` is set, registration requires that code: the
  `/sign-up/email` request hook compares the submitted value in constant time
  and answers 403 otherwise, server-side and independent of the login UI. It is
  the mechanism that admits each registrant on a multi-user installation, and
  the reason no stranger can race the operator for the `LOCAL_OWNER_EMAIL`
  address. Production logs a warning at startup when sign-up is enabled without
  one.
- API mutations reject cross-site browser requests. Responses use no-store,
  anti-framing, no-sniff, referrer, permissions, and production HSTS headers.
- Source-file reads, writes, and deletes validate their local storage path;
  downloads are company-scoped, hash-verified, and forced as attachments.
- Upload sizes and extracted text are bounded. Uploaded text is explicitly
  treated as untrusted data in extraction prompts.
- Financial posting validates company ownership, active accounts, period
  status, provenance, approvals, entry balance, entity identity, and FX
  source/rate selection before writing.
- Cron and health endpoints use constant-time bearer-secret comparison.

## Required production configuration

- Set a unique `BETTER_AUTH_SECRET` of at least 32 random bytes.
- Set `BETTER_AUTH_URL` (and `NEXT_PUBLIC_APP_URL`, if used) to the canonical
  HTTPS origin. Add extra origins only through `BETTER_AUTH_TRUSTED_ORIGINS`.
- Keep `AUTH_ALLOW_SIGN_UP` unset after the initial owner has been created.
- Set `AUTH_SIGN_UP_CODE` whenever sign-up is enabled on a host anyone else can
  reach, and share it only with the people who should be able to register. It is
  also what protects `LOCAL_OWNER_EMAIL`: the first Better Auth account
  registered with that address adopts the existing local owner's user and data,
  so an installation that leaves sign-up open without a code hands that address
  to whoever registers it first.
- Set `CRON_SECRET` before enabling scheduled reconciliation/calculation work.
- Set `HEALTHCHECK_SECRET`; production health checks return 404 without it.
- Connect the application to PostgreSQL as a dedicated non-superuser role
  without `BYPASSRLS`. Superusers ignore row level security, so the migration
  0070 policies are inert for the default `postgres` role.
- Keep local-file storage outside the served web root, with restrictive OS
  permissions and backups appropriate for financial source documents.
- Store all secrets only in the deployment secret manager or an untracked env
  file. Rotate secrets after any suspected exposure.

## Deliberately deferred until scale-out

The current request limiter and Better Auth default limiter are process-local.
Before multi-instance/serverless deployment, replace them with a shared Redis
or database-backed limiter, configure trusted proxy IP handling, and schedule
outbox recovery with `CRON_SECRET`. This work is tracked in
the hosted service's own plans, which are developed separately.
