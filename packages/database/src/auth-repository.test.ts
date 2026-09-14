import type { AuthIdentity } from "@finance/auth";
import { config } from "dotenv";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabaseAuthRepository } from "./auth-repository";
import * as schema from "./schema";
import { companies, companyMembers, evidence, journalEntries, sources, users } from "./schema";

config({ path: fileURLToPath(new URL("../../../.env.local", import.meta.url)) });
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

// Real Postgres: what is under test is the transaction boundary and the
// membership ordering that decides a user's default company, not the types.
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

describe.skipIf(!connectionString)("createDatabaseAuthRepository", () => {
  const client = postgres(connectionString ?? "", { max: 1, prepare: false });
  const database = drizzle(client, { schema });
  const repository = createDatabaseAuthRepository(database);
  const run = randomUUID();
  const createdUserIds: string[] = [];
  const createdCompanyIds: string[] = [];

  async function createUser(label: string) {
    const [row] = await database
      .insert(users)
      .values({ authProvider: `test-${run}`, authProviderUserId: `${label}-${run}`, email: `${label}-${run}@example.test`, name: label })
      .returning();
    if (!row) throw new Error("Unable to create the test user");
    createdUserIds.push(row.id);
    return row;
  }

  async function createCompany(userId: string, label: string) {
    const company = await repository.createCompanyForUser(userId, { name: `${label} ${run}`, baseCurrency: "USD" });
    createdCompanyIds.push(company.id);
    return company;
  }

  function identityFor(label: string): AuthIdentity {
    return { provider: `test-${run}`, providerUserId: `${label}-${run}`, email: `${label}-${run}@example.test`, name: label };
  }

  /** Membership order is created_at asc; force distinct values so the assertion never depends on clock resolution. */
  async function spreadMembershipTimes(userId: string, companyIds: string[]) {
    const base = Date.now();
    for (const [offset, companyId] of companyIds.entries()) {
      await database
        .update(companyMembers)
        .set({ createdAt: new Date(base + offset * 1000) })
        .where(and(eq(companyMembers.userId, userId), eq(companyMembers.companyId, companyId)));
    }
  }

  afterAll(async () => {
    if (createdCompanyIds.length > 0) await database.delete(companies).where(inArray(companies.id, createdCompanyIds));
    if (createdUserIds.length > 0) await database.delete(users).where(inArray(users.id, createdUserIds));
    await client.end();
  });

  it("creates a company and its owner membership atomically, and copies nothing", async () => {
    const owner = await createUser("atomic-owner");
    const existing = await createCompany(owner.id, "Atomic Existing");
    await database.insert(sources).values({ companyId: existing.id, type: "upload", filename: "prior.csv" });

    const company = await createCompany(owner.id, "Atomic New");
    expect(company).toMatchObject({ name: `Atomic New ${run}`, baseCurrency: "USD", role: "owner" });

    const members = await database.select().from(companyMembers).where(eq(companyMembers.companyId, company.id));
    expect(members).toEqual([expect.objectContaining({ companyId: company.id, userId: owner.id, role: "owner" })]);

    // A new company is empty: nothing is carried over from the user's other companies.
    const carriedSources = await database.select({ id: sources.id }).from(sources).where(eq(sources.companyId, company.id));
    const carriedEvidence = await database.select({ id: evidence.id }).from(evidence).where(eq(evidence.companyId, company.id));
    const carriedEntries = await database.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.companyId, company.id));
    expect([carriedSources.length, carriedEvidence.length, carriedEntries.length]).toEqual([0, 0, 0]);
  });

  it("lists every membership in created order", async () => {
    const user = await createUser("listing-user");
    const first = await createCompany(user.id, "Listing One");
    const second = await createCompany(user.id, "Listing Two");
    const third = await createCompany(user.id, "Listing Three");
    await spreadMembershipTimes(user.id, [first.id, second.id, third.id]);

    const listed = await repository.listCompaniesForUser(user.id);
    expect(listed.map((company) => company.id)).toEqual([first.id, second.id, third.id]);
  });

  it("provisions an identity that already has memberships onto the first company, creating no other", async () => {
    const user = await createUser("existing-identity");
    const first = await createCompany(user.id, "Existing One");
    const second = await createCompany(user.id, "Existing Two");
    await spreadMembershipTimes(user.id, [first.id, second.id]);

    const provisioned = await repository.provisionIdentity(identityFor("existing-identity"));
    expect(provisioned.user.id).toBe(user.id);
    expect(provisioned.company.id).toBe(first.id);
    expect((await repository.listCompaniesForUser(user.id)).map((company) => company.id)).toEqual([first.id, second.id]);
  });

  it("provisions a brand-new identity with exactly one company", async () => {
    const provisioned = await repository.provisionIdentity(identityFor("fresh-identity"));
    createdUserIds.push(provisioned.user.id);
    createdCompanyIds.push(provisioned.company.id);

    const listed = await repository.listCompaniesForUser(provisioned.user.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(provisioned.company.id);
  });

  it("refuses to resolve another user's company", async () => {
    const userA = await createUser("denial-a");
    const userB = await createUser("denial-b");
    const companyA = await createCompany(userA.id, "Denial A");

    expect(await repository.findCompanyForUser(userB.id, companyA.id)).toBeNull();
    expect((await repository.findCompanyForUser(userA.id, companyA.id))?.id).toBe(companyA.id);
  });
});
