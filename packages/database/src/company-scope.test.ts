import { config } from "dotenv";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readCompanyScope, withCompanyTransaction } from "./company-scope";
import type { Database } from "./index";
import * as schema from "./schema";
import { chartAccounts, reportCategories, forecastMetricActuals, forecastMetrics, seasonalityProfiles, financialWorkReviews, financialReviewTasks, financialReviewSignoffs, recognitionJournalLinks, economicItems, journalEntries, journalBatches, users, financialImportReviews, financialReviewPreferences, cashGoalVersions, companies, financialReviewSnapshots, goalDecisionReviews, forecastOccurrences, forecastRecurrencePolicies, forecastReviewCommands, sources } from "./schema";

config({ path: fileURLToPath(new URL("../../../.env.local", import.meta.url)) });
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const appRole = "balsa_app_test";
const appRolePassword = randomUUID();

describe.skipIf(!connectionString)("withCompanyTransaction", () => {
  const client = postgres(connectionString ?? "", { max: 1, prepare: false });
  const database = drizzle(client, { schema });
  const run = randomUUID();
  const createdCompanyIds: string[] = [];
  const createdUserIds: string[] = [];
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
    if (createdUserIds.length) await database.delete(users).where(inArray(users.id, createdUserIds));
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

  it("enforces the goal and review policies through the unprivileged role", async (context) => {
    if (!appDatabase) { context.skip(`skipped: ${unavailable}`); return; }
    for (const companyId of [companyAId, companyBId]) {
      const [goal] = await database.insert(cashGoalVersions).values({ companyId, goalId: randomUUID(), version: 1, definition: { synthetic: true }, reason: "RLS fixture" }).returning();
      await database.insert(financialReviewPreferences).values({ companyId, primaryGoalVersionId: goal!.id });
      const [source] = await database.insert(sources).values({ companyId, type: "synthetic" }).returning();
      await database.insert(financialImportReviews).values({ companyId, sourceId: source!.id, kind: "evaluation", name: "Synthetic RLS import", reason: "Synthetic fixture", requestKey: randomUUID(), requestHash: "synthetic", snapshot: {} });
      const [plan] = await database.insert(financialReviewSnapshots).values({ companyId, goalVersionId: goal!.id, kind: "plan", name: "RLS synthetic plan", requestKey: randomUUID(), requestHash: "synthetic", snapshot: {} }).returning();
      await database.insert(goalDecisionReviews).values({ companyId, goalVersionId: goal!.id, planId: plan!.id, scenarioId: randomUUID(), kind: "evaluation", name: "RLS decision", requestKey: randomUUID(), requestHash: "synthetic", previewToken: "synthetic", snapshot: {} });
    }
    await withCompanyTransaction(appDatabase, companyAId, async (tx) => {
      expect((await tx.select().from(financialReviewPreferences)).map((row) => row.companyId)).toEqual([companyAId]);
      expect((await tx.select().from(financialImportReviews)).map((row) => row.companyId)).toEqual([companyAId]);
      expect((await tx.select().from(cashGoalVersions)).map((row) => row.companyId)).toEqual([companyAId]);
      expect((await tx.select().from(financialReviewSnapshots)).map((row) => row.companyId)).toEqual([companyAId]);
      expect((await tx.select().from(goalDecisionReviews)).map((row) => row.companyId)).toEqual([companyAId]);
    });
    const rejection = await withCompanyTransaction(appDatabase, companyAId, (tx) => tx.insert(cashGoalVersions).values({ companyId: companyBId, goalId: randomUUID(), version: 1, definition: {}, reason: "Wrong company" })).then(() => null, (reason: unknown) => reason);
    expect(String((rejection as { cause?: unknown } | null)?.cause ?? rejection)).toMatch(/row-level security/i);
  });

  it("isolates preserved expectations and idempotent review receipts", async (context) => {
    if (!appDatabase) { context.skip(`skipped: ${unavailable}`); return; }
    for (const companyId of [companyAId, companyBId]) {
      await database.insert(forecastRecurrencePolicies).values({ companyId, driverId: randomUUID(), status: "active", startMonth: "2026-09", endMonth: "2027-08", definition: { synthetic: true }, definitionHash: "synthetic" });
      await database.insert(forecastOccurrences).values({ companyId, occurrenceKey: "synthetic-rls", definition: { synthetic: true } });
      await database.insert(forecastReviewCommands).values({ companyId, requestKey: randomUUID(), requestHash: "synthetic", result: {} });
    }
    await withCompanyTransaction(appDatabase, companyAId, async (tx) => {
      expect((await tx.select().from(forecastRecurrencePolicies)).map((row) => row.companyId)).toEqual([companyAId]);
      expect((await tx.select().from(forecastOccurrences)).map((row) => row.companyId)).toEqual([companyAId]);
      expect((await tx.select().from(forecastReviewCommands)).map((row) => row.companyId)).toEqual([companyAId]);
    });
    const recurrenceRejection = await withCompanyTransaction(appDatabase, companyAId, (tx) => tx.insert(forecastRecurrencePolicies).values({ companyId: companyBId, driverId: randomUUID(), status: "active", startMonth: "2026-09", endMonth: "2027-08", definition: {}, definitionHash: "foreign" })).then(() => null, (reason: unknown) => reason);
    expect(recurrenceRejection).not.toBeNull();
    const rejection = await withCompanyTransaction(appDatabase, companyAId, (tx) => tx.insert(forecastOccurrences).values({ companyId: companyBId, occurrenceKey: "wrong-company", definition: {} })).then(() => null, (reason: unknown) => reason);
    expect(String((rejection as { cause?: unknown } | null)?.cause ?? rejection)).toMatch(/row-level security/i);
  });
  it("isolates recognition links, review ownership, tasks and immutable sign-offs", async (context) => {
    if (!appDatabase) { context.skip(`skipped: ${unavailable}`); return; }
    const [person] = await database.insert(users).values({ authProvider: "fixture", authProviderUserId: randomUUID(), email: `${randomUUID()}@example.invalid` }).returning(); createdUserIds.push(person!.id);
    for (const companyId of [companyAId, companyBId]) {
      const [driver] = await database.insert(economicItems).values({ companyId, label: "Synthetic recognition", type: "obligation", direction: "spend" }).returning();
      const [batch] = await database.insert(journalBatches).values({ companyId, label: "Synthetic RLS", source: "synthetic", idempotencyKey: randomUUID() }).returning();
      const [entry] = await database.insert(journalEntries).values({ companyId, batchId: batch!.id, postingDate: "2026-09-01", period: "2026-09", memo: "Synthetic RLS", status: "draft" }).returning();
      await database.insert(recognitionJournalLinks).values({ companyId, driverId: driver!.id, entryId: entry!.id, sourceHash: "synthetic", reason: "RLS fixture" });
      const [review] = await database.insert(financialWorkReviews).values({ companyId, name: "Synthetic RLS review", kind: "cycle", scope: {}, snapshot: {}, snapshotHash: "synthetic", preparerUserId: person!.id, requestKey: randomUUID() }).returning();
      await database.insert(financialReviewTasks).values({ companyId, reviewId: review!.id, title: "Synthetic task", subjectKey: "synthetic" });
      await database.insert(financialReviewSignoffs).values({ companyId, reviewId: review!.id, reviewerUserId: person!.id, snapshotHash: "synthetic", reason: "Synthetic RLS fixture", selfReview: true, snapshot: {} });
    }
    await withCompanyTransaction(appDatabase, companyAId, async (tx) => {
      expect((await tx.select().from(recognitionJournalLinks)).map((row) => row.companyId)).toEqual([companyAId]);
      expect((await tx.select().from(financialWorkReviews)).map((row) => row.companyId)).toEqual([companyAId]);
      expect((await tx.select().from(financialReviewTasks)).map((row) => row.companyId)).toEqual([companyAId]);
      expect((await tx.select().from(financialReviewSignoffs)).map((row) => row.companyId)).toEqual([companyAId]);
    });
    const rejection = await withCompanyTransaction(appDatabase, companyAId, (tx) => tx.insert(financialWorkReviews).values({ companyId: companyBId, name: "Foreign", kind: "cycle", scope: {}, snapshot: {}, snapshotHash: "synthetic", preparerUserId: person!.id, requestKey: randomUUID() })).then(() => null, (reason: unknown) => reason);
    expect(String((rejection as { cause?: unknown } | null)?.cause ?? rejection)).toMatch(/row-level security/i);
  });

  it("isolates report categories and keeps an account's category in its own company", async (context) => {
    if (!appDatabase) { context.skip(`skipped: ${unavailable}`); return; }
    const categoryIds: Record<string, string> = {};
    for (const companyId of [companyAId, companyBId]) {
      const [category] = await database.insert(reportCategories).values({ companyId, line: "revenue", name: "Subscriptions" }).returning();
      categoryIds[companyId] = category!.id;
    }
    await withCompanyTransaction(appDatabase, companyAId, async (tx) => {
      expect((await tx.select().from(reportCategories)).map((row) => row.companyId)).toEqual([companyAId]);
    });
    const rejection = await withCompanyTransaction(appDatabase, companyAId, (tx) => tx.insert(reportCategories).values({ companyId: companyBId, line: "revenue", name: "Foreign" })).then(() => null, (reason: unknown) => reason);
    expect(String((rejection as { cause?: unknown } | null)?.cause ?? rejection)).toMatch(/row-level security/i);
    const crossCompany = await database.insert(chartAccounts).values({ companyId: companyAId, code: `4000-${run.slice(0, 8)}`, name: "Synthetic revenue", accountType: "revenue", normalBalance: "credit", reportLine: "revenue", reportCategoryId: categoryIds[companyBId]! }).then(() => null, (reason: unknown) => reason);
    expect(String((crossCompany as { cause?: unknown } | null)?.cause ?? crossCompany)).toMatch(/foreign key/i);
  });

  it("isolates operating metrics and seasonality profiles", async (context) => {
    if (!appDatabase) { context.skip(`skipped: ${unavailable}`); return; }
    for (const companyId of [companyAId, companyBId]) {
      await database.insert(forecastMetrics).values({ companyId, name: "customers", label: "Customers", effectiveFrom: "2027-01", pattern: { initialValue: "100", repeatsEveryMonths: 1 } });
      await database.insert(seasonalityProfiles).values({ companyId, name: "Flat", deviations: Array(12).fill("0") });
      const [metric] = await database.select().from(forecastMetrics).where(eq(forecastMetrics.companyId, companyId));
      await database.insert(forecastMetricActuals).values({ companyId, metricId: metric!.id, month: "2026-09", value: "120" });
    }
    await withCompanyTransaction(appDatabase, companyAId, async (tx) => {
      expect((await tx.select().from(forecastMetrics)).map((row) => row.companyId)).toEqual([companyAId]);
      expect((await tx.select().from(seasonalityProfiles)).map((row) => row.companyId)).toEqual([companyAId]);
      expect((await tx.select().from(forecastMetricActuals)).map((row) => row.companyId)).toEqual([companyAId]);
    });
    const rejection = await withCompanyTransaction(appDatabase, companyAId, (tx) => tx.insert(forecastMetrics).values({ companyId: companyBId, name: "foreign", label: "Foreign", effectiveFrom: "2027-01", pattern: {} })).then(() => null, (reason: unknown) => reason);
    expect(String((rejection as { cause?: unknown } | null)?.cause ?? rejection)).toMatch(/row-level security/i);
  });
});
