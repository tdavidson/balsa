# Multi-tenant hosted plan

This plan turns nevermodel from a single-operator deployment into a hosted
product that several companies, and several people per company, can use at the
same time. It covers eight workstreams that map to the decisions made on
September 8, 2026:

1. Remove company-specific behavior from shared code.
2. Enforce row-level security (RLS) with a per-transaction company setting.
3. Route every company data access through a per-request transaction wrapper.
4. Store a model-provider key per user.
5. Move ingestion to a jobs table and add file storage.
6. Support several users per company, then add an audit log.
7. Keep company membership in the application database.
8. Decide where background jobs run.

The sections that follow describe each workstream, the schema and code that
change, and the order in which to ship them. File paths are relative to the
repository root.

## Starting point

The data model and the authorization boundary are already tenant-scoped:

- Every financial table has a non-null `company_id` with cascade delete and a
  company-first index (`packages/database/src/schema.ts`).
- Membership is a join table (`company_members`), not a column on
  `companies`, so many users per company and many companies per user are
  representable today.
- Every route except `/api/health` calls `requireCompanyAccess`, and the
  agent receives its company from server context (`apps/web/src/lib/auth`).
- LLM usage and cost are already recorded per company and per user in
  `llm_runs`.

What is missing is the layer around that model: hard isolation guarantees,
membership beyond a single owner, per-user model credentials, background
processing, raw-file retention, and an audit trail.

## Workstream 1: remove company-specific behavior

### What exists today

Three places in shared code encode one customer's data:

- `apps/web/src/app/api/forecast/route.ts` scopes statement balances by
  matching the company name against `advisory` or `venture asset`, then
  matches source text against `Synthetic Example Company advisory` or `Synthetic Example Company venture` and
  filenames against `14.56.00` or `15.58.02`.
- `apps/web/scripts/resolve-klingenstein-review.ts` resolves review items
  whose question mentions one counterparty.
- `apps/web/scripts/reparse-evidence.ts` is generic in purpose but reports on
  `klingenstein` facts in its `--verify` mode and reads statement dates from a
  `dt-YYYY-MM-DD` filename convention that only the original operator uses.

The forecast route also reads statement dates from the same `dt-` filename
convention.

### What replaces it

The marker logic exists to answer one question: which uploaded statements
belong to this company's own accounts? Replace it with data that every company
already has a place for.

- At extraction time, ask the model for statement metadata alongside facts:
  `accountHolder`, `accountIdentifier` (the last four digits or a masked
  number), `statementPeriodStart`, `statementPeriodEnd`, `openingBalance`,
  and `endingBalance`. Store this metadata on `sources.metadata` and copy the
  period and balances to columns on `evidence` so that queries don't parse
  JSON.
- Represent each bank or brokerage account as an `entities` row with
  `type = "account"`. The `entities` table and that type already exist.
- When a statement's account holder or identifier doesn't match a known
  account entity for the company, create a review item that asks whether the
  statement belongs to this company. Do not silently include or exclude it.
- In the forecast route, sum opening and ending balances only from evidence
  whose account entity belongs to the company, and use the stored statement
  period instead of the filename.

Delete `resolve-klingenstein-review.ts`. Turn the reparse script into a job
type (see workstream 5) that a company owner can trigger from the UI, and
remove the counterparty-specific reporting from it.

### Tests

- Unit test the account-matching function with a matching account, an
  unknown account, and a masked identifier.
- Keep the existing evidence-context tests, but rename the fixture
  counterparties to neutral example names.

## Workstream 2: row-level security

### Why it helps even with one user

RLS is worth doing before there is a second tenant, for four reasons:

- A query that forgets its `company_id` filter returns no rows instead of all
  rows. The failure mode becomes visible and safe.
- Scripts and the job worker (workstream 5) run outside a request. RLS gives
  them the same boundary as a route handler.
- Agent tools get a database-level boundary in addition to the application
  one, which matters more as tools grow.
- The second tenant becomes a non-event instead of a security review.

The cost is that every company data access must run inside a transaction
that sets the company (workstream 3). That refactor is the real work.

### Design

Postgres reads the company from a transaction-local setting:

```sql
select set_config('app.company_id', '<uuid>', true);
select set_config('app.user_id', '<uuid>', true);
```

The third argument (`true`) makes the setting local to the transaction, so
it works with transaction-mode connection poolers such as the Neon pooler
and PgBouncer. The `postgres` client already uses `prepare: false`, which
those poolers require.

Each company-scoped table gets one policy:

```sql
alter table evidence enable row level security;
alter table evidence force row level security;
create policy evidence_company on evidence
  using (company_id = current_setting('app.company_id', true)::uuid)
  with check (company_id = current_setting('app.company_id', true)::uuid);
```

When the setting is absent, `current_setting(..., true)` returns null, the
comparison is null, and the policy matches no rows. Inserts with the wrong
`company_id` fail the `with check` clause.

Caution: table owners bypass RLS unless the table has
`force row level security`. On Neon, the default role owns the tables. Use
both defenses: add `force row level security` to every policy migration, and
run the application under a dedicated role that doesn't own the tables.

### Roles and connection strings

| Variable | Role | Used by |
|---|---|---|
| `DATABASE_URL` | `nevermodel_app` (no table ownership, RLS enforced) | Web app, job worker |
| `DATABASE_ADMIN_URL` | Table owner | Migrations, the auth repository, maintenance scripts |

The identity tables (`users`, `companies`, `company_members`, and the
invitations table from workstream 6) stay outside RLS. Only the auth
repository touches them, it is small, and provisioning has to run before a
company is known. Every other table with a `company_id` column gets a
policy, including `llm_runs`, `llm_messages`, `sources`, `observations`,
`entities`, `relationships`, `assumptions`, `scenarios`,
`knowledge_documents`, `decisions`, `policies`, `evidence`, `review_items`,
`fact_records`, `economic_items`, `cash_events`, `reporting_periods`, and
`allocations`.

### Implementation

- Add a migration that creates the app role, enables and forces RLS, and
  creates the policies. Drizzle ORM 0.45 supports `pgPolicy` and
  `.enableRLS()` in the schema, so the policies can live next to the tables.
- Change `llm_runs.company_id` and `llm_messages.company_id` to
  `not null`. They are nullable today, which would let a run escape the
  policy.
- Update `docker-compose.yml` and `.env.example` with the second connection
  string.
- Add an integration test that creates two companies, sets the company to
  one of them, and asserts that every scoped table returns zero rows for the
  other. Run it against a real Postgres in CI.

## Workstream 3: per-request transaction wrapper

### What exists today

Routes call `getDatabase()` directly and run each statement on the shared
pool. Authorization happens once at the top of the handler, and nothing ties
the resulting `context.company.id` to the queries that follow.

### Design

Replace ad hoc database access in routes with one helper:

```ts
export async function withCompany<T>(
  handler: (scope: CompanyScope) => Promise<T>,
  options?: { requestedCompanyId?: string },
): Promise<T>;

type CompanyScope = {
  db: Transaction;               // Drizzle transaction with app.company_id set
  context: ApplicationContext;   // user + authorized company + role
  audit: (entry: AuditEntry) => Promise<void>;  // workstream 6
};
```

The helper does the following:

1. Calls `auth.protect()` and `requireCompanyAccess(requestedCompanyId)`,
   where the requested company comes from the active-company cookie
   (workstream 6).
2. Opens a transaction on the app-role pool and runs `set_config` for the
   company and user.
3. Runs the handler and commits, or rolls back on error.

Keep `getDatabase()` as the pool factory, but rename it to
`getAdminDatabase()` for migrations and the auth repository, and add an
ESLint `no-restricted-imports` rule that forbids it under
`apps/web/src/app/api/**` and `apps/web/src/app/**/page.tsx`.

### Long model calls inside a transaction

A transaction holds a pooled connection for its whole duration. The evidence
and agent routes make model calls that can take tens of seconds, and the
production pool has 10 connections. Structure those handlers as a read
transaction, then the model call outside any transaction, then a write
transaction. After workstream 5, extraction runs in the worker, so only the
agent route keeps this shape.

### Migration order

Convert routes one at a time, starting with the read-only ones (`state`,
`months`, `pnl`, `obligations`, `allocations`, `reviews`, `facts`,
`conversations`, `llm-data`), then the write routes. Enable RLS
(workstream 2) only after every route and page uses the wrapper.

## Workstream 4: per-user model-provider keys

### Design

Each user stores their own OpenRouter or OpenAI key. Because the user pays
for their own usage, the application doesn't need cost-based rate limiting.

Schema:

```text
user_model_credentials
  user_id        uuid, primary key, references users
  provider       text: "openrouter" | "openai"
  encrypted_key  text  (AES-256-GCM, key derived from APP_SECRET)
  key_hint       text  (last four characters, for display)
  default_model  text
  created_at, updated_at
```

`APP_SECRET` is already in `.env.example` and is unused today, so it becomes
the encryption secret. Store the nonce and auth tag alongside the ciphertext.

Code changes:

- `getModelProvider(scope, overrides)` in `apps/web/src/lib/models.ts`
  resolves the credential for `scope.context.user.id` and falls back to the
  environment keys only when `ALLOW_SHARED_MODEL_KEY=true`. Self-hosted
  deployments set that variable; the hosted deployment doesn't.
- `getModelOptions(provider)` returns the option list for the user's
  provider rather than the environment's.
- Add a **Model access** dialog to the account menu with a provider
  selector, a key field, a **Test** button that makes a small request, and a
  **Remove** action. The key never returns to the browser after it's saved;
  the dialog shows only the hint.
- When a user has no key, the composer shows a prompt to add one instead of
  failing the request.
- The usage page filters `llm_runs` by the current user as well as the
  company, because each user pays for their own runs.

Confirm that `recordLlmRun` never stores request headers. It stores the
request body only, so the key doesn't reach `llm_runs.request_json`.

Keep two limits that protect the service rather than cost: a request body
cap on uploads (25 MB is a reasonable default) and one running ingestion job
per user at a time.

## Workstream 5: ingestion jobs and file storage

### What exists today

`POST /api/evidence` parses the file, calls the model for structured
extraction, and writes results, all inside one request with no
`maxDuration`. Raw files are not retained: `sources.storage_reference` is
never written, and only the extracted text is stored. The `FILE_STORAGE` and
`S3_*` variables exist but nothing reads them.

### Storage

Add `packages/storage` with one interface and two implementations:

```ts
interface BlobStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string }>;
  delete(key: string): Promise<void>;
}
```

- `LocalDiskBlobStore` writes under a configurable root, for Docker and
  development.
- `S3BlobStore` uses the S3-compatible API with `S3_ENDPOINT`, so it works
  with Amazon S3, Cloudflare R2, Tigris, and MinIO without code changes.

Object keys follow `companies/<companyId>/sources/<sourceId>/<filename>`.
Objects are never public. Downloads go through an authorized route that
streams from the store after `withCompany` has verified access.

Fill `sources.storage_reference` on every upload, and add `sources.byte_size`.

### Jobs table

```text
jobs
  id             uuid
  company_id     uuid, not null, references companies
  user_id        uuid, not null, references users
  type           text: "evidence.extract" | "actuals.import" | "evidence.reparse"
  status         text: "queued" | "running" | "succeeded" | "failed" | "cancelled"
  payload        jsonb
  result         jsonb
  error          text
  attempts       integer, default 0
  max_attempts   integer, default 3
  run_after      timestamptz, default now()
  locked_at      timestamptz
  locked_by      text
  started_at     timestamptz
  finished_at    timestamptz
  created_at, updated_at
index (status, run_after)
index (company_id, created_at)
```

Add `processing` and `failed` to the `evidence_status` enum, and add
`evidence.job_id`.

### Upload flow

1. `POST /api/evidence` runs inside `withCompany`: hash the file, check for a
   duplicate, write the blob, insert the `sources` row, insert the `evidence`
   row with `status = "processing"`, and insert the job.
2. The route calls Next.js `after()` to kick the job runner once, then
   returns the evidence id and job id.
3. The client polls `GET /api/jobs/<id>` until the job finishes, then
   refreshes the evidence list. The app shell already re-fetches evidence, so
   the change is a status badge and a poll.
4. The job handler is the extraction code moved out of the route into
   `packages/ingestion-pipeline`. It runs inside `withCompany` for the job's
   company and user, so RLS applies to the worker too.

Apply the same shape to `POST /api/actuals`. The reparse script becomes the
`evidence.reparse` job type, triggered from an evidence row's menu.

The agent route stays synchronous. Chat latency matters more than duration
limits there, and it makes at most two model calls per turn. Set
`maxDuration` on it explicitly.

## Workstream 6: several users per company, then an audit log

### Roles

Widen `company_role` to `owner | member`. Owners manage members, company
settings, and deletion. Members do everything financial. Add `admin` later
if a customer asks for it; don't design for it now.

### Invitations

```text
company_invitations
  id                  uuid
  company_id          uuid, not null
  email               text, not null (lowercased)
  role                company_role, default member
  token_hash          text, not null, unique
  invited_by_user_id  uuid, not null
  expires_at          timestamptz, not null
  accepted_at         timestamptz
  revoked_at          timestamptz
  created_at
```

Flow:

1. An owner opens **Members** from the account menu, enters an email, and
   gets an invitation link at `/invite/<token>`. Sending the email is a
   follow-up; copying the link is enough for the first version.
2. The invitee signs in with Clerk. The invite page requires that the
   signed-in email matches the invitation email, then inserts the membership
   and marks the invitation accepted.
3. `provisionIdentity` checks for a pending invitation before creating a
   default company. A user who was invited should land in the inviting
   company, not in a new empty one.

### Active company

Store the active company id in a cookie. `requireCompanyAccess` already
accepts a requested company id and verifies membership, so the wrapper reads
the cookie and passes it through. Add a company switcher and a **New
company** action to the account menu. Remove `DEFAULT_COMPANY_NAME` from the
hosted configuration; keep it as a development convenience only.

### Audit log

```text
audit_log
  id              uuid
  company_id      uuid, not null
  actor_user_id   uuid, not null
  action          text  (evidence.approved, decision.applied, period.closed, member.invited, ...)
  entity_type     text
  entity_id       uuid
  summary         text
  before          jsonb
  after           jsonb
  request_id      text
  created_at      timestamptz
index (company_id, created_at)
```

The `withCompany` wrapper exposes `scope.audit(entry)`, which inserts into
the same transaction as the change. A change and its audit row commit or
roll back together.

Also record the acting user on the rows themselves, so that the audit log
isn't the only place the information lives:

- `decisions.created_by_user_id`
- `review_items.resolved_by_user_id`
- `economic_items.created_by_user_id`
- `reporting_periods.closed_by_user_id`
- `knowledge_documents.updated_by_user_id`

Writes that the agent proposes are attributed to the user who asked the
question, with `via: "agent"` in the audit entry's `after` payload.

Show the log as an **Activity** tab in the history dialog.

## Workstream 7: keep membership in the application

Clerk stays responsible for identity and sessions only. Roles, invitations,
active company, and the audit log live in Postgres, as the authentication
specification in `docs/specs/v0-authentication-additions.md` intended. This
keeps a self-hosted deployment able to swap Clerk for Better Auth behind the
same `IdentityProvider` interface without touching membership.

Don't adopt Clerk Organizations. It would duplicate `company_members` and
tie authorization to a vendor.

## Workstream 8: where background jobs run

### Runner

Write the runner once as a plain function in `packages/jobs`:

```ts
export async function runJobs(options: { limit: number; deadlineMs: number; workerId: string }): Promise<RunSummary>;
```

It claims one job at a time with `for update skip locked`, so several runners
can share the table safely:

```sql
update jobs set status = 'running', locked_at = now(), locked_by = $1, attempts = attempts + 1
where id = (
  select id from jobs
  where status = 'queued' and run_after <= now()
  order by created_at
  for update skip locked
  limit 1
)
returning *;
```

A reaper step returns jobs whose `locked_at` is older than 15 minutes to
`queued` when attempts remain, or marks them `failed` otherwise.

### Hosts

The same runner runs in two places:

| Deployment | Trigger | Notes |
|---|---|---|
| Vercel | `GET /api/jobs/run`, protected by `CRON_SECRET`, called by Vercel Cron every minute and kicked once by `after()` right after enqueue | Set `maxDuration` to the plan's limit and pass a slightly shorter `deadlineMs` |
| Docker or self-hosted | `apps/worker`, a Node process that loops on `runJobs` with a short sleep | Add it as a service in `docker-compose.yml` |

The `after()` kick keeps hosted latency low for a single upload, and the cron
call picks up anything the kick missed. If a very large PDF exceeds the
Vercel duration limit even in the worker route, the fallback is a managed
queue such as Inngest, but don't add that dependency until it's needed.

### Required gate before multi-instance deployment

The current request limits are intentionally process-local: they protect the
single-player, single-instance application but cannot coordinate a limit across
several servers or survive a restart. Before deploying more than one web or
worker instance, replace them with a shared, atomic rate limiter (Redis is the
preferred option; a dedicated Postgres rate-limit table is acceptable). It
must key limits by company, user, and route; return a retry time; enforce limits
for uploads, reprocessing, model calls, and worker-triggering endpoints; and
be covered by a multi-instance integration test. This is a deployment gate,
not optional hardening, because model cost and upload limits otherwise multiply
by the number of instances.

## Delivery order

Ship the work as a sequence of pull requests. Each one is independently
deployable and leaves the app working.

1. **Remove company-specific behavior** (workstream 1). Independent of
   everything else. Do it first because it's small and it stops the customer
   data from spreading further.
2. **Request wrapper** (workstream 3). Add `withCompany`, convert every route
   and page, and add the lint rule. No behavior change.
3. **Row-level security** (workstream 2). Migration, app role, forced RLS,
   two-company integration test, and GitHub Actions CI with a Postgres
   service so the test runs on every push.
4. **Per-user model keys** (workstream 4). Credentials table, encryption,
   settings dialog, and provider resolution.
5. **Blob storage** (workstream 5, first half). Storage package, filled
   `storage_reference`, and the authorized download route.
6. **Jobs table and pipeline** (workstreams 5 and 8, first half). Jobs
   schema, runner, evidence and actuals moved into jobs, status polling in
   the UI, and the reparse job.
7. **Job hosts** (workstream 8, second half). The Vercel cron route, the
   `apps/worker` process, and the Docker Compose service.
8. **Roles, invitations, and the company switcher** (workstream 6, first
   half).
9. **Audit log and actor columns** (workstream 6, second half).

Steps 4 and 5 can proceed in parallel with steps 2 and 3. Step 9 depends on
step 2 because the audit helper lives on the wrapper.

## Decisions taken in this plan

These defaults are built into the plan. Change them before the relevant step
if you disagree.

- Roles are `owner` and `member` only.
- Invitations are link-based at first; email delivery is a follow-up.
- Hosted file storage is S3-compatible rather than Vercel Blob, so that
  self-hosted deployments use the same adapter with MinIO.
- The agent chat route stays synchronous; only ingestion moves to jobs.
- Identity tables stay outside RLS and are reached only through the auth
  repository.
- A dedicated Postgres app role is required for RLS to be meaningful. On
  Neon, create it once by hand and store its connection string as
  `DATABASE_URL`.
