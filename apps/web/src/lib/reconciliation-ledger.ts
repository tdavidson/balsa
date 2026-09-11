import { isDetailedFinancialEvent } from "./financial-events";
import { matchTransactionsAcrossSources } from "./transaction-matching";

export type LedgerSourceEvent = {
  id: string;
  month: string;
  date?: string | null | undefined;
  amount: number | string;
  currency?: string | null;
  direction: string;
  description: string;
  sourceName?: string | null | undefined;
  sourceKind?: string | null | undefined;
  evidenceStatus?: string | null | undefined;
  isActual?: string | null | undefined;
  accountingTreatment?: string | null | undefined;
};

export type ReconciliationLedgerEntry = {
  eventId: string;
  counterpartEventId?: string | undefined;
  month: string;
  kind: "staged" | "currency_pending" | "duplicate" | "transfer" | "book_match" | "excluded" | "unmatched";
  matchKey: string;
  evidence: { sourceName?: string | null | undefined; description: string; amount: number; currency?: string | null | undefined; counterpartSource?: string | null | undefined };
};

/** Produces one transparent reconciliation state per event without mutating accounting state. */
export function buildReconciliationLedger(events: LedgerSourceEvent[], baseCurrency: string): ReconciliationLedgerEntry[] {
  const approvedBaseEvents = events.filter((event) => event.isActual !== "N" && event.accountingTreatment !== "pending" && (!event.evidenceStatus || event.evidenceStatus === "approved") && (!event.currency || event.currency === baseCurrency) && isDetailedFinancialEvent(event.description));
  const groups = matchTransactionsAcrossSources(approvedBaseEvents.map((event) => ({ id: event.id, ...(event.date !== undefined ? { date: event.date } : {}), amount: event.amount, direction: event.direction, description: event.description, ...(event.sourceName !== undefined ? { sourceName: event.sourceName } : {}), ...(event.sourceKind !== undefined ? { sourceKind: event.sourceKind } : {}) })));
  const groupByEvent = new Map<string, { kind: "duplicate" | "transfer" | "book_match"; key: string; counterpartId?: string | undefined; counterpartSource?: string | null | undefined }>();
  for (const group of groups) for (const eventId of group.transactionIds) {
    const counterpartId = group.transactionIds.find((id) => id !== eventId);
    const counterpart = events.find((event) => event.id === counterpartId);
    groupByEvent.set(eventId, { kind: group.kind, key: group.key, counterpartId, counterpartSource: counterpart?.sourceName });
  }
  return events.map((event) => {
    const amount = Number(event.amount);
    const base = { eventId: event.id, month: event.month, evidence: { sourceName: event.sourceName, description: event.description, amount: Number.isFinite(amount) ? amount : 0, currency: event.currency } };
    if (event.isActual === "N" || event.accountingTreatment === "pending" || (event.evidenceStatus && event.evidenceStatus !== "approved")) return { ...base, kind: "staged" as const, matchKey: `staged:${event.id}` };
    if (event.currency && event.currency !== baseCurrency) return { ...base, kind: "currency_pending" as const, matchKey: `currency:${event.id}` };
    const group = groupByEvent.get(event.id);
    if (group) return { ...base, kind: group.kind, matchKey: group.key, ...(group.counterpartId ? { counterpartEventId: group.counterpartId } : {}), evidence: { ...base.evidence, counterpartSource: group.counterpartSource } };
    if (!isDetailedFinancialEvent(event.description)) return { ...base, kind: "excluded" as const, matchKey: `excluded:${event.id}` };
    return { ...base, kind: "unmatched" as const, matchKey: `unmatched:${event.id}` };
  });
}
