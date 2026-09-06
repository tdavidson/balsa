# Authentication

Authentication is required in V0 because the system will contain real company financial data.

Keep authentication simple.

Do not build:

- complex roles;
- team invitations;
- SSO;
- enterprise permissions;
- organization administration;
- granular object-level permissions.

The goal is secure company access, not a full identity platform.

---

## Authentication Provider

Use Clerk for the hosted V0 deployment.

Reference hosted architecture:

```text id="gmfk23"
Browser
   ↓
Clerk authentication
   ↓
Next.js / Vercel
   ↓
Neon Postgres
```

Clerk is responsible for:

- user authentication;
- sessions;
- login flow;
- identity verification.

The application database remains responsible for:

- application users;
- companies;
- company membership;
- authorization to company financial data.

Do not make Clerk IDs the canonical identifiers for financial objects.

---

## Application User Model

Maintain an internal user record.

Suggested schema:

```ts id="jhds62"
User {
  id
  auth_provider
  auth_provider_user_id

  email
  name?

  created_at
  updated_at
}
```

Initial values:

```text id="1mu93e"
auth_provider = "clerk"
auth_provider_user_id = Clerk user ID
```

The application user ID should be used internally where user references are required.

---

## Company Model

```ts id="0nqgwz"
Company {
  id
  name

  base_currency
  fiscal_year_end?

  created_at
  updated_at
}
```

Every significant financial record must remain scoped to:

```text id="k0aw9f"
company_id
```

---

## Company Membership

Do not place a single `user_id` directly on Company.

Use a membership table even though V0 may initially have only one user per company.

```ts id="cb54wr"
CompanyMember {
  company_id
  user_id

  role

  created_at
}
```

V0 may support only:

```text id="4qg8nk"
owner
```

The data model should leave room for later roles without implementing them now.

---

## Authorization Rule

Every server-side read or mutation of company data must follow this pattern:

```text id="wmkmiw"
Authenticated user
      ↓
Internal user
      ↓
Company membership
      ↓
Authorized company_id
      ↓
Company data
```

Never trust `company_id` from the browser without verifying membership server-side.

The LLM and agent tools must also operate within the authenticated company scope.

For example:

```text id="57yb4j"
search_company_state(company_id)
```

must not accept an arbitrary company ID from model output.

The authenticated application context determines the company.

This prevents the model from accidentally or maliciously accessing another company's state.

---

## Auth Abstraction

Do not scatter Clerk-specific code throughout the finance application.

Create a thin application authentication boundary.

Conceptually:

```ts id="d1b6f8"
getCurrentUser()
requireUser()
getCurrentCompany()
requireCompanyAccess()
```

Initial implementation:

```text id="bsz8d8"
ClerkAuthProvider
```

The rest of the application should use the internal authentication helpers rather than importing Clerk directly.

This supports a future self-hosted authentication implementation without changing the finance engine or Company State.

---

## Future Self-Hosted Authentication

Do not implement this in V0.

However, preserve the ability to support:

```text id="lv2udg"
Hosted deployment
Vercel
Neon
Clerk

Self-hosted deployment
Docker
Postgres
self-hosted authentication provider
```

A future open-source deployment could use Better Auth or another self-hostable authentication system behind the same application authentication interface.

Do not build a generalized authentication plugin framework.

A simple adapter boundary is sufficient.

---

## Initial Login UX

Keep login extremely simple.

Suggested hosted flow:

```text id="51x7mi"
Sign in
   ↓
Company
   ↓
Single finance page
```

Support:

- Google sign-in;
- email sign-in.

Do not build an onboarding wizard initially.

On first successful login, the application may:

1. create the internal User record;
2. create the initial Company if one does not exist;
3. create the CompanyMember record with role `owner`;
4. land directly on the one-page application.

---

## Multi-Company Support

The schema should support multiple companies per user.

The V0 interface does not need to expose sophisticated multi-company navigation.

If only one company exists, open it automatically.

If multiple companies exist later, a minimal company selector can be added.

Do not let multi-company UX delay V0.

---

# Security Requirements

Because the application handles financial information:

- all company queries must be authorized server-side;
- all agent tools must be company-scoped;
- API keys must remain server-side;
- `DATABASE_URL` must remain server-side;
- file access must be scoped to the authenticated company;
- source files must not be publicly addressable by default;
- financial Markdown documents must follow the same access controls as structured state;
- model-provider calls must receive only data from the authorized company context.

Avoid sending unnecessary company data to the LLM.

---

# Environment Variables

Hosted V0 should support approximately:

```env id="j944nq"
DATABASE_URL=

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=

MODEL_PROVIDER=
MODEL_NAME=

OPENAI_API_KEY=
OPENROUTER_API_KEY=

APP_SECRET=
```

Optional file storage remains:

```env id="rsib0g"
FILE_STORAGE=s3

S3_ENDPOINT=
S3_BUCKET=
S3_ACCESS_KEY=
S3_SECRET_KEY=
```

---

# Revised Phase 1 — Skeleton and Security

Replace the previous Phase 1 with:

## Phase 1 — Skeleton and Security

Implement:

- Next.js application;
- TypeScript;
- single-page shell;
- Vercel deployment;
- Neon PostgreSQL;
- Drizzle;
- database migrations;
- Clerk authentication;
- internal User model;
- Company model;
- CompanyMember model;
- server-side company authorization;
- auth abstraction helpers;
- OpenAI/OpenRouter provider abstraction.

At the end of Phase 1:

1. the application is live on Vercel;
2. a user can sign in;
3. the user is associated with a company;
4. the application can read/write only that company's data;
5. the application connects to Neon;
6. the model-provider abstraction works;
7. the one-page application shell loads.

Do not begin financial logic until this foundation works.

---

# Revised Repository Architecture

Authentication should remain a small application boundary.

Suggested structure:

```text id="h188oz"
/apps
    /web

/packages
    /company-state
    /finance-engine
    /agent
    /model-providers
    /ingestion
    /database
    /auth

/templates
    /management-company
        company.md
        policies.md
        allocations.md
        accounting.md
        forecast.md
```

`/packages/auth` should contain application-facing authentication helpers and types.

Clerk-specific implementation can live there or in the web application adapter.

The finance engine must have no dependency on authentication.

---

# Revised V0 Success Criteria

Add:

16. Real company financial data requires authentication.
17. Every financial operation is authorized against company membership.
18. Agent tools cannot access data outside the authenticated company.
19. Hosted V0 supports Clerk authentication.
20. Authentication can later be replaced for self-hosted deployments without rewriting Company State or the finance engine.