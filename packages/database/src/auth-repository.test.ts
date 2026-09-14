import type { AuthIdentity } from "@finance/auth";
import { config } from "dotenv";
import { and, asc, eq, inArray } from "drizzle-orm";
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

  /**
   * Membership is installation-wide, so a test database shared with other runs
   * always holds companies these cases did not create. Every assertion below is
   * therefore about the companies the case made, and cleanup tracks exactly the
   * companies a call created rather than everything the user can reach.
   */
  async function companyIdsByAge() {
    const rows = await database
      .select({ id: companies.id })
      .from(companies)
      .orderBy(asc(companies.createdAt), asc(companies.id));
    return rows.map((row) => row.id);
  }

  async function trackCompaniesCreatedBy<T>(body: () => Promise<T>) {
    const before = new Set(await companyIdsByAge());
    const result = await body();
    const created = (await companyIdsByAge()).filter((id) => !before.has(id));
    createdCompanyIds.push(...created);
    return { result, created };
  }

  async function namesOf(companyIds: string[]) {
    if (companyIds.length === 0) return [];
    const rows = await database
      .select({ id: companies.id, name: companies.name, baseCurrency: companies.baseCurrency })
      .from(companies)
      .where(inArray(companies.id, companyIds));
    const byId = new Map(rows.map((row) => [row.id, row]));
    return companyIds.map((id) => [byId.get(id)?.name, byId.get(id)?.baseCurrency]);
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
    expect(members).toContainEqual(expect.objectContaining({ companyId: company.id, userId: owner.id, role: "owner" }));

    // A new company is empty: nothing is carried over from the user's other companies.
    const carriedSources = await database.select({ id: sources.id }).from(sources).where(eq(sources.companyId, company.id));
    const carriedEvidence = await database.select({ id: evidence.id }).from(evidence).where(eq(evidence.companyId, company.id));
    const carriedEntries = await database.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.companyId, company.id));
    expect([carriedSources.length, carriedEvidence.length, carriedEntries.length]).toEqual([0, 0, 0]);
  });

  it("gives every user on the installation a membership in a new company", async () => {
    const creator = await createUser("shared-creator");
    const bystander = await createUser("shared-bystander");

    const company = await createCompany(creator.id, "Shared Creation");

    const members = await database.select().from(companyMembers).where(eq(companyMembers.companyId, company.id));
    const roles = new Map(members.map((member) => [member.userId, member.role]));
    expect(roles.get(creator.id)).toBe("owner");
    // The creator is not privileged: someone who had nothing to do with the
    // company owns it too, without signing in again.
    expect(roles.get(bystander.id)).toBe("owner");
    expect((await repository.listCompaniesForUser(bystander.id)).map((entry) => entry.id)).toContain(company.id);
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

  it("joins a second identity to every company on the installation, oldest first, and creates none", async () => {
    const established = await createUser("installation-established");
    const alpha = await createCompany(established.id, "Installation Alpha");
    const beta = await createCompany(established.id, "Installation Beta");

    const { result: provisioned, created } = await trackCompaniesCreatedBy(() =>
      withConfiguredCompanies(undefined, () => repository.provisionIdentity(identityFor("installation-second"))),
    );
    createdUserIds.push(provisioned.user.id);

    // A host that already has companies gives a new person all of them and no
    // extra default company of their own.
    expect(created).toEqual([]);

    const listed = await repository.listCompaniesForUser(provisioned.user.id);
    const ids = listed.map((company) => company.id);
    expect(ids).toEqual(expect.arrayContaining([alpha.id, beta.id]));
    expect(listed.every((company) => company.role === "owner")).toBe(true);
    expect(ids.indexOf(alpha.id)).toBeLessThan(ids.indexOf(beta.id));

    // The oldest company on the installation is the default for everyone.
    const [oldest] = await companyIdsByAge();
    expect(ids[0]).toBe(oldest);
    expect(provisioned.company.id).toBe(oldest);
  });

  it("provisions an identity that already has memberships onto the oldest company, creating no other", async () => {
    const user = await createUser("existing-identity");
    const first = await createCompany(user.id, "Existing One");
    const second = await createCompany(user.id, "Existing Two");

    const { result: provisioned, created } = await trackCompaniesCreatedBy(() =>
      withConfiguredCompanies(undefined, () => repository.provisionIdentity(identityFor("existing-identity"))),
    );
    expect(provisioned.user.id).toBe(user.id);
    expect(created).toEqual([]);

    const ids = (await repository.listCompaniesForUser(user.id)).map((company) => company.id);
    expect(ids).toEqual(expect.arrayContaining([first.id, second.id]));
    expect(provisioned.company.id).toBe(ids[0]);
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

  it("creates the configured companies instead of a default one, in listed order", async () => {
    const identity: AuthIdentity = { provider: "disabled", providerUserId: `configured-${run}`, email: `configured-${run}@example.test`, name: "Owner" };

    const { result: provisioned, created } = await trackCompaniesCreatedBy(() =>
      withConfiguredCompanies(`Alpha ${run}:USD,Beta ${run}:eur`, () => repository.provisionIdentity(identity)),
    );
    createdUserIds.push(provisioned.user.id);

    // Exactly the configured companies, in the configured order, and no
    // DEFAULT_COMPANY_NAME one beside them.
    expect(await namesOf(created)).toEqual([
      [`Alpha ${run}`, "USD"],
      [`Beta ${run}`, "EUR"],
    ]);

    const ids = (await repository.listCompaniesForUser(provisioned.user.id)).map((company) => company.id);
    expect(ids.indexOf(created[0] ?? "")).toBeLessThan(ids.indexOf(created[1] ?? ""));
    expect(provisioned.company.id).toBe(ids[0]);
  });

  it("adds only the configured names the installation does not already have", async () => {
    const identity: AuthIdentity = { provider: "disabled", providerUserId: `top-up-${run}`, email: `top-up-${run}@example.test`, name: "Owner" };

    const { result: first } = await trackCompaniesCreatedBy(() =>
      withConfiguredCompanies(`Top Alpha ${run}:USD,Top Beta ${run}:EUR`, () => repository.provisionIdentity(identity)),
    );
    createdUserIds.push(first.user.id);

    const { result: again, created } = await trackCompaniesCreatedBy(() =>
      withConfiguredCompanies(`Top Alpha ${run}:USD,Top Beta ${run}:EUR,Top Gamma ${run}:GBP`, () => repository.provisionIdentity(identity)),
    );
    expect(again.user.id).toBe(first.user.id);
    expect(await namesOf(created)).toEqual([[`Top Gamma ${run}`, "GBP"]]);

    // The default selection is unchanged by a top-up.
    const ids = (await repository.listCompaniesForUser(first.user.id)).map((company) => company.id);
    expect(again.company.id).toBe(ids[0]);
  });

  it("extends a configured company to every user on the installation", async () => {
    const bystander = await createUser("configured-bystander");
    const identity: AuthIdentity = { provider: "disabled", providerUserId: `configured-owner-${run}`, email: `configured-owner-${run}@example.test`, name: "Owner" };

    const { result: provisioned, created } = await trackCompaniesCreatedBy(() =>
      withConfiguredCompanies(`Delta ${run}:USD`, () => repository.provisionIdentity(identity)),
    );
    createdUserIds.push(provisioned.user.id);
    expect(await namesOf(created)).toEqual([[`Delta ${run}`, "USD"]]);

    // The top-up belongs to the installation, not to the owner who triggered it.
    const listed = await repository.listCompaniesForUser(bystander.id);
    expect(listed.map((company) => company.id)).toContain(created[0]);
    expect(listed.find((company) => company.id === created[0])?.role).toBe("owner");
  });

  it("creates no configured company for an identity that is not the installation owner", async () => {
    const identity: AuthIdentity = { provider: "better-auth", providerUserId: `not-owner-${run}`, email: `not-owner-${run}@example.test`, name: "Someone" };

    const { result: provisioned, created } = await trackCompaniesCreatedBy(() =>
      withOwnerEmail(`owner-${run}@example.test`, () =>
        withConfiguredCompanies(`Unconfigured ${run}:USD`, () => repository.provisionIdentity(identity)),
      ),
    );
    createdUserIds.push(provisioned.user.id);

    // Nothing is created for them at all: the companies they open are the ones
    // the installation already has.
    expect(created).toEqual([]);
    expect(await database.select({ id: companies.id }).from(companies).where(eq(companies.name, `Unconfigured ${run}`))).toEqual([]);
    expect((await repository.listCompaniesForUser(provisioned.user.id)).length).toBeGreaterThan(0);
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

    const { result: adopted, created } = await trackCompaniesCreatedBy(() =>
      withOwnerEmail(ownerEmail, () =>
        withConfiguredCompanies(undefined, () =>
          repository.provisionIdentity({ provider: "better-auth", providerUserId: `adopting-${run}`, email: ownerEmail, name: "Owner" }),
        ),
      ),
    );

    expect(adopted.user.id).toBe(localUser.id);
    expect(created).toEqual([]);
    expect((await repository.listCompaniesForUser(localUser.id)).map((company) => company.id)).toContain(existing.id);
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

    const { result: separate } = await trackCompaniesCreatedBy(() =>
      withOwnerEmail(ownerEmail, () =>
        withConfiguredCompanies(undefined, () =>
          repository.provisionIdentity({ provider: "better-auth", providerUserId: `stranger-${run}`, email: `other-local-${run}@example.test`, name: "Other" }),
        ),
      ),
    );
    createdUserIds.push(separate.user.id);
    expect(separate.user.id).not.toBe(otherUser.id);
    const [untouched] = await database.select().from(users).where(eq(users.id, otherUser.id));
    expect(untouched?.authProvider).toBe("disabled");
  });

  it("resolves any company on the installation and refuses an id that names none", async () => {
    const creator = await createUser("resolve-creator");
    const other = await createUser("resolve-other");
    const company = await createCompany(creator.id, "Resolve");

    // Company isolation is what row level security enforces; it is not a wall
    // between the people on one installation, who all own every company.
    expect((await repository.findCompanyForUser(other.id, company.id))?.id).toBe(company.id);
    expect(await repository.findCompanyForUser(other.id, randomUUID())).toBeNull();
  });
});
