import { cashFlowTotals, isCashBalanceRow, resolveCashGroups } from "./forecast-actuals";
import type { PostedJournalLine } from "./ledger";
export type WeeklyCashInput = { throughDate: string; currency: string; actualLines: PostedJournalLine[]; projectedLines: PostedJournalLine[]; reviewedEntryIds: string[]; limitations: string[]; minimumCashMinor: string; weeks?: number };
const date = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const plus = (value: string, days: number) => new Date(Date.parse(`${value}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
/** Journal-derived dated view; overdue items stay unplaced instead of silently moving to today. */
export function buildWeeklyCash(input: WeeklyCashInput) {
  const count = input.weeks ?? 13;
  if (!date(input.throughDate) || !Number.isInteger(count) || count < 1 || count > 26 || !/^\d+$/.test(input.minimumCashMinor)) throw new Error("Invalid weekly cash scope.");
  const groups = resolveCashGroups([...input.actualLines, ...input.projectedLines]);
  const cash = (lines: PostedJournalLine[]) => lines.filter((line) => line.currency === input.currency && isCashBalanceRow(line, groups));
  const actual = cash(input.actualLines.filter((line) => ["actual", "adjustment", "elimination"].includes(line.basis ?? "actual") && (line.postingDate ?? `${line.period}-01`) <= input.throughDate));
  const projected = cash(input.projectedLines); const start = plus(input.throughDate, 1); const end = plus(start, count * 7 - 1);
  const unplaced = projected.filter((line) => !line.postingDate || !date(line.postingDate) || line.postingDate <= input.throughDate);
  const assumed = projected.filter((line) => !input.reviewedEntryIds.includes(line.entryId ?? line.id));
  const reasons = [...input.limitations, ...(unplaced.length ? ["Overdue or undated cash remains outside the dated weekly totals until reviewed."] : []), ...(assumed.length ? ["Some payment dates are monthly schedule assumptions, not reviewed due dates."] : []), ...(actual.some((line) => !line.postingDate) ? ["Some posted actuals have only an accounting month."] : [])];
  let ending = actual.reduce((total, line) => total + BigInt(line.debitMinor) - BigInt(line.creditMinor), 0n);
  const openingCashMinor = String(ending); const weeks = [];
  for (let index = 0; index < count; index++) {
    const from = plus(start, index * 7); const to = plus(from, 6); const opening = ending;
    const lines = projected.filter((line) => line.postingDate && line.postingDate >= from && line.postingDate <= to);
    const movements = cashFlowTotals(lines); ending += movements.receipts - movements.spending;
    let running = opening; let minimum = opening; let firstBreachDate: string | null = opening < BigInt(input.minimumCashMinor) ? from : null;
    for (let offset = 0; offset < 7; offset++) { const day = plus(from, offset); const total = cashFlowTotals(lines.filter((line) => line.postingDate === day)); running += total.receipts - total.spending; if (running < minimum) minimum = running; if (!firstBreachDate && running < BigInt(input.minimumCashMinor)) firstBreachDate = day; }
    weeks.push({ from, to, openingCashMinor: String(opening), receiptsMinor: String(movements.receipts), spendingMinor: String(movements.spending), endingCashMinor: String(ending), minimumDatedCashMinor: String(minimum), firstBreachDate, lineIds: lines.map((line) => line.id), assumedDateLineIds: lines.filter((line) => !input.reviewedEntryIds.includes(line.entryId ?? line.id)).map((line) => line.id) });
  }
  const unplacedMovement = cashFlowTotals(unplaced);
  return { formulaVersion: "dated-weekly-cash-2026-09-26.1", formula: "posted cash through cutoff + dated projected cash receipts - dated projected cash spending; overdue/undated items remain separate", currency: input.currency, throughDate: input.throughDate, start, end, openingCashMinor, weeks, unplaced: unplaced.map((line) => ({ id: line.id, entryId: line.entryId ?? line.id, date: line.postingDate ?? null, memo: line.memo ?? "Cash expectation", debitMinor: line.debitMinor, creditMinor: line.creditMinor })), unplacedNetMinor: String(unplacedMovement.receipts - unplacedMovement.spending), reasons: [...new Set(reasons)], status: reasons.length ? "provisional" as const : "reviewed_dates" as const, inputs: input };
}
