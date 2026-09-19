import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { evidence, getDatabase } from "@finance/database";
import type { ForecastConsequence, ForecastRun, ForecastRunInput, ForecastRunway } from "@nevermodel/finance-engine";
import { describeConsequence, type ConsequenceSource } from "@/lib/consequence-copy";
import { loadForecastBase, loadForecastBaseWith } from "@/lib/forecast-base";
import { loadForecastDrivers } from "@/lib/forecast-inputs";
import { driverEvidenceIds } from "@/lib/forecast-read";
import { runSimulation, scenarioChangeFromFlat, ScenarioChangeInvalid, type ScenarioChange, type ScenarioForecastView } from "@/lib/scenario-changes";
import { loadActiveScenarioWith, ScenarioNotFound } from "@/lib/scenarios";
import type { DbExecutor } from "@/lib/db-executor";

/** The documents behind the drivers a consequence names, as in C1, resolved within the company only. */
export async function resolveSourcesWith(db: DbExecutor, companyId: string, consequence: ForecastConsequence | null): Promise<ConsequenceSource[]> {
  const ids = consequence ? driverEvidenceIds(consequence) : [];
  if (!ids.length) return [];
  const rows = await db.select({ id: evidence.id, sourceName: evidence.sourceName }).from(evidence).where(and(eq(evidence.companyId, companyId), inArray(evidence.id, ids)));
  const names = new Map(rows.map((row) => [row.id, row.sourceName]));
  return ids.filter((id) => names.has(id)).map((evidenceId) => ({ evidenceId, sourceName: names.get(evidenceId) ?? null }));
}

/**
 * A scenario's forecast, computed on demand and never persisted: the base
 * input (loadForecastBase), plus the scenario's confirmed items, plus its
 * changes, diffed against the base run built from the same input.
 */
export async function loadScenarioForecastWith(db: DbExecutor, companyId: string, scenarioId: string, now: Date = new Date()): Promise<ScenarioForecastView> {
  const scenario = await loadActiveScenarioWith(db, companyId, scenarioId);
  const [base, { drivers: scenarioDrivers }] = await Promise.all([loadForecastBaseWith(db, companyId, now), loadScenarioDriversWith(db, companyId, scenarioId)]);
  const { run, consequence } = runSimulation(base, scenario.changes, { scenarioId, scenarioDrivers });
  return { scenario, months: run.months.filter((month) => month.basis === "forecast"), runway: run.runway, consequence, exceptions: run.exceptions, sources: await resolveSourcesWith(db, companyId, consequence) };
}

export function loadScenarioDriversWith(db: DbExecutor, companyId: string, scenarioId: string) {
  return loadForecastDrivers(companyId, { scenarioId }, db);
}

export function loadScenarioForecast(companyId: string, scenarioId: string, now: Date = new Date()): Promise<ScenarioForecastView> {
  return loadScenarioForecastWith(getDatabase(), companyId, scenarioId, now);
}

export type SimulateDeps = { loadBase?: (companyId: string) => Promise<ForecastRunInput>; loadScenario?: (companyId: string, scenarioId: string) => Promise<ScenarioForecastView> };
type Simulated = { runway: ForecastRunway; consequence: string; exceptions: ForecastRun["exceptions"] };

/**
 * The agent's read-only what-if. `{ changes }` (flat scenario changes) runs
 * against the current base forecast; `{ scenarioId }` reports a saved
 * scenario. Nothing is written. `deps` lets tests stub the base.
 */
export async function simulateForAgent(companyId: string, input: Record<string, unknown>, deps: SimulateDeps = {}): Promise<{ error: string } | Simulated | (Simulated & { scenario: string })> {
  const loadBase = deps.loadBase ?? ((id: string) => loadForecastBase(id));
  const loadScenario = deps.loadScenario ?? ((id: string, scenarioId: string) => loadScenarioForecast(id, scenarioId));
  if (typeof input.scenarioId === "string") {
    try {
      const result = await loadScenario(companyId, input.scenarioId);
      return { scenario: result.scenario.name, runway: result.runway, consequence: describeConsequence(result.consequence, result.exceptions.length), exceptions: result.exceptions };
    } catch (error) {
      if (error instanceof ScenarioNotFound) return { error: "Scenario not found." };
      throw error;
    }
  }
  const raw = Array.isArray(input.changes) ? input.changes : [];
  if (!raw.length) return { error: 'simulate needs {"changes":[...]} with at least one change, or {"scenarioId":"..."}.' };
  const parsed = raw.map(scenarioChangeFromFlat);
  const invalid = parsed.findIndex((change) => change === null);
  if (invalid >= 0) return { error: `Change ${invalid + 1} is not a valid scenario change.` };
  const changes = parsed.filter((change): change is ScenarioChange => change !== null);
  try {
    const { run, consequence } = runSimulation(await loadBase(companyId), changes);
    return { runway: run.runway, consequence: describeConsequence(consequence, run.exceptions.length), exceptions: run.exceptions };
  } catch (error) {
    if (error instanceof ScenarioChangeInvalid) return { error: error.message };
    throw error;
  }
}
