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
import { companies, companyMembers, evidence, journalEntries, pendingMembers, sources, users } from "./schema";

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

  /** Configured companies are read from the environment at provisioning time; keep each case's value local to it. */
  async function withConfiguredCompanies<T>(value: string | undefined, body: () => Promise<T>) {
    const previous = process.env.COMPANIES;
    if (value === undefined) delete process.env.COMPANIES;
    else process.env.COMPANIES = value;
    try {
      return await body();
    } finally {
      if (previous === undefined) delete process.env.COMPANIES;
      else process.env.COMPANIES = previous;
    }
  }

  async function withOwnerEmail<T>(value: string, body: () => Promise<T>) {
    const previous = process.env.LOCAL_OWNER_EMAIL;
    process.env.LOCAL_OWNER_EMAIL = value;
    try {
      return await body();
    } finally {
      if (previous === undefined) delete process.env.LOCAL_OWNER_EMAIL;
      else process.env.LOCAL_OWNER_EMAIL = previous;
    }
  }

  /** Track everything a provisioning call created so afterAll can remove it. */
  async function trackProvisioned(userId: string) {
    createdUserIds.push(userId);
    for (const company of await repository.listCompaniesForUser(userId)) createdCompanyIds.push(company.id);
  }

  it("creates the configured companies instead of a default one, in listed order", async () => {
    const identity: AuthIdentity = { provider: "disabled", providerUserId: `configured-${run}`, email: `configured-${run}@example.test`, name: "Owner" };

    const provisioned = await withConfiguredCompanies(`Alpha ${run}:USD,Beta ${run}:eur`, () =>
      repository.provisionIdentity(identity),
    );
    await trackProvisioned(provisioned.user.id);

    const listed = await repository.listCompaniesForUser(provisioned.user.id);
    expect(listed.map((company) => [company.name, company.baseCurrency])).toEqual([
      [`Alpha ${run}`, "USD"],
      [`Beta ${run}`, "EUR"],
    ]);
    expect(provisioned.company.id).toBe(listed[0]?.id);
  });

  it("adds only the configured names the owner does not already have", async () => {
    const identity: AuthIdentity = { provider: "disabled", providerUserId: `top-up-${run}`, email: `top-up-${run}@example.test`, name: "Owner" };

    const first = await withConfiguredCompanies(`Alpha ${run}:USD,Beta ${run}:EUR`, () =>
      repository.provisionIdentity(identity),
    );
    await trackProvisioned(first.user.id);

    const again = await withConfiguredCompanies(`Alpha ${run}:USD,Beta ${run}:EUR,Gamma ${run}:GBP`, () =>
      repository.provisionIdentity(identity),
    );
    expect(again.user.id).toBe(first.user.id);

    const listed = await repository.listCompaniesForUser(first.user.id);
    for (const company of listed) if (!createdCompanyIds.includes(company.id)) createdCompanyIds.push(company.id);
    expect(listed.map((company) => [company.name, company.baseCurrency])).toEqual([
      [`Alpha ${run}`, "USD"],
      [`Beta ${run}`, "EUR"],
      [`Gamma ${run}`, "GBP"],
    ]);
    // The default selection is unchanged by a top-up.
    expect(again.company.id).toBe(listed[0]?.id);
  });

  it("gives a non-owner identity one default company and none of the configured ones", async () => {
    const identity: AuthIdentity = { provider: "better-auth", providerUserId: `not-owner-${run}`, email: `not-owner-${run}@example.test`, name: "Someone" };

    const provisioned = await withOwnerEmail(`owner-${run}@example.test`, () =>
      withConfiguredCompanies(`Alpha ${run}:USD,Beta ${run}:EUR`, () => repository.provisionIdentity(identity)),
    );
    await trackProvisioned(provisioned.user.id);

    const listed = await repository.listCompaniesForUser(provisioned.user.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).not.toMatch(new RegExp(run));
  });

  it("adopts the local owner's user for a Better Auth identity with the configured email, and no other", async () => {
    const ownerEmail = `adopted-owner-${run}@example.test`;
    const local = await database
      .insert(users)
      .values({ authProvider: "disabled", authProviderUserId: `local-owner-${run}`, email: ownerEmail, name: "Owner" })
      .returning();
    const localUser = local[0];
    if (!localUser) throw new Error("Unable to create the local owner");
    createdUserIds.push(localUser.id);
    const existing = await createCompany(localUser.id, "Adopted");

    const adopted = await withOwnerEmail(ownerEmail, () =>
      withConfiguredCompanies(undefined, () =>
        repository.provisionIdentity({ provider: "better-auth", providerUserId: `adopting-${run}`, email: ownerEmail, name: "Owner" }),
      ),
    );

    expect(adopted.user.id).toBe(localUser.id);
    expect(adopted.company.id).toBe(existing.id);
    const [reloaded] = await database.select().from(users).where(eq(users.id, localUser.id));
    expect(reloaded).toMatchObject({ authProvider: "better-auth", authProviderUserId: `adopting-${run}`, email: ownerEmail });

    // A second disabled user with a different address is untouched by the same setting.
    const other = await database
      .insert(users)
      .values({ authProvider: "disabled", authProviderUserId: `other-local-${run}`, email: `other-local-${run}@example.test`, name: "Other" })
      .returning();
    const otherUser = other[0];
    if (!otherUser) throw new Error("Unable to create the second local user");
    createdUserIds.push(otherUser.id);

    const separate = await withOwnerEmail(ownerEmail, () =>
      withConfiguredCompanies(undefined, () =>
        repository.provisionIdentity({ provider: "better-auth", providerUserId: `stranger-${run}`, email: `other-local-${run}@example.test`, name: "Other" }),
      ),
    );
    await trackProvisioned(separate.user.id);
    expect(separate.user.id).not.toBe(otherUser.id);
    const [untouched] = await database.select().from(users).where(eq(users.id, otherUser.id));
    expect(untouched?.authProvider).toBe("disabled");
  });

  it("attaches a pending membership on first provisioning instead of creating a default company", async () => {
    const owner = await createUser("inviting-owner");
    const company = await createCompany(owner.id, "Inviting");
    const invitedEmail = `invited-${run}@example.test`;
    await database.insert(pendingMembers).values({ companyId: company.id, email: invitedEmail, role: "member", addedByUserId: owner.id });

    const provisioned = await withConfiguredCompanies(undefined, () =>
      repository.provisionIdentity({ provider: `test-${run}`, providerUserId: `invited-${run}`, email: invitedEmail, name: "Invited" }),
    );
    await trackProvisioned(provisioned.user.id);

    // The invited person lands in the company that added them, and nothing else.
    expect(provisioned.company.id).toBe(company.id);
    expect(provisioned.company.role).toBe("member");
    expect((await repository.listCompaniesForUser(provisioned.user.id)).map((entry) => entry.id)).toEqual([company.id]);

    // The pending row is consumed, so a second sign-in changes nothing.
    expect(await database.select().from(pendingMembers).where(eq(pendingMembers.companyId, company.id))).toEqual([]);
    const again = await repository.provisionIdentity({ provider: `test-${run}`, providerUserId: `invited-${run}`, email: invitedEmail, name: "Invited" });
    expect(again.company.id).toBe(company.id);
    expect((await repository.listCompaniesForUser(provisioned.user.id))).toHaveLength(1);
  });

  it("matches a pending address case-insensitively and leaves an existing membership's role alone", async () => {
    const owner = await createUser("case-owner");
    const first = await createCompany(owner.id, "Case First");
    const second = await createCompany(owner.id, "Case Second");
    const memberEmail = `Case-Member-${run}@Example.test`;

    // The member already owns `second`; a later pending row for the same
    // company must not downgrade that.
    const [existing] = await database
      .insert(users)
      .values({ authProvider: `test-${run}`, authProviderUserId: `case-member-${run}`, email: memberEmail, name: "Case" })
      .returning();
    if (!existing) throw new Error("Unable to create the test user");
    createdUserIds.push(existing.id);
    await database.insert(companyMembers).values({ companyId: second.id, userId: existing.id, role: "owner" });
    await database.insert(pendingMembers).values([
      { companyId: first.id, email: memberEmail.toLocaleLowerCase(), role: "member", addedByUserId: owner.id },
      { companyId: second.id, email: memberEmail.toLocaleLowerCase(), role: "member", addedByUserId: owner.id },
    ]);

    await repository.provisionIdentity({ provider: `test-${run}`, providerUserId: `case-member-${run}`, email: memberEmail, name: "Case" });

    const listed = await repository.listCompaniesForUser(existing.id);
    expect(new Map(listed.map((entry) => [entry.id, entry.role]))).toEqual(
      new Map([
        [first.id, "member"],
        [second.id, "owner"],
      ]),
    );
  });

  it("refuses to resolve another user's company", async () => {
    const userA = await createUser("denial-a");
    const userB = await createUser("denial-b");
    const companyA = await createCompany(userA.id, "Denial A");

    expect(await repository.findCompanyForUser(userB.id, companyA.id)).toBeNull();
    expect((await repository.findCompanyForUser(userA.id, companyA.id))?.id).toBe(companyA.id);
  });
});
