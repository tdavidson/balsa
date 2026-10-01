import "server-only";
import { and, eq } from "drizzle-orm";
import { getDatabase, intercompanyAccountMappings, intercompanyEliminationEntries } from "@finance/database";
import { previewIntercompanyEliminations } from "@balsa/finance-engine";
import { loadPostedJournalLines } from "@/lib/journal-ledger";

/** Loads approved reciprocal maps and creates a read-only elimination preview. */
export async function loadIntercompanyEliminationPreview(companyId: string, period: string) {
  const [mappings, lines, posted] = await Promise.all([
    getDatabase().select({ id: intercompanyAccountMappings.id, fromEntityId: intercompanyAccountMappings.fromEntityId, toEntityId: intercompanyAccountMappings.toEntityId, receivableAccountId: intercompanyAccountMappings.receivableAccountId, payableAccountId: intercompanyAccountMappings.payableAccountId, effectiveFrom: intercompanyAccountMappings.effectiveFrom, effectiveTo: intercompanyAccountMappings.effectiveTo, active: intercompanyAccountMappings.active }).from(intercompanyAccountMappings).where(and(eq(intercompanyAccountMappings.companyId, companyId), eq(intercompanyAccountMappings.active, "Y"))),
    loadPostedJournalLines(companyId, period),
    getDatabase().select({ mappingId: intercompanyEliminationEntries.mappingId }).from(intercompanyEliminationEntries).where(and(eq(intercompanyEliminationEntries.companyId, companyId), eq(intercompanyEliminationEntries.period, period))),
  ]);
  const postedMappingIds = new Set(posted.map((entry) => entry.mappingId));
  return previewIntercompanyEliminations(lines, period, mappings.filter((mapping) => !postedMappingIds.has(mapping.id)).map((mapping) => ({ ...mapping, active: mapping.active === "Y" })));
}
