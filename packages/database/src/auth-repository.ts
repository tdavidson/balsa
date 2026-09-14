import type {
  ApplicationContext,
  ApplicationUser,
  AuthIdentity,
  AuthRepository,
  AuthorizedCompany,
} from "@finance/auth";
import { and, asc, eq, sql } from "drizzle-orm";
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
 * A deliberately narrow, one-time bridge from disabled local mode to Better
 * Auth. The configured address is explicit operator authorization to attach
 * that Better Auth identity to the pre-existing local application user.
 */
function canClaimDisabledIdentity(identity: AuthIdentity) {
  const configuredEmail = normalizedEmail(process.env.AUTH_CLAIM_EXISTING_EMAIL);
  return (
    identity.provider === "better-auth" &&
    configuredEmail.length > 0 &&
    normalizedEmail(identity.email) === configuredEmail
  );
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

  async function findCompanyForUser(
    userId: string,
    requestedCompanyId?: string,
  ): Promise<AuthorizedCompany | null> {
    const conditions = [eq(companyMembers.userId, userId)];
    if (requestedCompanyId) {
      conditions.push(eq(companyMembers.companyId, requestedCompanyId));
    }

    const [row] = await resolveDatabase()
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
      .orderBy(asc(companyMembers.createdAt))
      .limit(1);

    return row ?? null;
  }

  async function provisionIdentity(
    identity: AuthIdentity,
  ): Promise<ApplicationContext> {
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
        if (canClaimDisabledIdentity(identity)) {
          const claimEmail = normalizedEmail(identity.email);
          // Serialize the one-time claim independently from the Better Auth
          // subject lock. This prevents two simultaneous first sign-ins from
          // attaching different identities to the same local user.
          await transaction.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`better-auth-claim:${claimEmail}`}))`,
          );

          const disabledCandidates = await transaction
            .select()
            .from(users)
            .where(
              and(
                eq(users.authProvider, "disabled"),
                sql`lower(${users.email}) = ${claimEmail}`,
              ),
            )
            .limit(2);

          if (disabledCandidates.length > 1) {
            throw new Error(
              "Unable to claim the existing local user: more than one disabled user has the configured email.",
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

      const [membership] = await transaction
        .select({
          id: companies.id,
          name: companies.name,
          baseCurrency: companies.baseCurrency,
          financialStateRevision: companies.financialStateRevision,
          role: companyMembers.role,
        })
        .from(companyMembers)
        .innerJoin(companies, eq(companies.id, companyMembers.companyId))
        .where(eq(companyMembers.userId, userRow.id))
        .orderBy(asc(companyMembers.createdAt))
        .limit(1);

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

  return { provisionIdentity, findUser, findCompanyForUser };
}
