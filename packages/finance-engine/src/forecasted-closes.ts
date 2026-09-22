import type { PostedJournalLine } from "./ledger";
import { addMonths } from "./periods";

export type ForecastedCloseMatch = { forecastId: string; actualEntryId: string; signature: string };
export type ForecastedCloseResult = { projectedLines: PostedJournalLine[]; matches: ForecastedCloseMatch[] };

const actualBases = new Set(["actual"]);
const normalizeMemo = (value: string | undefined) => (value ?? "").toLowerCase().replace(/\d+/g, "#").replace(/[^a-z#]+/g, " ").trim();
const entryId = (line: PostedJournalLine) => line.entryId ?? line.id;
const day = (date: string | undefined) => Number(date?.slice(8, 10) ?? "1");
const median = (values: bigint[]) => [...values].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)[Math.floor(values.length / 2)]!;
const medianNumber = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const daysInMonth = (month: string) => { const [year, number] = month.split("-").map(Number); return new Date(Date.UTC(year!, number!, 0)).getUTCDate(); };

type Event = { id: string; period: string; postingDate?: string; memo: string; signature: string; amount: bigint; lines: PostedJournalLine[] };

function events(lines: PostedJournalLine[]): Event[] {
  const grouped = new Map<string, PostedJournalLine[]>();
  for (const line of lines) {
    if (!actualBases.has(line.basis ?? "actual")) continue;
    const id = entryId(line);
    grouped.set(id, [...(grouped.get(id) ?? []), line]);
  }
  const output: Event[] = [];
  for (const [id, unsortedRows] of grouped) {
    const rows = [...unsortedRows].sort((left, right) => left.id.localeCompare(right.id));
    if (rows.length !== 2 || rows.some((row) => row.currency !== rows[0]!.currency)) continue;
    const debit = rows.find((row) => BigInt(row.debitMinor) > 0n);
    const credit = rows.find((row) => BigInt(row.creditMinor) > 0n);
    if (!debit || !credit || debit.debitMinor !== credit.creditMinor || BigInt(debit.debitMinor) <= 0n) continue;
    const memo = normalizeMemo(rows[0]!.memo);
    // A stable description is required. Account-pair-only recurrence is too broad
    // for accounts such as payroll, travel, and general operating expenses.
    if (memo.length < 3) continue;
    const entity = rows[0]!.entityId ?? "consolidated";
    const signature = [rows[0]!.currency, entity, debit.accountId, credit.accountId, memo].join(":");
    output.push({ id, period: rows[0]!.period, ...(rows[0]!.postingDate ? { postingDate: rows[0]!.postingDate } : {}), memo, signature, amount: BigInt(debit.debitMinor), lines: rows });
  }
  return output;
}

/**
 * Infer conservative current-month closes from three consecutive completed
 * months. A candidate must occur exactly once in every month with the same
 * normalized memo and account pair, and its amounts must stay within 10% of
 * their median. Any current-month actual with that signature settles the
 * expectation, regardless of its final amount.
 */
export function buildForecastedCloses(lines: PostedJournalLine[], currentMonth: string): ForecastedCloseResult {
  const historyMonths = [addMonths(currentMonth, -3), addMonths(currentMonth, -2), addMonths(currentMonth, -1)];
  const all = events(lines);
  const current = all.filter((event) => event.period === currentMonth);
  const bySignature = new Map<string, Event[]>();
  for (const event of all.filter((candidate) => historyMonths.includes(candidate.period))) bySignature.set(event.signature, [...(bySignature.get(event.signature) ?? []), event]);
  const projectedLines: PostedJournalLine[] = [];
  const matches: ForecastedCloseMatch[] = [];
  for (const [signature, observed] of [...bySignature.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (observed.length !== 3 || historyMonths.some((month) => observed.filter((event) => event.period === month).length !== 1)) continue;
    const amount = median(observed.map((event) => event.amount));
    if (observed.some((event) => (event.amount > amount ? event.amount - amount : amount - event.amount) * 10n > amount)) continue;
    const forecastId = `forecasted-close:${signature}:${currentMonth}`;
    const settled = current.find((event) => event.signature === signature);
    if (settled) { matches.push({ forecastId, actualEntryId: settled.id, signature }); continue; }
    const exemplar = observed[observed.length - 1]!;
    const expectedDay = Math.min(medianNumber(observed.map((event) => day(event.postingDate))), daysInMonth(currentMonth));
    const postingDate = `${currentMonth}-${String(expectedDay).padStart(2, "0")}`;
    for (const [index, row] of exemplar.lines.entries()) {
      const isDebit = BigInt(row.debitMinor) > 0n;
      projectedLines.push({ ...row, id: `${forecastId}:${index}`, entryId: forecastId, entrySource: "forecasted_close", basis: "forecast", postingDate, period: currentMonth, memo: `Forecasted close: ${exemplar.memo}`, debitMinor: isDebit ? amount.toString() : "0", creditMinor: isDebit ? "0" : amount.toString(), provenance: { sourceLocation: forecastId } });
    }
  }
  return { projectedLines, matches };
}
