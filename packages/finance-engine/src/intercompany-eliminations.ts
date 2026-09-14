import type { PostedJournalLine } from "./ledger";

export type IntercompanyAccountMapping = { id: string; fromEntityId: string; toEntityId: string; receivableAccountId: string; payableAccountId: string; effectiveFrom: string; effectiveTo?: string | null; active?: boolean };
export type IntercompanyEliminationPreview = { period: string; status: "ready" | "nothing_to_eliminate" | "blocked"; blockers: string[]; entries: { key: string; mappingId: string; currency: string; debitMinor: string; creditMinor: string; lines: { accountId: string; entityId?: string; debitMinor: string; creditMinor: string; upstreamLineIds: string[] }[] }[]; exceptions: { mappingId: string; currency: string; receivableMinor: string; payableMinor: string; differenceMinor: string; reason: string; lineIds: string[] }[] };

const amount = (lines: PostedJournalLine[]) => lines.reduce((total, line) => total + BigInt(line.debitMinor) - BigInt(line.creditMinor), 0n);

/**
 * Prepares a consolidated-only elimination for an approved reciprocal map.
 * It refuses partial or unequal balances: an operator must resolve the source
 * mismatch before any consolidation entry can be proposed.
 */
export function previewIntercompanyEliminations(lines: PostedJournalLine[], period: string, mappings: IntercompanyAccountMapping[]): IntercompanyEliminationPreview {
  const entries: IntercompanyEliminationPreview["entries"] = []; const exceptions: IntercompanyEliminationPreview["exceptions"] = [];
  for (const mapping of mappings.filter((candidate) => candidate.active !== false && candidate.effectiveFrom <= period && (!candidate.effectiveTo || candidate.effectiveTo >= period))) {
    const currencies = new Set(lines.filter((line) => line.period <= period && line.basis !== "elimination" && ((line.entityId === mapping.fromEntityId && line.accountId === mapping.receivableAccountId) || (line.entityId === mapping.toEntityId && line.accountId === mapping.payableAccountId))).map((line) => line.currency));
    for (const currency of currencies) {
      const receivableLines = lines.filter((line) => line.period <= period && line.basis !== "elimination" && line.currency === currency && line.entityId === mapping.fromEntityId && line.accountId === mapping.receivableAccountId);
      const payableLines = lines.filter((line) => line.period <= period && line.basis !== "elimination" && line.currency === currency && line.entityId === mapping.toEntityId && line.accountId === mapping.payableAccountId);
      const receivable = amount(receivableLines); const payable = amount(payableLines); const difference = receivable + payable; const lineIds = [...receivableLines, ...payableLines].map((line) => line.id).sort();
      if (receivable === 0n || payable === 0n || difference !== 0n) { exceptions.push({ mappingId: mapping.id, currency, receivableMinor: receivable.toString(), payableMinor: payable.toString(), differenceMinor: difference.toString(), reason: receivable === 0n || payable === 0n ? "One side of the approved reciprocal account map has no balance." : "Mapped intercompany balances do not offset.", lineIds }); continue; }
      const debit = payable < 0n ? -payable : 0n; const credit = receivable > 0n ? receivable : 0n;
      if (debit !== credit) { exceptions.push({ mappingId: mapping.id, currency, receivableMinor: receivable.toString(), payableMinor: payable.toString(), differenceMinor: difference.toString(), reason: "Mapped intercompany balances have unsupported debit/credit orientation.", lineIds }); continue; }
      entries.push({ key: `intercompany-elimination:${period}:${mapping.id}:${currency}`, mappingId: mapping.id, currency, debitMinor: debit.toString(), creditMinor: credit.toString(), lines: [{ accountId: mapping.payableAccountId, debitMinor: debit.toString(), creditMinor: "0", upstreamLineIds: payableLines.map((line) => line.id).sort() }, { accountId: mapping.receivableAccountId, debitMinor: "0", creditMinor: credit.toString(), upstreamLineIds: receivableLines.map((line) => line.id).sort() }] });
    }
  }
  return { period, status: exceptions.length ? "blocked" : entries.length ? "ready" : "nothing_to_eliminate", blockers: exceptions.map((exception) => `${exception.mappingId} (${exception.currency}): ${exception.reason}`), entries, exceptions };
}
