import { buildTrialBalance, type PostedJournalLine } from "./ledger";
import { buildJournalStatements, selectJournalLinesForReporting } from "./statements";
import { selectConsolidatedJournalLines, type ConsolidationEntity } from "./consolidation-perimeter";

/** One deterministic consolidation view; currencies remain separate until FX translation is configured. */
export function buildConsolidatedJournalReport(lines: PostedJournalLine[], period: string, entities: ConsolidationEntity[]) {
  const actualLines = selectJournalLinesForReporting(lines, period, { view: "actual" });
  const includedLines = selectConsolidatedJournalLines(actualLines, entities, period);
  return { period, entityIds: entities.filter((entity) => entity.consolidated && entity.consolidationMethod === "full" && (!entity.effectiveFrom || entity.effectiveFrom <= period) && (!entity.effectiveTo || entity.effectiveTo >= period)).map((entity) => entity.id), includedLineIds: includedLines.map((line) => line.id).sort(), includedLines, trialBalance: buildTrialBalance(includedLines, period), statements: buildJournalStatements(includedLines, period, undefined, { basis: "all" }) };
}
