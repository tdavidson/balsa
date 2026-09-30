# Teller bank sync

Teller is optional. Every Nevermodel installation uses **its own Teller application** and credentials. There is no Nevermodel-operated account, credential service, or bank-data relay. All installation configuration is supplied through environment variables; connected accounts and encrypted enrollment tokens belong to the selected company in your database.

## Configure your installation

1. Create your own application at https://teller.io. Follow the [Teller quickstart](https://teller.io/docs/guides/quickstart).
2. Copy the `TELLER_*` entries from `.env.example` into your private root `.env` or deployment environment. Existing installs are not overwritten by setup.
3. Set `TELLER_APPLICATION_ID` to your application ID and `TELLER_TOKEN_SIGNING_PUBLIC_KEY` to the Token Signing Key from your application's dashboard. The public key can be base64-encoded raw Ed25519 or a PEM public key.
4. Generate `TELLER_TOKEN_ENCRYPTION_KEY` once with `openssl rand -base64 32` and store the result privately. Back up this key with your database credentials. Changing it makes existing tokens unreadable; changing the value is not a key-rotation procedure.
5. Start with `TELLER_ENVIRONMENT=sandbox`. No client certificate is required for synthetic sandbox accounts.
6. Run `pnpm run setup` (use `-- --no-docker` for an already-running database), `pnpm run doctor`, and `pnpm dev`. Open `/imports` → **Connect bank accounts**, or go directly to `/banks`.
7. Click **Connect bank**, choose synthetic accounts in Teller Connect, then map each account to an existing ledger account. Depository accounts require an active cash asset; credit cards require an active liability. An existing conflicting statement identifier must be reviewed before changing the mapping. Unmapped accounts do not import.
8. Click **Sync now**. Open a monthly **Review** link to inspect the imported evidence. A repeated unchanged sync should create zero new imports.

Never paste certificates, private keys, access tokens, or encryption keys into issues, logs, or commits. Do not prefix secret variables with `NEXT_PUBLIC_`. Only the application ID, environment, and a short-lived nonce are sent to Teller Connect. The browser returns the enrollment token once; it is never included in subsequent API responses.

| Variable | Required | Purpose |
| --- | --- | --- |
| `TELLER_APPLICATION_ID` | To enable Teller | Your own Teller application ID. Blank disables connection setup. |
| `TELLER_ENVIRONMENT` | Defaults to `sandbox` | `sandbox`, `development`, or `production`. |
| `TELLER_TOKEN_SIGNING_PUBLIC_KEY` | Yes | Verifies signed enrollment responses against a one-use, company/user-bound nonce. |
| `TELLER_TOKEN_ENCRYPTION_KEY` | Yes | Base64-encoded 32-byte AES-GCM encryption key. |
| `TELLER_CERTIFICATE` | Development/production | Client certificate PEM **contents**, not a filename. |
| `TELLER_PRIVATE_KEY` | Development/production | Client private key PEM **contents**, not a filename. |
| `TELLER_WEBHOOK_SECRET` | For webhooks | Webhook signing secret from the Teller dashboard. |
| `CRON_SECRET` | For automatic sync | Existing Nevermodel scheduled-job secret. |

PEM values accept literal `\n` separators or quoted multiline values. For example, the shape is `TELLER_CERTIFICATE="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"`; replace the entire placeholder with your certificate locally. Docker Compose's full app profile already loads `.env` through `env_file`. Other hosts should inject these variables into the Node server runtime.

For real banks, set `development` or `production` and supply the certificate and private key from your own Teller dashboard. Both environments use mutual TLS. Connections are bound to their original Teller application/environment; restoring that configuration is required to manage them. Sandbox and real-data connections are never silently mixed. Use a separate test company for sandbox evidence.

## Automatic syncing

Configure your host's scheduler to request **GET `/api/jobs/banks`** once a minute, with `Authorization: Bearer <your CRON_SECRET>`. The scheduler must keep this header private. This endpoint processes one due enrollment per invocation, orders oldest work first, and schedules the next successful sync six hours later. Failed syncs retry after an hour. Increase scheduler frequency if the installation has many enrollments; no always-running in-process timer is required. A local installation must be running when the scheduler calls it.

For a host cron job, store `NEVERMODEL_URL` and `CRON_SECRET` in the job's private environment and run:

```sh
curl --fail --silent --show-error \
  --header "Authorization: Bearer $CRON_SECRET" \
  "$NEVERMODEL_URL/api/jobs/banks"
```

Do not put the secret literal in a shared crontab or command history. `NEVERMODEL_URL` above is a scheduler variable, not application configuration.

Optionally register `https://YOUR_HOST/api/banks/webhook` in Teller's dashboard and configure `TELLER_WEBHOOK_SECRET`. The endpoint verifies the raw request signature and its timestamp, then queues a sync; **the scheduler is still required**. It does not trust transaction data supplied inside a webhook. Disconnection notifications show a reconnect prompt and pause scheduled work until repaired. A private localhost installation can use scheduled polling without exposing a webhook.

Use **Reconnect** for expired bank authorization. **Disconnect** revokes the enrollment with Teller before removing the encrypted token locally. If revocation fails, credentials are retained so you can retry. Evidence already imported remains available for audit.

## Accounting and scope

The integration imports posted transaction evidence, not approved journals. Pending transactions are omitted until posted. It fetches all available history with bounded pagination and saves a new immutable monthly snapshot only when normalized posted data or its mapping changes. Stable provider transaction IDs identify rows. Every snapshot retains provider, account, environment, adapter version, import time, and previous-source lineage. No provider category is treated as an approved revenue/expense classification; transfers stay unclassified evidence.

Use the existing evidence review and posting-proposal workflow before approving financial effects. A feed update must be compared with its preceding feed source using **partial update**, with explicit mappings for corrected rows. Also review overlap with uploaded statements or a separately enrolled copy of the same bank account: these cannot be deduplicated safely by date and amount alone.

Provider history is not a certified full statement. Missing transactions do not automatically reverse journals; a whole month disappearing from provider history retains its previous snapshot. Review suspected removals against a bank statement. Feed imports have no opening/closing balance assertions and do not satisfy statement balance reconciliation. Obtain statements for that purpose.

Limits: 20,000 fetched transactions per account (a full 40 pages is rejected rather than silently truncated), 1,000 posted rows per monthly snapshot, bounded provider responses, and a bounded sync time. Oversized or invalid responses fail without saving partial imports. No live-balance, identity, verification, or payment products are requested.

## Tests

```sh
pnpm --filter @finance/web test src/lib/teller.test.ts src/lib/bank-connections.test.ts src/lib/bank-http.test.ts
pnpm run verify
pnpm acceptance
pnpm isolation
```

Unit and database integration tests use generated signing keys and synthetic provider responses. They require no Teller account and never use real company data. Database tests create and clean up synthetic companies. `TEST_DATABASE_URL` can select a separate database after migrations have been applied there.

The hosted Connect sandbox flow requires your own application ID and signing public key. Automated tests cannot establish that your banks are covered or that your Teller application is configured correctly. After configuring it, connect synthetic accounts, sync twice, inspect the pending evidence, reconnect, and disconnect before trying real data.
