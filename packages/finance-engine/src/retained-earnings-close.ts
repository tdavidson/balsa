import { buildTrialBalance, type PostedJournalLine, type TrialBalanceLine } from "./ledger";
import { selectJournalLinesForReporting } from "./statements";

export type RetainedEarningsAccount = { id: string; code: string; name: string; entityId?: string };
export type RetainedEarningsClosePreviewLine = { key: string; accountId: string; accountCode: string; accountName: string; entityId?: string; currency: string; debitMinor: string; creditMinor: string; /** Immutable journal lines whose remaining balance this close line clears. */ upstreamLineIds: string[] };
export type RetainedEarningsClosePreview = { period: string; status: "ready" | "nothing_to_close" | "blocked"; blockers: string[]; entries: { key: string; currency: string; entityId?: string; retainedEarningsAccountId: string; debitMinor: string; creditMinor: string; lines: RetainedEarningsClosePreviewLine[] }[] };

const section = (line: TrialBalanceLine) => line.accountType === "contra" ? line.statementSection : line.accountType;
const minor = (value: bigint) => value.toString();

/**
 * Build, but never post, a close entry from remaining actual P&L balances.
 * Each proposed line retains the exact immutable journal-line ids it clears.
 */
export function previewRetainedEarningsClose(lines: PostedJournalLine[], period: string, retainedEarningsAccounts: RetainedEarningsAccount[]): RetainedEarningsClosePreview {
  if (!retainedEarningsAccounts.length) return { period, status: "blocked", blockers: ["An active Retained Earnings chart account is required before a close entry can be prepared."], entries: [] };
  const trial = buildTrialBalance(selectJournalLinesForReporting(lines, period, { view: "actual" }).filter((line) => line.entrySource !== "period_close"), period);
  const entries = new Map<string, { currency: string; entityId?: string; account: RetainedEarningsAccount; lines: RetainedEarningsClosePreviewLine[]; debit: bigint; credit: bigint }>();
  const blockers: string[] = [];
  for (const line of trial.lines.filter((candidate) => ["revenue", "expense"].includes(section(candidate) ?? ""))) {
    const balance = BigInt(line.netMinor);
    if (balance === 0n) continue;
    const account = retainedEarningsAccounts.find((candidate) => candidate.entityId === line.entityId) ?? retainedEarningsAccounts.find((candidate) => !candidate.entityId);
    if (!account) { blockers.push(`No Retained Earnings account is configured for ${line.entityId ? `entity ${line.entityId}` : "the consolidated entity"} (${line.currency}).`); continue; }
    const key = `${line.currency}:${line.entityId ?? "consolidated"}:${account.id}`;
    const entry = entries.get(key) ?? { currency: line.currency, ...(line.entityId ? { entityId: line.entityId } : {}), account, lines: [], debit: 0n, credit: 0n };
    // Revenue normally has a credit balance: debit it to zero. Expenses are the inverse.
    const debit = balance < 0n ? -balance : 0n;
    const credit = balance > 0n ? balance : 0n;
    entry.lines.push({ key: `close:${line.accountId}:${line.currency}:${line.entityId ?? "consolidated"}`, accountId: line.accountId, accountCode: line.accountCode, accountName: line.accountName, ...(line.entityId ? { entityId: line.entityId } : {}), currency: line.currency, debitMinor: minor(debit), creditMinor: minor(credit), upstreamLineIds: [...line.lineIds].sort() });
    entry.debit += debit; entry.credit += credit; entries.set(key, entry);
  }
  if (blockers.length) return { period, status: "blocked", blockers: [...new Set(blockers)], entries: [] };
  const output = [...entries.entries()].map(([key, entry]) => {
    const retainedDebit = entry.credit > entry.debit ? entry.credit - entry.debit : 0n;
    const retainedCredit = entry.debit > entry.credit ? entry.debit - entry.credit : 0n;
    const retainedLine: RetainedEarningsClosePreviewLine = { key: `close:${entry.account.id}:${entry.currency}:${entry.entityId ?? "consolidated"}`, accountId: entry.account.id, accountCode: entry.account.code, accountName: entry.account.name, ...(entry.entityId ? { entityId: entry.entityId } : {}), currency: entry.currency, debitMinor: minor(retainedDebit), creditMinor: minor(retainedCredit), upstreamLineIds: entry.lines.flatMap((line) => line.upstreamLineIds).sort() };
    return { key: `period-close:${period}:${key}`, currency: entry.currency, ...(entry.entityId ? { entityId: entry.entityId } : {}), retainedEarningsAccountId: entry.account.id, debitMinor: minor(entry.debit + retainedDebit), creditMinor: minor(entry.credit + retainedCredit), lines: [...entry.lines, retainedLine] };
  });
  return { period, status: output.length ? "ready" : "nothing_to_close", blockers: [], entries: output };
}
