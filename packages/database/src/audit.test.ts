import { config } from "dotenv";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { listAuditEntries, recordAudit } from "./audit";
import { createDatabaseAuthRepository } from "./auth-repository";
import * as schema from "./schema";
import { auditLog, companies, users } from "./schema";

config({ path: fileURLToPath(new URL("../../../.env.local", import.meta.url)) });
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

// Real Postgres: what is under test is the company scoping of the history and
// the actor join, neither of which a fake executor would prove.
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

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
      action: "company.settings_changed",
      entityType: "company",
      entityId: company.id,
      summary: "Renamed the company",
      after: { name: `Audit ${run}` },
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
    expect(entries.map((entry) => entry.action)).toEqual(["period.closed", "company.settings_changed"]);
    expect(entries[0]).toMatchObject({ via: "worker", actorUserId: null, actorEmail: null, actorName: null });
    expect(entries[1]).toMatchObject({
      companyId: company.id,
      actorUserId: actor.id,
      actorEmail: `audit-${run}@example.test`,
      actorName: "Auditor",
      via: "ui",
      entityType: "company",
      entityId: company.id,
      after: { name: `Audit ${run}` },
      requestId: `request-${run}`,
    });

    // The other company's entry is not in this company's history.
    expect(await listAuditEntries(database, other.id, 10)).toHaveLength(1);
  });
});
