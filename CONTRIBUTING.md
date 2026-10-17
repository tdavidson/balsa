# Contributing

Thanks for helping improve Balsa. Contributions are welcome, especially
those that make financial outputs more correct, traceable, secure, and useful.

## Before you start

- Search existing issues before opening a new one.
- Open an issue before a large product, data-model, or accounting change.
- Treat this repository as public even while it is private. Never include real
  customer or operating-company names, financials, business details, files,
  credentials, or personal information in commits, issues, pull requests,
  comments, attachments, or CI output. Use entirely synthetic examples and
  fixtures; masking identifiers does not make real financial data publishable.
  See the company-data rules in [AGENTS.md](AGENTS.md).
- Report vulnerabilities privately using [SECURITY.md](SECURITY.md).

## Local development

You need Node.js 22+, pnpm 10+, Docker, and an OpenAI or OpenRouter API key.

```bash
pnpm run setup
pnpm run doctor
pnpm dev
```

Use `AUTH_MODE=disabled` for a private local development instance. Do not expose
that mode directly to a network.

## Making a change

1. Fork the repository and create a focused branch.
2. Add or update tests for changed behavior and regressions.
3. For a material accounting correction, add an entirely synthetic
   fixture that would have caught it.
4. Update documentation when behavior or configuration changes.

Before opening a pull request, run:

```bash
pnpm run verify
pnpm lint
```

Run `pnpm acceptance` as well when changing ingestion, financial calculations,
database behavior, or the Company Zero workflow.

`pnpm test` includes database-backed tests in `packages/database` whenever
`DATABASE_URL` (or `TEST_DATABASE_URL`) points at a migrated PostgreSQL; they
skip themselves when neither is set, so run `pnpm db:migrate` first if you want
the company repository and row level security coverage.

Run `pnpm isolation` when changing company selection, company-scoped routes,
provisioning and roles, the audit log, or row level security. It is a black-box
acceptance script rather than a unit test: start the application first, point it
at the instance with `BASE_URL`, and pick the mode with
`ISOLATION_AUTH_MODE=disabled` or `ISOLATION_AUTH_MODE=better-auth`. Both modes
must pass. Better Auth mode signs people up and also proves the installation
rules—registration without the sign-up code is refused, a second user joins
every company that already exists without being given one of their own, and
isolation still holds per company for them—so run it against an instance with
`AUTH_ALLOW_SIGN_UP=true` and pass that installation's `AUTH_SIGN_UP_CODE` as
`ISOLATION_SIGN_UP_CODE`.

In the pull request, explain the problem, behavior before and after, verification,
and any schema, security, migration, deployment, or accounting impact. Clarify
whether AI proposes the result or deterministic code authorizes and calculates it.

## Licensing

Balsa is licensed under the [Apache License 2.0](LICENSE). Under Section 5,
contributions intentionally submitted for inclusion are provided under the same
terms unless explicitly stated otherwise. No separate CLA is required.

For private questions, contact Taylor Davidson at hello@hemrock.com.
