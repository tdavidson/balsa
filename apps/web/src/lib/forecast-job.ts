import "server-only";
import { buildForecastRun } from "@nevermodel/finance-engine";
import { loadForecastInputs } from "@/lib/forecast-inputs";
import { persistForecastRun, recordForecastConsequence } from "@/lib/forecast-persistence";

/** Derive, persist, and diff the forecast for one committed revision. */
export async function runForecastJob(companyId: string, financialStateRevision: string, now = new Date()) {
  const input = await loadForecastInputs(companyId, now);
  const run = buildForecastRun(input);
  const persisted = await persistForecastRun({ companyId, financialStateRevision, run, input });
  // Unconditional: a retry after a failure between persist and record must still record. The (company, revision) unique index keeps it idempotent.
  await recordForecastConsequence({ companyId, financialStateRevision, nextRunId: persisted.id, run });
  return persisted;
}
