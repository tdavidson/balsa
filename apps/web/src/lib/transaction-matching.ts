export type MatchableTransaction = {
  id: string;
  date?: string | null;
  amount: number | string;
  direction: string;
  description: string;
  sourceName?: string | null;
  sourceKind?: string | null | undefined;
};

export type TransactionMatchGroup = {
  key: string;
  kind: "duplicate" | "transfer" | "book_match";
  transactionIds: string[];
  sources: string[];
  amount: number;
  direction: string;
  date: string | null;
  descriptions: string[];
  /** Internal matching context; not an accounting classification. */
  sourceKinds?: (string | null | undefined)[];
};

function tokens(description: string) {
  return new Set(description.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((word) => word.length > 2 && !["the", "and", "from", "with"].includes(word)));
}

function relatedDescriptions(left: string, right: string) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return left.trim().toLowerCase() === right.trim().toLowerCase();
  const overlap = [...a].filter((word) => b.has(word)).length;
  return [...a].every((word) => b.has(word)) || [...b].every((word) => a.has(word)) || (overlap >= 2 && overlap / Math.min(a.size, b.size) >= 0.5);
}

/**
 * Bank and book descriptions often use completely different prose, but retain
 * a check, invoice, ACH trace, wire, or confirmation reference.  A reference
 * is stronger evidence than fuzzy merchant-name similarity, so use it only
 * when the source, amount, direction, and timing already agree.
 */
function transactionReferences(description: string) {
  const references = new Set<string>();
  const pattern = /\b(?:ref(?:erence)?|trace|confirmation|conf|check|cheque|invoice|inv|wire|ach)\s*(?:number|no\.?|#)?\s*[:#-]?\s*([a-z0-9][a-z0-9-]{3,})\b/gi;
  for (const match of description.matchAll(pattern)) references.add(match[1]!.replace(/[^a-z0-9]/gi, "").toLowerCase());
  return references;
}

function relatedByReference(left: string, right: string) {
  const leftReferences = transactionReferences(left);
  const rightReferences = transactionReferences(right);
  return [...leftReferences].some((reference) => rightReferences.has(reference));
}

function likelyTransfer(description: string) {
  return /(?:^|\b)(?:cash\s+)?transfer(?:s)?\b|internal\s+(?:cash\s+)?move|account\s+(?:sweep|move)|intercompany|funds?\s+transferred|automatic\s+(?:investment|redemption)|bank\s+(?:product\s+)?(?:deposit|withdrawal)/i.test(description);
}

function bookToBankPair(left: MatchableTransaction, right: MatchableTransaction) {
  return bookToBankKinds([left.sourceKind, right.sourceKind]);
}

function bookToBankKinds(kinds: (string | null | undefined)[]) {
  const uniqueKinds = new Set(kinds);
  return uniqueKinds.has("bank_statement") && (uniqueKinds.has("quickbooks_transactions") || uniqueKinds.has("general_ledger"));
}

function daysApart(left: string | null | undefined, right: string | null | undefined) {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  const leftTime = Date.parse(`${left}T00:00:00Z`);
  const rightTime = Date.parse(`${right}T00:00:00Z`);
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) ? Math.abs(leftTime - rightTime) / 86_400_000 : Number.POSITIVE_INFINITY;
}

/** Finds probable duplicates across source systems without changing accounting state. */
export function matchTransactionsAcrossSources(transactions: MatchableTransaction[]): TransactionMatchGroup[] {
  const groups: TransactionMatchGroup[] = [];
  for (const transaction of transactions) {
    const amount = Number(transaction.amount);
    if (!Number.isFinite(amount)) continue;
    const existing = groups.find((group) => group.amount === amount && group.direction === transaction.direction && group.date === (transaction.date ?? null) && Boolean(transaction.sourceName) && !group.sources.includes(transaction.sourceName!) && !bookToBankKinds([...(group.sourceKinds ?? []), transaction.sourceKind]) && group.descriptions.some((description) => relatedDescriptions(description, transaction.description)));
    if (existing) {
      existing.transactionIds.push(transaction.id);
      if (transaction.sourceName) existing.sources.push(transaction.sourceName);
      existing.descriptions.push(transaction.description);
      existing.sourceKinds?.push(transaction.sourceKind);
    } else {
      groups.push({ key: `duplicate|${transaction.date ?? "unknown"}|${amount.toFixed(2)}|${transaction.direction}|${transaction.id}`, kind: "duplicate", transactionIds: [transaction.id], sources: transaction.sourceName ? [transaction.sourceName] : [], amount, direction: transaction.direction, date: transaction.date ?? null, descriptions: [transaction.description], sourceKinds: [transaction.sourceKind] });
    }
  }
  const duplicates = groups.filter((group) => group.transactionIds.length > 1);
  const transfers: TransactionMatchGroup[] = [];
  for (const transaction of transactions) {
    const amount = Number(transaction.amount);
    if (!Number.isFinite(amount) || !likelyTransfer(transaction.description) || !transaction.sourceName) continue;
    const existing = transfers.find((group) => group.amount === amount && group.transactionIds.length === 1 && group.direction !== transaction.direction && !group.sources.includes(transaction.sourceName!) && daysApart(group.date, transaction.date) <= 3);
    if (existing) {
      existing.transactionIds.push(transaction.id);
      existing.sources.push(transaction.sourceName);
      existing.descriptions.push(transaction.description);
    } else {
      transfers.push({ key: `transfer|${transaction.date ?? "unknown"}|${amount.toFixed(2)}|${transaction.id}`, kind: "transfer", transactionIds: [transaction.id], sources: [transaction.sourceName], amount, direction: transaction.direction, date: transaction.date ?? null, descriptions: [transaction.description] });
    }
  }
  const bookMatches: TransactionMatchGroup[] = [];
  for (const transaction of transactions) {
    const amount = Number(transaction.amount);
    if (!Number.isFinite(amount) || !transaction.sourceName) continue;
    const counterpart = transactions.find((candidate) => candidate.id !== transaction.id && candidate.sourceName && candidate.sourceName !== transaction.sourceName && Number(candidate.amount) === amount && candidate.direction === transaction.direction && bookToBankPair(transaction, candidate) && daysApart(transaction.date, candidate.date) <= 5 && (relatedDescriptions(transaction.description, candidate.description) || relatedByReference(transaction.description, candidate.description)));
    if (!counterpart || bookMatches.some((group) => group.transactionIds.includes(transaction.id) || group.transactionIds.includes(counterpart.id))) continue;
    bookMatches.push({ key: `books|${transaction.date ?? "unknown"}|${amount.toFixed(2)}|${transaction.id}|${counterpart.id}`, kind: "book_match", transactionIds: [transaction.id, counterpart.id], sources: [transaction.sourceName, counterpart.sourceName!], amount, direction: transaction.direction, date: transaction.date ?? null, descriptions: [transaction.description, counterpart.description] });
  }
  return [...duplicates, ...transfers.filter((group) => group.transactionIds.length > 1), ...bookMatches];
}
