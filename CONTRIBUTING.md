# Contributing

Thanks for helping improve Nevermodel. Contributions are welcome, especially
those that make financial outputs more correct, traceable, secure, and useful.

## Before you start

- Search existing issues before opening a new one.
- Open an issue before a large product, data-model, or accounting change.
- Never include real company data, credentials, personal information, or
  unredacted financial documents in an issue, fixture, test, or pull request.
- Report vulnerabilities privately using [SECURITY.md](SECURITY.md).

## Local development

You need Node.js 22+, pnpm 10+, Docker, and an OpenAI or OpenRouter API key.

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:migrate
pnpm dev
```

Use `AUTH_MODE=disabled` for a private local development instance. Do not expose
that mode directly to a network.

## Making a change

1. Fork the repository and create a focused branch.
2. Add or update tests for changed behavior and regressions.
3. For a material accounting correction, add a synthetic or fully redacted
   fixture that would have caught it.
4. Update documentation when behavior or configuration changes.

Before opening a pull request, run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run `pnpm acceptance` as well when changing ingestion, financial calculations,
database behavior, or the Company Zero workflow.

In the pull request, explain the problem, behavior before and after, verification,
and any schema, security, migration, deployment, or accounting impact. Clarify
whether AI proposes the result or deterministic code authorizes and calculates it.

## Licensing

Nevermodel is licensed under the [Apache License 2.0](LICENSE). Under Section 5,
contributions intentionally submitted for inclusion are provided under the same
terms unless explicitly stated otherwise. No separate CLA is required.

For private questions, contact Taylor Davidson at hello@hemrock.com.
