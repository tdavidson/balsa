# Security posture and deployment checklist

## Current application controls

- Every application route resolves an identity through the app-owned auth
  boundary and scopes records through `requireCompanyAccess`.
- `AUTH_MODE=disabled` is explicit, never a fallback. Production requires
  `ALLOW_AUTH_DISABLED=true` and must sit behind a VPN, reverse proxy, or
  equivalent network access control.
- Better Auth uses an explicit base URL and trusted-origin allowlist. Public
  registration is disabled by default in production; enable it only while
  provisioning an owner.
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
- Set `CRON_SECRET` before enabling scheduled reconciliation/calculation work.
- Set `HEALTHCHECK_SECRET`; production health checks return 404 without it.
- Keep local-file storage outside the served web root, with restrictive OS
  permissions and backups appropriate for financial source documents.
- Store all secrets only in the deployment secret manager or an untracked env
  file. Rotate secrets after any suspected exposure.

## Deliberately deferred until scale-out

The current request limiter and Better Auth default limiter are process-local.
Before multi-instance/serverless deployment, replace them with a shared Redis
or database-backed limiter, configure trusted proxy IP handling, and schedule
outbox recovery with `CRON_SECRET`. This work is tracked in
[post-single-player-scale-up.md](plans/post-single-player-scale-up.md).
