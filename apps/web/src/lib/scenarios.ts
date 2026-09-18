import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { economicItems, getDatabase, scenarios } from "@finance/database";
import { parseStoredChanges, type ScenarioDetail } from "@/lib/scenario-changes";

/** The scenario (or the decision a scenario is made from) does not exist in this company, or the scenario is inactive. */
export class ScenarioNotFound extends Error {}
/** A rule the CFO can fix: a duplicate active name, or a decision that is no longer proposed. */
export class ScenarioConflict extends Error {}
/** Well-formed but unusable: a change targets an item outside the company's confirmed base forecast, or a decision holds no driver change. */
export class ScenarioInvalid extends Error {}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type ScenarioRow = typeof scenarios.$inferSelect;

const toDetail = (row: ScenarioRow, itemCount: number): ScenarioDetail => ({ id: row.id, name: row.name, description: row.description, changes: parseStoredChanges(row.changes), itemCount });

/** Confirmed items tagged to each scenario: the items a scenario run includes. */
async function itemCounts(companyId: string, scenarioIds: string[]): Promise<Map<string, number>> {
  if (!scenarioIds.length) return new Map();
  const rows = await getDatabase().select({ scenarioId: economicItems.scenarioId, count: sql<number>`count(*)::int` }).from(economicItems)
    .where(and(eq(economicItems.companyId, companyId), eq(economicItems.status, "confirmed"), inArray(economicItems.scenarioId, scenarioIds)))
    .groupBy(economicItems.scenarioId);
  return new Map(rows.flatMap((row) => (row.scenarioId ? [[row.scenarioId, Number(row.count)] as const] : [])));
}

/** An active scenario of this company. Anything else, including a malformed id, is not found. */
export async function loadActiveScenario(companyId: string, scenarioId: string): Promise<ScenarioDetail> {
  if (!uuidPattern.test(scenarioId)) throw new ScenarioNotFound("Scenario not found");
  const [row] = await getDatabase().select().from(scenarios).where(and(eq(scenarios.id, scenarioId), eq(scenarios.companyId, companyId), eq(scenarios.active, "Y"))).limit(1);
  if (!row) throw new ScenarioNotFound("Scenario not found");
  return toDetail(row, (await itemCounts(companyId, [row.id])).get(row.id) ?? 0);
}
