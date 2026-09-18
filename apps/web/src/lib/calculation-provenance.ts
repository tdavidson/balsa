export type CalculationProvenanceEntry = { evidenceId?: string; sourceId?: string; sourceName?: string; sourceLocation?: string; factId?: string; accountId?: string; period?: string };

/**
 * Driver ids from a forecast node's `{ driverIds }` provenance shape (see
 * persistForecastRun in forecast-persistence.ts). Any other shape yields [].
 */
export function driverIdsFromProvenance(raw: unknown): string[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const driverIds = (raw as { driverIds?: unknown }).driverIds;
  return Array.isArray(driverIds) ? driverIds.filter((id): id is string => typeof id === "string") : [];
}

/**
 * Journal calculation nodes store provenance as an array of entries; forecast nodes
 * store it as `{ driverIds }`. Normalize both into the array shape the calculation
 * trace dialog renders, resolving each driver id to a source entry via `driverLabels`
 * (economic item id -> label). An unresolved id falls back to itself.
 */
export function normalizeCalculationProvenance(raw: unknown, driverLabels: ReadonlyMap<string, string> = new Map()): CalculationProvenanceEntry[] {
  if (Array.isArray(raw)) return raw as CalculationProvenanceEntry[];
  return driverIdsFromProvenance(raw).map((id) => ({ sourceId: id, sourceName: driverLabels.get(id) ?? id }));
}
