import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { scenarios } from "@finance/database";
import type { DbExecutor, DbTransaction } from "@/lib/db-executor";

const SCENARIO_NAME_LOCK_NAMESPACE = 7402;

/** Serialize every active-name claim for one company without consuming another pool connection. */
export async function lockScenarioName(tx: DbTransaction, companyId: string, name: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(${SCENARIO_NAME_LOCK_NAMESPACE}, hashtext(${`${companyId}:${name}`}))`);
}

export async function findActiveScenarioByName(db: DbExecutor, companyId: string, name: string, exceptId?: string) {
  const [row] = await db.select({ id: scenarios.id }).from(scenarios).where(and(
    eq(scenarios.companyId, companyId),
    eq(scenarios.active, "Y"),
    eq(scenarios.name, name),
    exceptId ? ne(scenarios.id, exceptId) : undefined,
  )).limit(1);
  return row;
}

/** Find or claim an active name while holding the same lock used by UI creates and renames. */
export async function getOrCreateActiveScenario(tx: DbTransaction, companyId: string, name: string) {
  await lockScenarioName(tx, companyId, name);
  const [existing] = await tx.select({ id: scenarios.id }).from(scenarios).where(and(eq(scenarios.companyId, companyId), eq(scenarios.active, "Y"), eq(scenarios.name, name))).limit(1).for("update");
  if (existing) return existing.id;
  const [created] = await tx.insert(scenarios).values({ companyId, name }).returning({ id: scenarios.id });
  if (!created) throw new Error("Scenario insert returned no row");
  return created.id;
}
