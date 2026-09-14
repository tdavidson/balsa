import { config } from "dotenv";
import { inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readCompanyScope, withCompanyTransaction } from "./company-scope";
import type { Database } from "./index";
import * as schema from "./schema";
import { companies, sources } from "./schema";

config({ path: fileURLToPath(new URL("../../../.env.local", import.meta.url)) });
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const appRole = "nevermodel_app_test";
const appRolePassword = randomUUID();

describe.skipIf(!connectionString)("withCompanyTransaction", () => {
  const client = postgres(connectionString ?? "", { max: 1, prepare: false });
  const database = drizzle(client, { schema });
  const run = randomUUID();
  const createdCompanyIds: string[] = [];
  let companyAId = "";
  let companyBId = "";
  // Row level security never applies to a superuser, so enforcement can only be
  // proven through a separate, unprivileged role.
  let appClient: ReturnType<typeof postgres> | undefined;
  let appDatabase: Database | undefined;
  let unavailable = "";

  async function createCompany(label: string) {
    const [row] = await database.insert(companies).values({ name: `${label} ${run}` }).returning();
    if (!row) throw new Error("Unable to create the test company");
    createdCompanyIds.push(row.id);
    await database.insert(sources).values({ companyId: row.id, type: "upload", filename: `${label}.csv` });
    return row.id;
  }

  beforeAll(async () => {
    companyAId = await createCompany("Scope A");
    companyBId = await createCompany("Scope B");

    const privileges = (await database.execute(
      sql`select rolsuper, rolcreaterole from pg_roles where rolname = current_user`,
    )) as unknown as Array<{ rolsuper: boolean; rolcreaterole: boolean }>;
    if (!privileges[0]?.rolsuper && !privileges[0]?.rolcreaterole) {
      unavailable = `${connectionString?.split("@").pop() ?? "the database"}: the connected role has neither SUPERUSER nor CREATEROLE, so the unprivileged ${appRole} role cannot be created`;
      return;
    }

    // The role is a per-run fixture with a fresh random password, dropped in
    // afterAll, so no test run leaves a known login behind on a shared database.
    // A DO block takes no bind parameters, so the constant name and the
    // generated password are inlined.
    await database.execute(
      sql.raw(`do $$ begin if exists (select 1 from pg_roles where rolname = '${appRole}') then alter role "${appRole}" password '${appRolePassword}'; else create role "${appRole}" login password '${appRolePassword}'; end if; end $$`),
    );
    await database.execute(sql.raw(`grant usage on schema public to "${appRole}"`));
    await database.execute(sql.raw(`grant all privileges on all tables in schema public to "${appRole}"`));
    await database.execute(sql.raw(`grant all privileges on all sequences in schema public to "${appRole}"`));

    const url = new URL(connectionString ?? "");
    url.username = appRole;
    url.password = appRolePassword;
    appClient = postgres(url.toString(), { max: 1, prepare: false });
    appDatabase = drizzle(appClient, { schema });
  });

  afterAll(async () => {
    if (appClient) await appClient.end();
    if (createdCompanyIds.length > 0) await database.delete(companies).where(inArray(companies.id, createdCompanyIds));
    if (appDatabase) {
      // Grants in another database can block the drop; the password was
      // already rotated to a random value, so the role is then still unusable.
      await database.execute(sql.raw(`drop owned by "${appRole}"`)).catch(() => undefined);
      await database.execute(sql.raw(`drop role if exists "${appRole}"`)).catch(() => undefined);
    }
    await client.end();
  });

  it("reports no scope outside a scoped transaction", async () => {
    expect(await readCompanyScope(database)).toBeNull();
  });

  it("hides other companies from an unprivileged role inside the scope", async (context) => {
    if (!appDatabase) { context.skip(`skipped: ${unavailable}`); return; }
    const rows = await withCompanyTransaction(appDatabase, companyAId, async (transaction) => {
      expect(await readCompanyScope(transaction)).toBe(companyAId);
      return transaction.select().from(sources);
    });
    expect(rows).toHaveLength(1);
    expect(rows.map((row) => row.companyId)).toEqual([companyAId]);
  });

  it("rejects a write that names another company inside the scope", async (context) => {
    if (!appDatabase) { context.skip(`skipped: ${unavailable}`); return; }
    const rejection = await withCompanyTransaction(appDatabase, companyAId, async (transaction) => {
      await transaction.insert(sources).values({ companyId: companyBId, type: "upload", filename: "smuggled.csv" });
    }).then(() => null, (reason: unknown) => reason);
    // drizzle wraps the driver error, so the policy violation is on the cause.
    expect(String((rejection as { cause?: unknown } | null)?.cause ?? rejection)).toMatch(/row-level security/i);
    const smuggled = await database.select({ id: sources.id }).from(sources).where(inArray(sources.companyId, [companyBId]));
    expect(smuggled).toHaveLength(1);
  });

  it("stays permissive for the same role when no scope is set", async (context) => {
    if (!appDatabase) { context.skip(`skipped: ${unavailable}`); return; }
    const rows = await appDatabase.select({ companyId: sources.companyId }).from(sources).where(inArray(sources.companyId, [companyAId, companyBId]));
    expect(rows.map((row) => row.companyId).sort()).toEqual([companyAId, companyBId].sort());
  });
});
