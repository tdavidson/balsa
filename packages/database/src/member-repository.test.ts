import { LastOwnerError } from "@finance/auth";
import { config } from "dotenv";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { listAuditEntries, recordAudit } from "./audit";
import { createDatabaseAuthRepository } from "./auth-repository";
import { createDatabaseMemberRepository } from "./member-repository";
import * as schema from "./schema";
import { auditLog, companies, companyMembers, pendingMembers, users } from "./schema";

config({ path: fileURLToPath(new URL("../../../.env.local", import.meta.url)) });
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

// Real Postgres: what is under test is the last-owner guard's locking, the
// unique constraints behind the pending upsert, and the audit join.
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

describe.skipIf(!connectionString)("createDatabaseMemberRepository", () => {
  const client = postgres(connectionString ?? "", { max: 1, prepare: false });
  const database = drizzle(client, { schema });
  const authRepository = createDatabaseAuthRepository(database);
  const repository = createDatabaseMemberRepository(database);
  const run = randomUUID();
  const createdUserIds: string[] = [];
  const createdCompanyIds: string[] = [];

  function emailFor(label: string) {
    return `${label}-${run}@example.test`;
  }

  async function createUser(label: string) {
    const [row] = await database
      .insert(users)
      .values({ authProvider: `test-${run}`, authProviderUserId: `${label}-${run}`, email: emailFor(label), name: label })
      .returning();
    if (!row) throw new Error("Unable to create the test user");
    createdUserIds.push(row.id);
    return row;
  }

  async function createCompany(userId: string, label: string) {
    const company = await authRepository.createCompanyForUser(userId, { name: `${label} ${run}`, baseCurrency: "USD" });
    createdCompanyIds.push(company.id);
    return company;
  }

  afterAll(async () => {
    // Companies cascade to memberships, pending rows, and audit entries.
    if (createdCompanyIds.length > 0) await database.delete(companies).where(inArray(companies.id, createdCompanyIds));
    if (createdUserIds.length > 0) await database.delete(users).where(inArray(users.id, createdUserIds));
    await client.end();
  });

  it("adds an existing user's address as a membership immediately", async () => {
    const owner = await createUser("add-owner");
    const invited = await createUser("add-invited");
    const company = await createCompany(owner.id, "Add Existing");

    const result = await repository.addMember(company.id, { email: emailFor("add-invited").toUpperCase(), role: "member" }, owner.id);
    expect(result.status).toBe("active");
    if (result.status !== "active") throw new Error("unreachable");
    expect(result.member).toMatchObject({ userId: invited.id, email: emailFor("add-invited"), role: "member" });

    const listed = await repository.listMembers(company.id);
    expect(listed.pending).toEqual([]);
    expect(listed.members.map((member) => [member.userId, member.role])).toEqual([
      [owner.id, "owner"],
      [invited.id, "member"],
    ]);

    // Adding the same person again reports the membership they already have.
    const again = await repository.addMember(company.id, { email: emailFor("add-invited"), role: "owner" }, owner.id);
    expect(again).toMatchObject({ status: "active", member: { userId: invited.id, role: "member" } });
    expect((await repository.listMembers(company.id)).members).toHaveLength(2);
  });

  it("holds an unknown address as pending and updates its role on a second add", async () => {
    const owner = await createUser("pending-owner");
    const company = await createCompany(owner.id, "Pending Hold");
    const address = emailFor("pending-stranger");

    const first = await repository.addMember(company.id, { email: ` ${address.toUpperCase()} `, role: "member" }, owner.id);
    expect(first).toMatchObject({ status: "pending", pending: { email: address, role: "member" } });

    const second = await repository.addMember(company.id, { email: address, role: "owner" }, owner.id);
    expect(second).toMatchObject({ status: "pending", pending: { email: address, role: "owner" } });

    const listed = await repository.listMembers(company.id);
    expect(listed.pending.map((pending) => [pending.email, pending.role])).toEqual([[address, "owner"]]);
    if (!listed.pending[0]) throw new Error("the pending row is missing");

    await repository.removePendingMember(company.id, listed.pending[0].id);
    expect((await repository.listMembers(company.id)).pending).toEqual([]);
  });

  it("keeps the last owner: neither demotion nor removal is allowed", async () => {
    const owner = await createUser("solo-owner");
    const company = await createCompany(owner.id, "Solo Owner");

    await expect(repository.updateMemberRole(company.id, owner.id, "member")).rejects.toBeInstanceOf(LastOwnerError);
    await expect(repository.removeMember(company.id, owner.id)).rejects.toBeInstanceOf(LastOwnerError);

    const listed = await repository.listMembers(company.id);
    expect(listed.members.map((member) => member.role)).toEqual(["owner"]);
  });

  it("demotes and removes a second owner while one remains", async () => {
    const owner = await createUser("pair-owner");
    const other = await createUser("pair-other");
    const company = await createCompany(owner.id, "Owner Pair");
    await repository.addMember(company.id, { email: emailFor("pair-other"), role: "owner" }, owner.id);

    const demoted = await repository.updateMemberRole(company.id, other.id, "member");
    expect(demoted).toMatchObject({ userId: other.id, role: "member" });

    // With one owner left, the remaining owner is protected again.
    await expect(repository.updateMemberRole(company.id, owner.id, "member")).rejects.toBeInstanceOf(LastOwnerError);

    await repository.removeMember(company.id, other.id);
    expect((await repository.listMembers(company.id)).members.map((member) => member.userId)).toEqual([owner.id]);
    const remaining = await database.select().from(companyMembers).where(eq(companyMembers.companyId, company.id));
    expect(remaining).toHaveLength(1);
  });

  // The `within` callback is what the members route uses to write its audit row;
  // these two tests are the guarantee it relies on, in both directions.
  it("rolls the membership back when the transactional callback throws", async () => {
    const owner = await createUser("within-owner");
    const invited = await createUser("within-invited");
    const company = await createCompany(owner.id, "Within Rollback");

    await expect(
      repository.addMember(company.id, { email: emailFor("within-invited"), role: "member" }, owner.id, async () => {
        throw new Error("the audit row could not be written");
      }),
    ).rejects.toThrow("the audit row could not be written");

    const listed = await repository.listMembers(company.id);
    expect(listed.members.map((member) => member.userId)).toEqual([owner.id]);
    expect(listed.members.some((member) => member.userId === invited.id)).toBe(false);
  });

  it("commits the audit row the callback writes together with the add", async () => {
    const owner = await createUser("within-audit-owner");
    const invited = await createUser("within-audit-invited");
    const company = await createCompany(owner.id, "Within Audit");

    const result = await repository.addMember(
      company.id,
      { email: emailFor("within-audit-invited"), role: "member" },
      owner.id,
      (transaction, added) =>
        recordAudit(transaction, {
          companyId: company.id,
          actorUserId: owner.id,
          via: "ui",
          action: "member.added",
          entityType: "member",
          entityId: added.status === "active" ? added.member.userId : undefined,
          summary: `Added ${emailFor("within-audit-invited")} as member`,
        }),
    );
    expect(result.status).toBe("active");

    const entries = await listAuditEntries(database, company.id, 10);
    expect(entries.filter((entry) => entry.action === "member.added")).toMatchObject([
      { companyId: company.id, actorUserId: owner.id, entityType: "member", entityId: invited.id },
    ]);
  });

  it("never removes a pending row belonging to another company", async () => {
    const owner = await createUser("scope-owner");
    const mine = await createCompany(owner.id, "Scope Mine");
    const theirs = await createCompany(owner.id, "Scope Theirs");

    const added = await repository.addMember(theirs.id, { email: emailFor("scope-stranger"), role: "member" }, owner.id);
    if (added.status !== "pending") throw new Error("expected a pending member");

    await repository.removePendingMember(mine.id, added.pending.id);
    const rows = await database.select().from(pendingMembers).where(eq(pendingMembers.companyId, theirs.id));
    expect(rows).toHaveLength(1);
  });
});

describe.skipIf(!connectionString)("audit log", () => {
  const client = postgres(connectionString ?? "", { max: 1, prepare: false });
  const database = drizzle(client, { schema });
  const authRepository = createDatabaseAuthRepository(database);
  const run = randomUUID();
  const createdUserIds: string[] = [];
  const createdCompanyIds: string[] = [];

  afterAll(async () => {
    if (createdCompanyIds.length > 0) await database.delete(companies).where(inArray(companies.id, createdCompanyIds));
    if (createdUserIds.length > 0) await database.delete(users).where(inArray(users.id, createdUserIds));
    await client.end();
  });

  it("records entries with their company and actor, and lists them newest first", async () => {
    const [actor] = await database
      .insert(users)
      .values({ authProvider: `test-${run}`, authProviderUserId: `audit-${run}`, email: `audit-${run}@example.test`, name: "Auditor" })
      .returning();
    if (!actor) throw new Error("Unable to create the test user");
    createdUserIds.push(actor.id);

    const company = await authRepository.createCompanyForUser(actor.id, { name: `Audit ${run}`, baseCurrency: "USD" });
    const other = await authRepository.createCompanyForUser(actor.id, { name: `Audit Other ${run}`, baseCurrency: "USD" });
    createdCompanyIds.push(company.id, other.id);

    await recordAudit(database, {
      companyId: company.id,
      actorUserId: actor.id,
      via: "ui",
      action: "member.added",
      entityType: "company_member",
      entityId: actor.id,
      summary: "Added a member",
      after: { role: "member" },
      requestId: `request-${run}`,
    });
    await recordAudit(database, {
      companyId: company.id,
      actorUserId: null,
      via: "worker",
      action: "period.closed",
      summary: "Closed a period",
    });
    await recordAudit(database, { companyId: other.id, actorUserId: actor.id, via: "ui", action: "company.created", summary: "Other company" });

    // Entries written outside one transaction still tie on the clock's
    // resolution; stamp them so the ordering assertion is about the query.
    const base = Date.now();
    const written = await database.select({ id: auditLog.id, action: auditLog.action }).from(auditLog).where(eq(auditLog.companyId, company.id));
    for (const [offset, entry] of written.sort((a, b) => a.action.localeCompare(b.action)).entries()) {
      await database.update(auditLog).set({ createdAt: new Date(base + offset * 1000) }).where(eq(auditLog.id, entry.id));
    }

    const entries = await listAuditEntries(database, company.id, 10);
    expect(entries.map((entry) => entry.action)).toEqual(["period.closed", "member.added"]);
    expect(entries[0]).toMatchObject({ via: "worker", actorUserId: null, actorEmail: null, actorName: null });
    expect(entries[1]).toMatchObject({
      companyId: company.id,
      actorUserId: actor.id,
      actorEmail: `audit-${run}@example.test`,
      actorName: "Auditor",
      via: "ui",
      entityType: "company_member",
      entityId: actor.id,
      after: { role: "member" },
      requestId: `request-${run}`,
    });

    // The other company's entry is not in this company's history.
    expect(await listAuditEntries(database, other.id, 10)).toHaveLength(1);
  });
});
