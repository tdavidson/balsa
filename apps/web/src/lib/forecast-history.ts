import "server-only";
import { createHash } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";
import { economicItems, evidence, journalEntries } from "@finance/database";
import { stableJson, type PostedJournalLine } from "@nevermodel/finance-engine";
import { loadPostedJournalLines } from "./journal-ledger";
import type { DbExecutor } from "./db-executor";
export const historyRuleVersion = "approved-history-median-2026-09-25.1";
export type HistoryOrigin = { approvalHash?: string; patternKey: string; sourceLineIds: string[]; sourceHash: string; expectedDay: number; ruleVersion: string };
export const historySourceHash = (lines: PostedJournalLine[]) => createHash("sha256").update(stableJson([...lines].sort((a, b) => a.id.localeCompare(b.id)))).digest("hex");
export async function loadHistoryOrigins(db: DbExecutor, companyId: string, throughDate: string) {
  const origins = await db.select({ id: economicItems.id, origin: economicItems.forecastOrigin }).from(economicItems).where(eq(economicItems.companyId, companyId));
  const selected = origins.filter((item) => item.origin != null);
  if (!selected.length) return [];
  const [lines, reversals, documents] = await Promise.all([
    loadPostedJournalLines(companyId, throughDate.slice(0, 7), db),
    db.select({ id: journalEntries.id, reversalOf: journalEntries.reversalOfEntryId }).from(journalEntries).where(and(eq(journalEntries.companyId, companyId), eq(journalEntries.status, "posted"), lte(journalEntries.postingDate, throughDate))),
    db.select({ id: evidence.id, sourceId: evidence.sourceId, status: evidence.status, identityStatus: evidence.identityStatus, hash: evidence.sourceHash }).from(evidence).where(eq(evidence.companyId, companyId)),
  ]);
  const reversed = new Set(reversals.flatMap((entry) => entry.reversalOf ? [entry.reversalOf, entry.id] : []));
  return selected.map((item) => {
    const origin = item.origin as HistoryOrigin;
    const supporting = lines.filter((line) => origin.sourceLineIds.includes(line.id) && !reversed.has(line.entryId ?? line.id));
    const unapproved = supporting.some((line) => line.provenance?.sourceId && documents.some((document) => document.sourceId === line.provenance!.sourceId && (document.status !== "approved" || document.identityStatus !== "approved")));
    const sourceIds = new Set(supporting.flatMap((line) => line.provenance?.sourceId ? [line.provenance.sourceId] : []));
    const approvalHash = createHash("sha256").update(stableJson(documents.filter((document) => document.sourceId && sourceIds.has(document.sourceId)).sort((a, b) => a.id.localeCompare(b.id)))).digest("hex");
    return { driverId: item.id, origin, valid: (!origin.approvalHash || origin.approvalHash === approvalHash) && origin.ruleVersion === historyRuleVersion && !unapproved && supporting.length === origin.sourceLineIds.length && historySourceHash(supporting) === origin.sourceHash };
  });
}
