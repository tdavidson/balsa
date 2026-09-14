/** Pure validation for the authoritative journal-posting boundary. */

export type JournalLineInput = {
  id?: string;
  accountId: string;
  entityId?: string;
  currency: string;
  debitMinor: string;
  creditMinor: string;
  externalKey?: string;
};

export type JournalEntryInput = {
  idempotencyKey: string;
  postingDate: string;
  period: string;
  lines: JournalLineInput[];
};

export type JournalValidation = { valid: boolean; errors: string[]; totals: Record<string, { debitMinor: string; creditMinor: string; differenceMinor: string }>; entityTotals: Record<string, { debitMinor: string; creditMinor: string; differenceMinor: string }> };

function minor(value: string) {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) return undefined;
  return BigInt(value);
}

/**
 * Validates the conditions required before a proposal can become a posted
 * journal entry. Uses BigInt so no limit or floating-point rounding is hidden.
 */
export function validateJournalEntry(entry: JournalEntryInput): JournalValidation {
  const errors: string[] = [];
  if (!entry.idempotencyKey.trim()) errors.push("An idempotency key is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.postingDate)) errors.push("Posting date must be YYYY-MM-DD.");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(entry.period)) errors.push("Period must be YYYY-MM.");
  if (entry.lines.length < 2) errors.push("A journal entry requires at least two lines.");
  const totals = new Map<string, { debit: bigint; credit: bigint }>();
  const entityTotals = new Map<string, { debit: bigint; credit: bigint }>();
  const externalKeys = new Set<string>();
  for (const [index, line] of entry.lines.entries()) {
    const prefix = `Line ${index + 1}`;
    if (!line.accountId) errors.push(`${prefix} requires an account.`);
    if (!/^[A-Z]{3}$/.test(line.currency)) errors.push(`${prefix} currency must be an ISO 4217 code.`);
    const debit = minor(line.debitMinor);
    const credit = minor(line.creditMinor);
    if (debit === undefined || credit === undefined) { errors.push(`${prefix} debit and credit must be non-negative integer minor units.`); continue; }
    if ((debit === 0n && credit === 0n) || (debit > 0n && credit > 0n)) errors.push(`${prefix} must have exactly one positive side.`);
    if (line.externalKey) {
      if (externalKeys.has(line.externalKey)) errors.push(`${prefix} repeats an external source key within the entry.`);
      externalKeys.add(line.externalKey);
    }
    const total = totals.get(line.currency) ?? { debit: 0n, credit: 0n };
    total.debit += debit; total.credit += credit; totals.set(line.currency, total);
    const entityKey = `${line.entityId ?? "unassigned"}:${line.currency}`;
    const entityTotal = entityTotals.get(entityKey) ?? { debit: 0n, credit: 0n };
    entityTotal.debit += debit; entityTotal.credit += credit; entityTotals.set(entityKey, entityTotal);
  }
  for (const [currency, total] of totals) if (total.debit !== total.credit) errors.push(`${currency} debits and credits do not balance.`);
  for (const [entityCurrency, total] of entityTotals) if (total.debit !== total.credit) errors.push(`${entityCurrency} debits and credits do not balance.`);
  const printable = Object.fromEntries([...totals.entries()].map(([currency, total]) => [currency, { debitMinor: total.debit.toString(), creditMinor: total.credit.toString(), differenceMinor: (total.debit - total.credit).toString() }]));
  const printableEntityTotals = Object.fromEntries([...entityTotals.entries()].map(([entityCurrency, total]) => [entityCurrency, { debitMinor: total.debit.toString(), creditMinor: total.credit.toString(), differenceMinor: (total.debit - total.credit).toString() }]));
  return { valid: errors.length === 0, errors, totals: printable, entityTotals: printableEntityTotals };
}
