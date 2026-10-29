# Agent setup

Balsa has a predictable, non-destructive setup path that a coding agent can
run without asking for secret values or guessing which migration is current.

## Give an agent this instruction

> Read `AGENTS.md`. Run `pnpm run setup`, then `pnpm run doctor`. Never display or replace
> populated secrets. Resolve setup failures using `.env.example`, start the app,
> and run `pnpm verify` before handing work back. Treat the repository as public:
> never include actual customer or operating-company names, financials, details,
> or files in GitHub, including commits, issues, pull requests, and artifacts.
> Use entirely synthetic examples and follow the company-data rules in `AGENTS.md`.

The setup command is safe to repeat. It copies `.env.example` only when `.env`
does not exist, fills only blank application-secret fields, preserves model keys
and all existing settings, creates local file storage, installs dependencies when
needed, starts the repository PostgreSQL service for the default local database,
and applies every checked-in migration.

```bash
pnpm run setup
pnpm run doctor
pnpm dev
```

Useful setup flags:

```bash
pnpm run setup -- --dry-run       # describe actions without changing anything
pnpm run setup -- --no-install    # do not install packages
pnpm run setup -- --no-docker     # do not start PostgreSQL
pnpm run setup -- --no-migrate    # do not apply migrations
pnpm run doctor -- --json  # machine-readable diagnostics
```

`pnpm run doctor` is read-only. It checks the required Node and pnpm versions,
dependencies, environment, selected model provider, authentication mode, local
storage permissions, database connectivity, and whether the database includes
the newest checked-in migration. Its remediation messages name the exact command
or variable required, but never print secret values.

`pnpm run verify` is the common handoff gate and mirrors the core CI sequence:

```bash
pnpm run doctor
pnpm typecheck
pnpm test
pnpm build
```

Accounting and tenancy changes may require the additional acceptance and
isolation commands described in `AGENTS.md` and `CONTRIBUTING.md`.

## Full-app Docker quickstart

The default Compose behavior remains a database-only development service. The
`full` profile builds and runs both Balsa and PostgreSQL:

```bash
cp .env.example .env
# Add OPENAI_API_KEY or OPENROUTER_API_KEY and review AUTH_MODE.
docker compose --profile full up --build
```

Open <http://localhost:3000>. The app container applies migrations before it
starts, stores uploaded files in the `balsa_files` volume, and connects to
the Compose PostgreSQL service. Stop it with:

```bash
docker compose --profile full down
```

Volumes are retained. Removing volumes deletes the local database and uploaded
files and therefore must be an explicit operator decision.
