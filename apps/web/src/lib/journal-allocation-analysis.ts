import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { allocations, cashEvents, getDatabase } from "@finance/database";
import { analyzeApprovedAllocations } from "@nevermodel/finance-engine";

/** Load the allocation-control layer for one period without posting it. */
export async function loadJournalAllocationAnalysis(companyId: string, period: string) {
  const db = getDatabase();
  const rows = await db.select().from(allocations).where(and(eq(allocations.companyId, companyId), eq(allocations.status, "approved")));
  const eventIds = [...new Set(rows.map((row) => row.eventId).filter((id): id is string => Boolean(id)))];
  if (!eventIds.length) return analyzeApprovedAllocations({ allocations: [], sources: [] });
  const events = await db.select({ id: cashEvents.id, month: cashEvents.month, amount: cashEvents.amount, direction: cashEvents.direction, sourceId: cashEvents.sourceId, sourceLocation: cashEvents.sourceLocation }).from(cashEvents).where(and(eq(cashEvents.companyId, companyId), eq(cashEvents.month, period), inArray(cashEvents.id, eventIds)));
  return analyzeApprovedAllocations({ allocations: rows, sources: events.map((event) => ({ id: event.id, period: event.month, amountMinor: (() => { const [whole, cents = ""] = event.amount.replace(/[$,]/g, "").replace(/^\((.*)\)$/, "-$1").split("."); return `${BigInt(whole || "0") * 100n + BigInt(cents.padEnd(2, "0").slice(0, 2) || "0")}`; })(), direction: event.direction, ...(event.sourceId ? { sourceId: event.sourceId } : {}), ...(event.sourceLocation ? { sourceLocation: event.sourceLocation } : {}) })) });
}
