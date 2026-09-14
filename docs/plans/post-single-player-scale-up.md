# Post-single-player scale-up plan

## Boundary

This plan is intentionally deferred until the single-company accounting
acceptance run is complete. None of these items should distract from making
one company's evidence, journals, statements, forecast, and allocation
analysis trustworthy.

Scale-up is now split into two tracks:

1. [Local multi-company](local-multi-company.md): one user operating several
   isolated companies on one installation.
2. [Hosted multi-company](multi-tenant-hosted.md): multiple users, public
   infrastructure, and deployment-scale security and operations.

## Deferred work

1. **Hosted multi-user operation.** Organization membership, invitations,
   role-specific review workflows, tenant administration, support tooling, and
   hosted billing.
2. **Multi-instance workers.** Replace in-process concurrency assumptions with
   a shared limiter/queue implementation; schedule authenticated calculation
   outbox recovery with `CRON_SECRET`; add distributed leases and operational
   dashboards before more than one app instance processes work.
3. **Production storage backends.** Add object storage, lifecycle retention,
   encrypted backup/restore, and deployment-specific storage configuration.
4. **External integrations and broad format expansion.** Add only after the
   representative source set identifies a material repeated format or
   integration need.
5. **Hosted authentication operations.** Evaluate self-hosted Better Auth
   operational requirements, passwordless/email delivery, passkeys, and
   account recovery only when login is enabled for more than the local user.

## Preconditions to start

- A representative three-month company run is reproducible.
- Every material displayed figure is verified or named as unresolved.
- Material corrections have redacted deterministic fixtures.
- Allocation, entity, FX, and forecast behavior has been tested against the
  company's actual source evidence.
