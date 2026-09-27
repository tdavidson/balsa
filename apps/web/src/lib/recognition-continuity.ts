import "server-only";
import { createHash } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";
import { journalEntries, recognitionJournalLinks } from "@finance/database";
import { stableJson, type PostedJournalLine, type RecognitionProof } from "@nevermodel/finance-engine";
import type { DbExecutor } from "./db-executor";
export const recognitionJournalHash = (lines: PostedJournalLine[]) => createHash("sha256").update(stableJson([...lines].sort((a, b) => a.id.localeCompare(b.id)))).digest("hex");
export async function loadRecognitionProofs(db: DbExecutor, companyId: string, throughMonth: string, currency: string, lines: PostedJournalLine[]): Promise<RecognitionProof[]> {
  const links = await db.select().from(recognitionJournalLinks).where(and(eq(recognitionJournalLinks.companyId, companyId), eq(recognitionJournalLinks.revoked, false)));
  if (!links.length) return [];
  const entries = await db.select({ id: journalEntries.id, reversalOf: journalEntries.reversalOfEntryId }).from(journalEntries).where(and(eq(journalEntries.companyId, companyId), eq(journalEntries.status, "posted"), lte(journalEntries.period, throughMonth)));
  const reversed = new Set(entries.flatMap((entry) => entry.reversalOf ? [entry.id, entry.reversalOf] : []));
  return [...new Set(links.map((link) => link.driverId))].sort().map((driverId) => {
    const selected = links.filter((link) => link.driverId === driverId);
    const supporting = lines.filter((line) => selected.some((link) => link.entryId === line.entryId) && line.period <= throughMonth);
    const valid = selected.every((link) => { const own = supporting.filter((line) => line.entryId === link.entryId); return own.length > 0 && !reversed.has(link.entryId) && recognitionJournalHash(own) === link.sourceHash; });
    return { driverId, throughMonth, currency, lines: supporting, valid };
  });
}
