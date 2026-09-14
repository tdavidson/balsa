import {
  parseConfiguredCompanies,
  type ApplicationUser,
  type AuthIdentity,
  type AuthRepository,
  type AuthorizedCompany,
  type NewCompanyInput,
  type ProvisionedIdentity,
} from "@finance/auth";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Queryable } from "./company-scope";
import { getDatabase, type Database } from "./index";
import { companies, companyMembers, pendingMembers, users } from "./schema";

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

      await transaction.insert(companyMembers).values({ companyId: company.id, userId: user.id, role: "owner" });

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
   * The environment is purely additive: a configured name the owner already has
   * (compared case-insensitively) is left untouched, a name dropped from the
   * environment is never deleted or renamed, and nothing is ever copied between
   * companies. Callers run this inside the advisory-locked provisioning
   * transaction, so concurrent first requests cannot duplicate a company.
   */
  async function ensureConfiguredCompanies(transaction: Queryable, userId: string) {
    const configured = parseConfiguredCompanies(process.env.COMPANIES);
    if (configured.length === 0) return;

    const syncKey = `${userId}:${process.env.COMPANIES}`;
    if (configuredCompanySyncs.has(syncKey)) return;

    const existing = await authorizedCompaniesQuery(transaction, userId);
    const existingNames = new Set(existing.map((company) => company.name.toLocaleLowerCase()));

    // `now()` is the transaction timestamp, so every row inserted here would
    // otherwise tie on created_at and fall back to the random company id for
    // ordering. Stamp the memberships in listed order instead: the first
    // configured company must be the owner's default.
    const stampedAt = Date.now();
    for (const [offset, input] of configured.entries()) {
      const name = input.name.toLocaleLowerCase();
      if (existingNames.has(name)) continue;
      existingNames.add(name);

      const [company] = await transaction
        .insert(companies)
        .values({ name: input.name, baseCurrency: input.baseCurrency })
        .returning();
      if (!company) throw new Error("Unable to create the configured company");

      await transaction.insert(companyMembers).values({
        companyId: company.id,
        userId,
        role: "owner",
        createdAt: new Date(stampedAt + offset),
      });
    }

    configuredCompanySyncs.add(syncKey);
  }

  /**
   * Attach every company that added this address before an account with it
   * existed. The membership keeps the pending row's timestamp, so an invited
   * user's default company is the one that invited them first, and the pending
   * rows are consumed in the same transaction that creates the memberships.
   * Addresses are stored lowercased, so a plain equality hits the email index.
   */
  async function attachPendingMemberships(transaction: Queryable, userId: string, email: string) {
    const address = normalizedEmail(email);
    if (!address) return;

    const pending = await transaction
      .select({ id: pendingMembers.id, companyId: pendingMembers.companyId, role: pendingMembers.role, createdAt: pendingMembers.createdAt })
      .from(pendingMembers)
      .where(eq(pendingMembers.email, address))
      .orderBy(asc(pendingMembers.createdAt));
    if (pending.length === 0) return;

    for (const row of pending) {
      // An existing membership wins: a pending row must never downgrade a role
      // the company already granted.
      await transaction
        .insert(companyMembers)
        .values({ companyId: row.companyId, userId, role: row.role, createdAt: row.createdAt })
        .onConflictDoNothing();
    }
    await transaction.delete(pendingMembers).where(inArray(pendingMembers.id, pending.map((row) => row.id)));
  }

  async function provisionIdentity(
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

      // Invitations are honored before anything else can decide this user has
      // no company: a person added by email must land in that company rather
      // than in a freshly provisioned empty one.
      await attachPendingMemberships(transaction, userRow.id, userRow.email);

      // The owner's environment-declared companies are created first, so a
      // first sign-in with COMPANIES set opens the first configured company
      // rather than a DEFAULT_COMPANY_NAME one, and a later sign-in picks up
      // names added to the environment since.
      if (isInstallationOwner(identity)) await ensureConfiguredCompanies(transaction, userRow.id);

      // Provisioning creates a company only for a user with no membership at
      // all. A user who already belongs to one or more companies keeps exactly
      // those companies; the first one is the default selection.
      const [membership] = await authorizedCompaniesQuery(transaction, userRow.id).limit(1);

      if (membership) {
        return { user: toUser(userRow), company: membership };
      }

      const [company] = await transaction
        .insert(companies)
        .values({ name: defaultCompanyName(identity) })
        .returning();
      if (!company) throw new Error("Unable to provision company");

      await transaction.insert(companyMembers).values({
        companyId: company.id,
        userId: userRow.id,
        role: "owner",
      });

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
