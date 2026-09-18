import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { evidence, getDatabase } from "@finance/database";
import type { ForecastConsequence } from "@nevermodel/finance-engine";
import type { ConsequenceSource } from "@/lib/consequence-copy";
import { loadForecastBase } from "@/lib/forecast-base";
import { loadForecastDrivers } from "@/lib/forecast-inputs";
import { driverEvidenceIds } from "@/lib/forecast-read";
import { runSimulation, type ScenarioForecastView } from "@/lib/scenario-changes";
import { loadActiveScenario } from "@/lib/scenarios";

/** The documents behind the drivers a consequence names, as in C1, resolved within the company only. */
async function resolveSources(companyId: string, consequence: ForecastConsequence | null): Promise<ConsequenceSource[]> {
  const ids = consequence ? driverEvidenceIds(consequence) : [];
  if (!ids.length) return [];
  const rows = await getDatabase().select({ id: evidence.id, sourceName: evidence.sourceName }).from(evidence).where(and(eq(evidence.companyId, companyId), inArray(evidence.id, ids)));
  const names = new Map(rows.map((row) => [row.id, row.sourceName]));
  return ids.filter((id) => names.has(id)).map((evidenceId) => ({ evidenceId, sourceName: names.get(evidenceId) ?? null }));
}

/**
 * A scenario's forecast, computed on demand and never persisted: the base
 * input (loadForecastBase), plus the scenario's confirmed items, plus its
 * changes, diffed against the base run built from the same input.
 */
export async function loadScenarioForecast(companyId: string, scenarioId: string, now: Date = new Date()): Promise<ScenarioForecastView> {
  const scenario = await loadActiveScenario(companyId, scenarioId);
  const [base, { drivers: scenarioDrivers }] = await Promise.all([loadForecastBase(companyId, now), loadForecastDrivers(companyId, { scenarioId })]);
  const { run, consequence } = runSimulation(base, scenario.changes, { scenarioId, scenarioDrivers });
  return { scenario, months: run.months.filter((month) => month.basis === "forecast"), runway: run.runway, consequence, exceptions: run.exceptions, sources: await resolveSources(companyId, consequence) };
}
