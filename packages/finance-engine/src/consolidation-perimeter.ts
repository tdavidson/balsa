import type { PostedJournalLine } from "./ledger";

export type ConsolidationEntity = { id: string; consolidated: boolean; consolidationMethod: "full" | "equity" | "exclude"; effectiveFrom?: string | null; effectiveTo?: string | null };

/** Selects only effective full-consolidation entities plus explicit eliminations. */
export function selectConsolidatedJournalLines(lines: PostedJournalLine[], entities: ConsolidationEntity[], period: string) {
  const included = new Set(entities.filter((entity) => entity.consolidated && entity.consolidationMethod === "full" && (!entity.effectiveFrom || entity.effectiveFrom <= period) && (!entity.effectiveTo || entity.effectiveTo >= period)).map((entity) => entity.id));
  return lines.filter((line) => line.period <= period && (line.basis === "elimination" || (line.entityId !== undefined && included.has(line.entityId))));
}
