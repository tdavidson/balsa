import type { PostedJournalLine } from "./ledger";
import { addMonths } from "./periods";

export type ActualCashMonth = { month: string; openingCashMinor: string; endingCashMinor: string; receiptsMinor: string; spendingMinor: string };
/** Everything the forecast needs from posted actuals: trailing monthly cash, and which balance groups count as cash. */
export type ActualCashSummary = { currency: string; asOfMonth: string; months: ActualCashMonth[]; cashGroups: [string, boolean][] };

type CashMetadata = Pick<PostedJournalLine, "accountCode" | "accountName" | "accountType" | "statementSection" | "statementLine">;

const reportedBases = new Set(["actual", "adjustment", "elimination"]);
/** ledger.ts `whole`: non-canonical amounts contribute nothing to balances. */
export const wholeMinor = (value: string) => BigInt(/^(?:0|[1-9]\d*)$/.test(value) ? value : "0");
export const balanceSection = (line: { accountType: string; statementSection?: string }) => (line.accountType === "contra" ? line.statementSection : line.accountType);
/** cash.ts `isCashStatementLine`, applied to a statements.ts `aggregate` group. */
export const isBalanceCashGroup = (key: string, label: string) => /\bcash\b/i.test(`${key} ${label}`);
/** statements.ts cash-flow predicate: per line, any section, no word boundary. */
export const isCashFlowLine = (line: { statementLine?: string; accountName: string }) => /cash/.test(`${line.statementLine ?? ""} ${line.accountName}`.toLowerCase());
const groupKey = (row: CashMetadata) => row.statementLine ?? row.accountCode;
const rowKey = (line: Pick<PostedJournalLine, "accountId" | "entityId" | "currency">) => `${line.accountId}:${line.entityId ?? "consolidated"}:${line.currency}`;

/**
 * Cash flag per balance group, as statements.ts `aggregate` decides it. The
 * group label comes from the first trial-balance row by account code, and
 * each row takes its metadata from its lowest-id line.
 */
export function resolveCashGroups(rows: CashMetadata[], known: Map<string, boolean> = new Map()): Map<string, boolean> {
  const groups = new Map(known);
  for (const row of [...rows].sort((left, right) => left.accountCode.localeCompare(right.accountCode))) {
    if (balanceSection(row) !== "asset") continue;
    const key = groupKey(row);
    if (!groups.has(key)) groups.set(key, isBalanceCashGroup(key, row.statementLine ?? row.accountName));
  }
  return groups;
}

/** Receipts and spending for one month's lines: cash movement netted per entry. */
export function cashFlowTotals(lines: Pick<PostedJournalLine, "id" | "entryId" | "statementLine" | "accountName" | "debitMinor" | "creditMinor">[]) {
  const movements = new Map<string, bigint>();
  for (const line of lines) {
    if (!isCashFlowLine(line)) continue;
    const entry = line.entryId ?? line.id;
    movements.set(entry, (movements.get(entry) ?? 0n) + BigInt(line.debitMinor) - BigInt(line.creditMinor));
  }
  let receipts = 0n; let spending = 0n;
  for (const movement of movements.values()) { if (movement >= 0n) receipts += movement; else spending += -movement; }
  return { receipts, spending };
}

/** Is this row's balance counted as cash, given the resolved groups? */
export const isCashBalanceRow = (row: CashMetadata, groups: Map<string, boolean>) => balanceSection(row) === "asset" && groups.get(groupKey(row)) === true;

/**
 * One sorted pass over posted actuals, equivalent to reading ending cash and
 * cash-flow receipts and spending off buildJournalStatements for as-of−2..as-of
 * (opening from as-of−3), without building any statement.
 */
export function summarizeActualCash(lines: PostedJournalLine[], currency: string, asOfMonth: string): ActualCashSummary {
  const included = lines.filter((line) => reportedBases.has(line.basis ?? "actual") && line.period <= asOfMonth && line.currency === currency).sort((left, right) => left.id.localeCompare(right.id));
  const rows = new Map<string, PostedJournalLine>();
  for (const line of included) if (!rows.has(rowKey(line))) rows.set(rowKey(line), line);
  const groups = resolveCashGroups([...rows.values()]);
  const firstMonth = addMonths(asOfMonth, -3);
  const balanceThrough = new Map<string, bigint>();
  let before = 0n;
  const byMonth = new Map<string, PostedJournalLine[]>();
  for (const line of included) {
    const row = rows.get(rowKey(line))!;
    const delta = isCashBalanceRow(row, groups) ? wholeMinor(line.debitMinor) - wholeMinor(line.creditMinor) : 0n;
    if (line.period <= firstMonth) before += delta; else balanceThrough.set(line.period, (balanceThrough.get(line.period) ?? 0n) + delta);
    if (line.period > firstMonth) byMonth.set(line.period, [...(byMonth.get(line.period) ?? []), line]);
  }
  const months: ActualCashMonth[] = [];
  let opening = before;
  for (let month = addMonths(asOfMonth, -2); month <= asOfMonth; month = addMonths(month, 1)) {
    const ending = opening + (balanceThrough.get(month) ?? 0n);
    const flow = cashFlowTotals(byMonth.get(month) ?? []);
    months.push({ month, openingCashMinor: opening.toString(), endingCashMinor: ending.toString(), receiptsMinor: flow.receipts.toString(), spendingMinor: flow.spending.toString() });
    opening = ending;
  }
  return { currency, asOfMonth, months, cashGroups: [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)) };
}
