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
  return { id: row.id, email: row.email, name: row.name };
}

function defaultCompanyName(identity: AuthIdentity) {
  if (process.env.DEFAULT_COMPANY_NAME) return process.env.DEFAULT_COMPANY_NAME;
  if (identity.name) return `${identity.name}'s Company`;
  return "My Management Company";
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

      const [userRow] = await transaction
        .insert(users)
        .values({
          authProvider: identity.provider,
          authProviderUserId: identity.providerUserId,
          email: identity.email,
          name: identity.name,
        })
        .onConflictDoUpdate({
          target: [users.authProvider, users.authProviderUserId],
          set: {
            email: identity.email,
            name: identity.name,
            updatedAt: new Date(),
          },
        })
        .returning();

      if (!userRow) throw new Error("Unable to provision application user");

      const [membership] = await transaction
        .select({
          id: companies.id,
          name: companies.name,
          baseCurrency: companies.baseCurrency,
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
          role: "owner",
        },
      };
    });
  }

  return { provisionIdentity, findUser, findCompanyForUser };
}
