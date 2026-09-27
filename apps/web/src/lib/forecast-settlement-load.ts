import "server-only";
import { and, asc, eq, lte } from "drizzle-orm";
import { forecastOccurrences, forecastSettlementAllocations, journalEntries } from "@finance/database";
import { cashMovement, type CashOccurrence, type CashSettlementInput, type PostedJournalLine } from "@nevermodel/finance-engine";
import type { DbExecutor } from "./db-executor";

export async function loadSettlementInput(db: DbExecutor, companyId: string, actualLines: PostedJournalLine[], throughDate: string): Promise<CashSettlementInput> {
  const [occurrences, allocations, entries] = await Promise.all([
    db.select().from(forecastOccurrences).where(eq(forecastOccurrences.companyId, companyId)).orderBy(asc(forecastOccurrences.id)),
    db.select().from(forecastSettlementAllocations).where(eq(forecastSettlementAllocations.companyId, companyId)).orderBy(asc(forecastSettlementAllocations.id)),
    db.select({ id: journalEntries.id, reversalOf: journalEntries.reversalOfEntryId }).from(journalEntries).where(and(eq(journalEntries.companyId, companyId), eq(journalEntries.status, "posted"), lte(journalEntries.postingDate, throughDate))),
  ]);
  const reversed = new Set(entries.flatMap((entry) => entry.reversalOf ? [entry.reversalOf] : []));
  const reversing = new Set(entries.filter((entry) => entry.reversalOf).map((entry) => entry.id));
  const grouped = new Map<string, PostedJournalLine[]>();
  for (const line of actualLines) {
    if (!["actual", "adjustment"].includes(line.basis ?? "actual") || line.postingDate && line.postingDate > throughDate) continue;
    const id = line.entryId ?? line.id;
    grouped.set(id, [...(grouped.get(id) ?? []), line]);
  }
  const actuals = [...grouped].sort(([a], [b]) => a.localeCompare(b)).flatMap(([id, lines]) => {
    const movement = cashMovement(lines);
    const factId = lines[0]?.provenance?.factId;
    return movement ? [{ ...movement, id, reversed: reversed.has(id) || reversing.has(id), memo: lines[0]?.memo ?? "Posted cash activity", factId: factId && lines.every((line) => line.provenance?.factId === factId) ? factId : null }] : [];
  });
  return { throughDate, occurrences: occurrences.map((row) => ({ ...(row.definition as Omit<CashOccurrence, "id" | "version">), id: row.id, version: row.version })), allocations: allocations.map(({ id, occurrenceId, actualEntryId, amountMinor, revoked }) => ({ id, occurrenceId, actualEntryId, amountMinor, revoked })), actuals };
}
