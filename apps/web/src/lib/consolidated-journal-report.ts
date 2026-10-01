import "server-only";
import { buildConsolidatedJournalReport } from "@balsa/finance-engine";
import { loadEntityStructure } from "@/lib/entity-structure";
import { loadPostedJournalLines } from "@/lib/journal-ledger";

export async function loadConsolidatedJournalReport(companyId: string, period: string) {
  const [structure, lines] = await Promise.all([loadEntityStructure(companyId), loadPostedJournalLines(companyId, period)]);
  return buildConsolidatedJournalReport(lines, period, structure.legalEntities);
}
