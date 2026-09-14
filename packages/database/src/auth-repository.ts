import {
  parseConfiguredCompanies,
  type ApplicationUser,
  type AuthIdentity,
  type AuthRepository,
  type AuthorizedCompany,
  type NewCompanyInput,
  type ProvisionedIdentity,
} from "@finance/auth";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Queryable } from "./company-scope";
import { getDatabase, type Database } from "./index";
import { companies, companyMembers, users } from "./schema";

function toUser(row: typeof users.$inferSelect): ApplicationUser {
  return { id: row.id, email: row.email, name: row.name, hasAvatar: Boolean(row.avatarStorageReference) };
}

function defaultCompanyName(_identity: AuthIdentity) {
  if (process.env.DEFAULT_COMPANY_NAME) return process.env.DEFAULT_COMPANY_NAME;
  return "User's Company";
}

function normalizedEmail(email: string | null | undefined) {
  return email?.trim().toLocaleLowerCase() ?? "";
}

/**
 * `LOCAL_OWNER_EMAIL` names the installation owner permanently: in disabled
 * mode it is the operator identity, and in Better Auth mode the account
 * registered with that address owns the original company and its data. A Better
 * Auth identity seen for the first time with that address therefore adopts the
 * pre-existing `disabled` application user instead of starting an empty one, so
 * switching modes keeps the owner's companies, files, and settings.
 *
 * This is naturally one-shot: the adopted row stops being a `disabled` user, so
 * a later identity finds no candidate. It is safe to leave configured because
 * registration is gated by `AUTH_SIGN_UP_CODE`, so no stranger who can reach
 * the host can register the owner's address to take the row.
 */
function isConfiguredOwnerIdentity(identity: AuthIdentity) {
  const ownerEmail = normalizedEmail(process.env.LOCAL_OWNER_EMAIL);
  return (
    identity.provider === "better-auth" &&
    ownerEmail.length > 0 &&
    normalizedEmail(identity.email) === ownerEmail
  );
}

/** The installation owner in either mode: the local operator, or the Better Auth account holding `LOCAL_OWNER_EMAIL`. */
function isInstallationOwner(identity: AuthIdentity) {
  return identity.provider === "disabled" || isConfiguredOwnerIdentity(identity);
}

/**
 * Owner ids whose `COMPANIES` top-up has already run in this process, keyed by
 * the configured value so an edited environment re-syncs on the next request.
 * The top-up is idempotent; the memo only keeps it off the per-request path.
 */
const configuredCompanySyncs = new Set<string>();

/**
 * User ids already joined to every company in this process. Membership here is
 * installation-wide, so the join is a no-op on all but the first request of a
 * user's process lifetime — but it must run again as soon as a company appears,
 * so creating one drops the whole memo. Another process creating a company is
 * covered by that process's own join and by this one's next restart; the
 * statement is idempotent either way.
 */
const installationMembershipSyncs = new Set<string>();

function forgetInstallationMemberships() {
  installationMembershipSyncs.clear();
}

/**
 * Everyone admitted to this installation works in every company on it. A new
 * company therefore belongs to every user at once, and the membership carries
 * the company's own `created_at` so the ordering that picks a default company
 * is the installation's company order rather than the order people joined.
 *
 * One statement, so a company with a thousand users costs one round trip, and
 * `on conflict do nothing` keeps it safe to repeat.
 */
async function joinEveryUserToCompany(transaction: Queryable, companyId: string) {
  await transaction.execute(sql`
    insert into company_members (company_id, user_id, role, created_at)
    select ${companyId}::uuid, ${users.id}, 'owner'::company_role, ${companies.createdAt}
    from ${users}, ${companies}
    where ${companies.id} = ${companyId}::uuid
    on conflict do nothing
  `);
}

/**
 * The same rule from the other side: one user, every company that exists.
 * Stamping each membership with the company's `created_at` makes the oldest
 * company this user's default, exactly as it is for everyone else, so a person
 * admitted today opens the same company as the person who set the host up.
 */
async function ensureInstallationMemberships(transaction: Queryable, userId: string) {
  if (installationMembershipSyncs.has(userId)) return;

  await transaction.execute(sql`
    insert into company_members (company_id, user_id, role, created_at)
    select ${companies.id}, ${userId}::uuid, 'owner'::company_role, ${companies.createdAt}
    from ${companies}
    on conflict do nothing
  `);

  installationMembershipSyncs.add(userId);
}

export function createDatabaseAuthRepository(
  database?: Database,
): AuthRepository {
  const resolveDatabase = () => database ?? getDatabase();

  async function findUser(identity: AuthIdentity) {
    const [row] = await resolveDatabase()
      .select()
      .from(users)
      .where(
        and(
          eq(users.authProvider, identity.provider),
          eq(users.authProviderUserId, identity.providerUserId),
        ),
      )
      .limit(1);

    return row ? toUser(row) : null;
  }

  /**
   * Membership order is the default-company order everywhere: the earliest
   * membership first, with the company id as a stable tie-breaker.
   */
  function authorizedCompaniesQuery(database: Queryable, userId: string, companyId?: string) {
    const conditions = [eq(companyMembers.userId, userId)];
    if (companyId) conditions.push(eq(companyMembers.companyId, companyId));
    return database
      .select({
        id: companies.id,
        name: companies.name,
        baseCurrency: companies.baseCurrency,
        financialStateRevision: companies.financialStateRevision,
        role: companyMembers.role,
      })
      .from(companyMembers)
      .innerJoin(companies, eq(companies.id, companyMembers.companyId))
      .where(and(...conditions))
      .orderBy(asc(companyMembers.createdAt), asc(companies.id));
  }

  async function findCompanyForUser(
    userId: string,
    requestedCompanyId?: string,
  ): Promise<AuthorizedCompany | null> {
    const [row] = await authorizedCompaniesQuery(resolveDatabase(), userId, requestedCompanyId).limit(1);
    return row ?? null;
  }

  async function listCompaniesForUser(userId: string): Promise<AuthorizedCompany[]> {
    return authorizedCompaniesQuery(resolveDatabase(), userId);
  }

  async function createCompanyForUser(
    userId: string,
    input: NewCompanyInput,
  ): Promise<AuthorizedCompany> {
    return resolveDatabase().transaction(async (transaction) => {
      const [user] = await transaction.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
      if (!user) throw new Error("Unable to create company: the application user does not exist");

      // A new company starts empty. Nothing is copied from any other company
      // the user belongs to; onboarding populates it from its own evidence.
      const [company] = await transaction
        .insert(companies)
        .values({ name: input.name, baseCurrency: input.baseCurrency })
        .returning();
      if (!company) throw new Error("Unable to create company");

      // The creator is not privileged here: a company created on this
      // installation belongs to everyone on it, including people admitted
      // later, whose own provisioning joins them.
      await joinEveryUserToCompany(transaction, company.id);
      forgetInstallationMemberships();

      return {
        id: company.id,
        name: company.name,
        baseCurrency: company.baseCurrency,
        financialStateRevision: company.financialStateRevision,
        role: "owner",
      };
    });
  }

  /**
   * Materialize the `COMPANIES` environment list for the installation owner.
   * The environment is purely additive: a configured name the installation
   * already has (compared case-insensitively) is left untouched, a name dropped
   * from the environment is never deleted or renamed, and nothing is ever
   * copied between companies. Callers run this inside the advisory-locked provisioning
   * transaction, so concurrent first requests cannot duplicate a company.
   */
  async function ensureConfiguredCompanies(transaction: Queryable, userId: string) {
    const configured = parseConfiguredCompanies(process.env.COMPANIES);
    if (configured.length === 0) return;

    const syncKey = `${userId}:${process.env.COMPANIES}`;
    if (configuredCompanySyncs.has(syncKey)) return;

    const existing = await authorizedCompaniesQuery(transaction, userId);
    const existingNames = new Set(existing.map((company) => company.name.toLocaleLowerCase()));

    // `now()` is the transaction timestamp, so every company inserted here
    // would otherwise tie on created_at and fall back to the random company id
    // for ordering. Stamp the companies in listed order instead: created_at is
    // what every membership inherits, so the first configured company is the
    // default for this owner and for everyone else on the installation.
    const stampedAt = Date.now();
    for (const [offset, input] of configured.entries()) {
      const name = input.name.toLocaleLowerCase();
      if (existingNames.has(name)) continue;
      existingNames.add(name);

      const [company] = await transaction
        .insert(companies)
        .values({ name: input.name, baseCurrency: input.baseCurrency, createdAt: new Date(stampedAt + offset) })
        .returning();
      if (!company) throw new Error("Unable to create the configured company");

      await joinEveryUserToCompany(transaction, company.id);
      forgetInstallationMemberships();
    }

    configuredCompanySyncs.add(syncKey);
  }

  async function provisionIdentity(identity: AuthIdentity): Promise<ProvisionedIdentity> {
    try {
      return await provisionWithinTransaction(identity);
    } catch (error) {
      // The membership memo is written inside the transaction, so a rollback
      // would otherwise leave this process believing it had joined a user to
      // companies it never wrote. Dropping the memo costs one repeated
      // idempotent statement and keeps the claim honest.
      forgetInstallationMemberships();
      throw error;
    }
  }

  async function provisionWithinTransaction(
    identity: AuthIdentity,
  ): Promise<ProvisionedIdentity> {
    return resolveDatabase().transaction(async (transaction) => {
      // Serialize first-login provisioning for one provider identity. This avoids
      // duplicate companies when the browser makes concurrent initial requests.
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`${identity.provider}:${identity.providerUserId}`}))`,
      );

      // The local disabled provider is bootstrap identity only. Once the user
      // changes their profile in the app, do not overwrite it on every request.
      // The same behavior is also safer for any future provider that sends a
      // stale display name.
      let [userRow] = await transaction.select().from(users).where(and(eq(users.authProvider, identity.provider), eq(users.authProviderUserId, identity.providerUserId))).limit(1);
      if (!userRow) {
        if (isConfiguredOwnerIdentity(identity)) {
          const ownerEmail = normalizedEmail(identity.email);
          // Serialize the adoption independently from the Better Auth subject
          // lock. This prevents two simultaneous first sign-ins from attaching
          // different identities to the same local user.
          await transaction.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`local-owner-adoption:${ownerEmail}`}))`,
          );

          const disabledCandidates = await transaction
            .select()
            .from(users)
            .where(
              and(
                eq(users.authProvider, "disabled"),
                sql`lower(${users.email}) = ${ownerEmail}`,
              ),
            )
            .limit(2);

          if (disabledCandidates.length > 1) {
            throw new Error(
              "Unable to adopt the existing local user: more than one disabled user has the configured LOCAL_OWNER_EMAIL.",
            );
          }

          const [disabledUser] = disabledCandidates;
          if (disabledUser) {
            [userRow] = await transaction
              .update(users)
              .set({
                authProvider: identity.provider,
                authProviderUserId: identity.providerUserId,
                email: identity.email,
              })
              .where(eq(users.id, disabledUser.id))
              .returning();
          }
        }

        if (!userRow) {
          [userRow] = await transaction
            .insert(users)
            .values({ authProvider: identity.provider, authProviderUserId: identity.providerUserId, email: identity.email, name: identity.name })
            .returning();
        }
      }

      if (!userRow) throw new Error("Unable to provision application user");

      // Everyone admitted to this installation belongs to every company on it,
      // so the join runs before anything can decide this user has no company:
      // a second person must land in the companies that already exist rather
      // than in a freshly provisioned empty one.
      await ensureInstallationMemberships(transaction, userRow.id);

      // The owner's environment-declared companies are created first, so a
      // first sign-in with COMPANIES set opens the first configured company
      // rather than a DEFAULT_COMPANY_NAME one, and a later sign-in picks up
      // names added to the environment since.
      if (isInstallationOwner(identity)) await ensureConfiguredCompanies(transaction, userRow.id);

      // The join above put this user in every company that exists, so an empty
      // result means the installation itself is empty. A default company is
      // created for that case alone: someone joining a host that already has
      // companies receives all of them and no extra one.
      const [membership] = await authorizedCompaniesQuery(transaction, userRow.id).limit(1);

      if (membership) {
        return { user: toUser(userRow), company: membership };
      }

      const [company] = await transaction
        .insert(companies)
        .values({ name: defaultCompanyName(identity) })
        .returning();
      if (!company) throw new Error("Unable to provision company");

      await joinEveryUserToCompany(transaction, company.id);
      forgetInstallationMemberships();

      return {
        user: toUser(userRow),
        company: {
          id: company.id,
          name: company.name,
          baseCurrency: company.baseCurrency,
          financialStateRevision: company.financialStateRevision,
          role: "owner",
        },
      };
    });
  }

  return { provisionIdentity, findUser, findCompanyForUser, listCompaniesForUser, createCompanyForUser };
}
