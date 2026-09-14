# Self-hosted authentication and no-login mode

## Status: implemented with Better Auth

Nevermodel now uses Better Auth as its default identity provider. It is embedded
behind Nevermodel's application-owned identity boundary, uses the installation's
PostgreSQL database for credential/session records, and leaves accounting users,
companies, and memberships in the existing application schema. `AUTH_MODE` is:

```text
better-auth  default; Nevermodel-styled email/password sign-in
disabled     explicit single-user local mode; no login UI or session provider
```

`LOCAL_OWNER_EMAIL` names the installation owner in both modes. In Better Auth
mode, the first identity registered with that address adopts the pre-existing
`disabled` application user rather than starting an empty one, so an
installation can move from disabled mode to Better Auth without losing its
companies, files, or settings. While sign-up is open during that migration, set
`AUTH_SIGN_UP_CODE` so only a registrant holding that code can create an
identity; it is what keeps a stranger who guesses the owner's address from
adopting the owner's user.

`BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are required in Better Auth mode.
Generate the secret with `openssl rand -base64 32`. Disabled mode must be
protected by the deployment environment (local device, VPN, or reverse proxy);
it is never selected as a missing-configuration fallback.

## Decision context

Nevermodel is intended to be open source and installable on a user's own machine.
Its accounting authorization model must therefore not depend permanently on a
hosted identity vendor. At the same time, a deliberate no-login installation is
valid for a single-user machine and must not be confused with multi-user access
control.

## Evaluation: Hanko (not selected for the initial implementation)

Hanko remains a credible alternative identity-provider candidate:

- It is an open-source authentication and user-management system and supports
  self-hosted deployment as well as its hosted service.
- Its official Next.js guide uses `@teamhanko/hanko-elements` for the sign-in
  interface and validates the Hanko session on the server/middleware.
- It supports passwordless/passkey-first login, while retaining passwords,
  2FA, and SSO when a future multi-user installation needs them.
- It would remove the current development-key/CAPTCHA dependency from a
  self-hosted install. It does introduce a separately operated Hanko service
  and database/configuration surface.

Licensing needs an explicit product decision before bundling it: Hanko's
backend is AGPL-3.0, while Hanko Elements and its frontend SDK are MIT. A
self-hosted deployment can run an AGPL service, but Nevermodel should obtain legal
review before distributing it as an integrated image or linking it into a
combined distribution. Keeping Hanko as a separately deployed optional service
is the conservative technical shape until that decision is made.

Hanko remains a possible future provider through the same boundary, but Better
Auth is a lower-operational-overhead default for the initial open-source
installation: it does not require a separately operated identity service and
its license avoids the distribution question described above.

Primary sources: [Hanko overview](https://docs.hanko.io/introduction),
[Hanko’s Next.js integration](https://docs.hanko.io/quickstarts/fullstack/next),
and [self-hosting position](https://www.hanko.io/).
See also Hanko's [self-hosted backend requirements](https://github.com/teamhanko/hanko/blob/main/backend/README.md)
and [license FAQ](https://docs.hanko.io/community-support/faq).

## Required auth boundary

Before adopting Hanko, move framework-specific code behind one app-owned
boundary:

```text
AUTH_MODE=better-auth | disabled
             ↓
identity provider: current identity, protect request, sign in/out UI
             ↓
@finance/auth service: provision user and require company membership
             ↓
company-scoped application routes and accounting authorization
```

The existing `@finance/auth` service and database repository already form most
of the lower half of this boundary. The migration work is to remove direct
Framework-specific imports from app routes/pages/components are replaced by
adapters for Better Auth and disabled mode. Both return the same normalized
identity shape and use the same company-access checks.

## Disabled login mode

`AUTH_MODE=disabled` is an explicit single-user deployment option, not an
authentication fallback. It must:

1. Create/use one configured local user identity (for example
   `LOCAL_OWNER_EMAIL`) through the normal application-user and company
   provisioning path.
2. Use the same `requireCompanyAccess` and company-scoped repository queries
   as authenticated modes; only identity acquisition changes.
3. Hide login/logout UI and never load a third-party identity script.
4. Start only when explicitly selected. Production documentation must say that
   this mode is appropriate only for a device or private network whose access
   is controlled outside Nevermodel. It must not be internet-exposed without a
   reverse-proxy or other access control.
5. Be covered by route, mutation, and company-provisioning tests. It may not
   silently activate when Better Auth configuration is missing.

## Adoption sequence

1. Extract the app-owned provider interface and remove all direct prior-provider imports. ✓
2. Add Better Auth server session validation, normalized identity, Nevermodel UI,
   logout, CSP, and schema migration. ✓
3. Add and test disabled single-user mode, including local-only deployment
   documentation. ✓
4. Run auth-mode acceptance tests against the same company-access and API
   authorization suite. ✓
5. Only then evaluate multi-user roles, invitations, company switching, and
   distributed rate limiting. No-login mode is intentionally incompatible with
   multi-user authorization.

## Explicit non-goals for this pass

- No automatic production fallback to disabled mode.
- No multi-user roles, invitations, or tenant switching.
- No authorization decisions delegated to the language model.
