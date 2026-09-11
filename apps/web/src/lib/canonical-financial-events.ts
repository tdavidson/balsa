import { matchTransactionsAcrossSources } from "./transaction-matching";

export type CanonicalCandidate = { id: string; date?: string | null; amount: string | number; direction: string; description: string; sourceName?: string | null; sourceKind?: string | null };

const cashPriority = ["bank_statement", "brokerage_statement", "quickbooks_transactions", "general_ledger"];
const booksPriority = ["quickbooks_transactions", "general_ledger", "bank_statement", "brokerage_statement"];

/**
 * Deduplicate only an explicit cross-source duplicate or book-match group.
 * Repeated rows within a source are always retained as independent activity.
 */
export function canonicalFinancialEvents<T extends CanonicalCandidate>(events: T[], preference: "cash" | "books" = "cash") {
  const priority = preference === "cash" ? cashPriority : booksPriority;
  const rank = (event: T) => {
    const index = priority.indexOf(event.sourceKind ?? "");
    return index < 0 ? priority.length : index;
  };
  const groups = matchTransactionsAcrossSources(events);
  const excluded = new Set<string>();
  for (const group of groups) {
    if (group.kind === "transfer") continue;
    const candidates = events.filter((event) => group.transactionIds.includes(event.id));
    const canonical = [...candidates].sort((left, right) => rank(left) - rank(right) || left.id.localeCompare(right.id))[0];
    for (const event of candidates) if (event.id !== canonical?.id) excluded.add(event.id);
  }
  return events.filter((event) => !excluded.has(event.id));
}
