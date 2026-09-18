import "server-only";
import { buildForecastRun } from "@nevermodel/finance-engine";
import { loadForecastInputs } from "@/lib/forecast-inputs";
import { persistForecastRun, recordForecastConsequence } from "@/lib/forecast-persistence";

/** Derive, persist, and diff the forecast for one committed revision. */
export async function runForecastJob(companyId: string, financialStateRevision: string) {
  const input = await loadForecastInputs(companyId);
  const run = buildForecastRun(input);
  const persisted = await persistForecastRun({ companyId, financialStateRevision, run, input });
  if (!persisted.reused) await recordForecastConsequence({ companyId, financialStateRevision, nextRunId: persisted.id, run });
  return persisted;
}
