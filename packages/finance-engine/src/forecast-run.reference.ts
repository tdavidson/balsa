/** Slice-1 statement-based forecast, kept verbatim as the equivalence oracle for tests. Never import from production code. */
import { endingCashMinor } from "./cash";
import { buildProjectedEntries, type ForecastDriver, type ForecastEntryTemplate } from "./forecast-projections";
import type { PostedJournalLine } from "./ledger";
import { addMonths, isValidMonth } from "./periods";
import { buildJournalStatements } from "./statements";
import { forecastFormulaVersion, type ForecastAccount, type ForecastNodeKind, type ForecastNode, type ForecastMonth, type ForecastRun } from "./forecast-run";

export type ReferenceForecastRunInput = { actualLines: PostedJournalLine[]; drivers: ForecastDriver[]; templates: ForecastEntryTemplate[]; accounts: ForecastAccount[]; currency: string; asOfMonth: string; horizonMonths: number; minimumCashMinor: string };

const reportedBases = new Set(["actual", "adjustment", "elimination"]);
const monthsBetween = (from: string, to: string) => { const [fromYear, fromMonth] = from.split("-").map(Number); const [toYear, toMonth] = to.split("-").map(Number); return (toYear! - fromYear!) * 12 + (toMonth! - fromMonth!); };
const tenths = (value: bigint) => { const negative = value < 0n; const magnitude = negative ? -value : value; return `${negative ? "-" : ""}${magnitude / 10n}.${magnitude % 10n}`; };
const node = (kind: ForecastNodeKind, month: string, label: string, formula: string, value: string | null, inputNodeIds: string[], driverIds: string[]): ForecastNode => ({ id: `${kind}:${month}`, kind, month, label, formula, formulaVersion: forecastFormulaVersion, value, inputNodeIds, driverIds });

/**
 * Derive the live forecast from posted actuals and confirmed drivers. Nothing
 * here posts: projected lines exist only in this run, so any change to a
 * driver or an actual produces a new, comparable run.
 */
export function buildForecastRunReference(input: ReferenceForecastRunInput): ForecastRun {
  if (!isValidMonth(input.asOfMonth)) throw new Error(`Invalid forecast as-of month: ${input.asOfMonth}`);
  if (!Number.isInteger(input.horizonMonths) || input.horizonMonths < 1) throw new Error("Forecast horizon must be a positive whole number of months.");
  if (!/^\d+$/.test(input.minimumCashMinor)) throw new Error("Minimum cash must be a non-negative minor-unit amount.");
  const horizon = { start: addMonths(input.asOfMonth, 1), end: addMonths(input.asOfMonth, input.horizonMonths) };
  const drivers = [...input.drivers].sort((left, right) => left.id.localeCompare(right.id));
  const templates = [...input.templates].sort((left, right) => left.id.localeCompare(right.id));
  const accountById = new Map(input.accounts.map((account) => [account.accountId, account]));
  const projection = buildProjectedEntries(drivers, templates, horizon);
  const exceptions = [...projection.exceptions];
  const excluded = new Set(exceptions.map((exception) => exception.driverId));
  for (const entry of projection.entries) {
    const missing = entry.lines.find((line) => !accountById.has(line.accountId));
    if (missing && !excluded.has(entry.sourceDriverId)) {
      excluded.add(entry.sourceDriverId);
      exceptions.push({ driverId: entry.sourceDriverId, reason: `Forecast template account ${missing.accountId} is not an active chart account.` });
    }
  }
  const driverById = new Map(drivers.map((driver) => [driver.id, driver]));
  const entries = projection.entries.filter((entry) => !excluded.has(entry.sourceDriverId));
  const projectedLines: PostedJournalLine[] = entries.flatMap((entry) => {
    const driver = driverById.get(entry.sourceDriverId)!;
    return entry.lines.map((line, index) => ({
      ...accountById.get(line.accountId)!,
      id: `${entry.projectionKey}:${index}`, entryId: entry.projectionKey, entrySource: "forecast_run", basis: "forecast" as const,
      currency: input.currency, debitMinor: line.debitMinor, creditMinor: line.creditMinor, postingDate: entry.postingDate, period: entry.period,
      provenance: { sourceLocation: `forecast-driver:${driver.id}`, ...(driver.factId ? { factId: driver.factId } : {}), ...(driver.decisionId ? { decisionId: driver.decisionId } : {}) },
    }));
  });
  const driversByMonth = new Map<string, string[]>();
  for (const entry of entries) driversByMonth.set(entry.period, [...new Set([...(driversByMonth.get(entry.period) ?? []), entry.sourceDriverId])].sort());

  const lines = [...input.actualLines.filter((line) => reportedBases.has(line.basis ?? "actual") && line.period <= input.asOfMonth), ...projectedLines];
  const statementFor = (month: string) => buildJournalStatements(lines, month, undefined, { basis: "all" }).byCurrency.find((candidate) => candidate.currency === input.currency);
  const nodes: ForecastNode[] = [];
  const months: ForecastMonth[] = [];
  const firstMonth = addMonths(input.asOfMonth, -3);
  let opening = endingCashMinor(statementFor(firstMonth));
  nodes.push(node("ending_cash", firstMonth, "Ending cash", "sum(cash asset balances)", opening.toString(), [], []));
  for (let month = addMonths(input.asOfMonth, -2); month <= horizon.end; month = addMonths(month, 1)) {
    const statement = statementFor(month);
    const ending = endingCashMinor(statement);
    const driverIds = driversByMonth.get(month) ?? [];
    months.push({ month, basis: month <= input.asOfMonth ? "actual" : "forecast", openingCashMinor: opening.toString(), endingCashMinor: ending.toString(), receiptsMinor: statement?.cashFlow?.cashReceiptsMinor ?? "0", spendingMinor: statement?.cashFlow?.cashSpendingMinor ?? "0", driverIds });
    nodes.push(node("ending_cash", month, "Ending cash", "sum(cash asset balances)", ending.toString(), [], driverIds));
    nodes.push(node("net_burn", month, "Net burn", "opening cash − ending cash", (opening - ending).toString(), [`ending_cash:${addMonths(month, -1)}`, `ending_cash:${month}`], driverIds));
    opening = ending;
  }

  const trailingMonths = months.filter((month) => month.basis === "actual");
  const trailingBurn = trailingMonths.reduce((sum, month) => sum + BigInt(month.openingCashMinor) - BigInt(month.endingCashMinor), 0n) / 3n;
  const asOfCash = BigInt(months.find((month) => month.month === input.asOfMonth)!.endingCashMinor);
  const ratio = trailingBurn > 0n ? tenths((asOfCash * 10n) / trailingBurn) : null;
  const floor = BigInt(input.minimumCashMinor);
  const cashOutMonth = months.find((month) => month.month >= input.asOfMonth && BigInt(month.endingCashMinor) < floor)?.month ?? null;
  const runwayMonths = cashOutMonth ? Math.max(0, monthsBetween(input.asOfMonth, cashOutMonth) - 1) : null;
  const trailingIds = trailingMonths.map((month) => `net_burn:${month.month}`);
  nodes.push(node("trailing_burn_3m", input.asOfMonth, "Trailing 3-month net burn", "average(net burn, last 3 actual months), truncated to minor units", trailingBurn.toString(), trailingIds, []));
  nodes.push(node("cash_over_trailing_burn", input.asOfMonth, "Cash ÷ trailing burn", "ending cash ÷ trailing burn, truncated to 0.1", ratio, [`ending_cash:${input.asOfMonth}`, `trailing_burn_3m:${input.asOfMonth}`], []));
  const projectedCashIds = months.filter((month) => month.month >= input.asOfMonth).map((month) => `ending_cash:${month.month}`);
  nodes.push(node("cash_out_month", input.asOfMonth, "Cash-out month", `first month with ending cash < ${input.minimumCashMinor}`, cashOutMonth, projectedCashIds, cashOutMonth ? (driversByMonth.get(cashOutMonth) ?? []) : []));
  nodes.push(node("runway_months", input.asOfMonth, "Runway", "full months funded before the cash-out month", runwayMonths === null ? null : String(runwayMonths), [`cash_out_month:${input.asOfMonth}`], []));

  return {
    formulaVersion: forecastFormulaVersion, asOfMonth: input.asOfMonth, horizon, currency: input.currency, months, nodes, projectedLines, drivers, exceptions,
    runway: { cashOutMonth, runwayMonths, trailingBurn3mMinor: trailingBurn.toString(), cashOverTrailingBurn: ratio, minimumCashMinor: input.minimumCashMinor, horizonMonths: input.horizonMonths },
    verificationStatus: exceptions.length ? "exception" : "verified",
  };
}
