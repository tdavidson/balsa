import type { RecurrenceState } from "./forecast-recurrence";
import { cashFlowTotals, isCashBalanceRow, resolveCashGroups, wholeMinor, type ActualCashSummary } from "./forecast-actuals";
import { buildProjectedEntries, type ForecastDriver, type ForecastEntryTemplate, type RecognitionProof } from "./forecast-projections";
import type { ForecastedCloseMatch } from "./forecasted-closes";
import { settleForecastLines, type CashSettlementInput, type CashOccurrenceResult } from "./forecast-settlement";
import { monthRange, resolveFormulaDrivers, type ForecastModel, type ForecastModelSummary } from "./forecast-model";
import { resolvePatternDrivers, type PatternContext } from "./driver-patterns";
import type { PostedJournalLine } from "./ledger";
import { addMonths, isValidMonth } from "./periods";

export const forecastFormulaVersion = "forecast-run-2026-10-06.1";

export type ForecastAccount = Pick<PostedJournalLine, "accountId" | "accountCode" | "accountName" | "accountType" | "normalBalance" | "statementSection" | "statementLine" | "balanceTiming" | "cashFlowCategory" | "workingCapitalCategory" | "isCash"> & { /** Resolved Standard statement line, for drivers that reference a line such as total revenue. */ reportLine?: string };
export type ForecastOpenMonth = { month: string; throughDate: string; actualLines: PostedJournalLine[]; forecastedLines: PostedJournalLine[]; matches: ForecastedCloseMatch[] };
export type ForecastRunInput = { recognitionProofs?: RecognitionProof[]; actuals: ActualCashSummary; drivers: ForecastDriver[]; templates: ForecastEntryTemplate[]; accounts: ForecastAccount[]; currency: string; asOfMonth: string; horizonMonths: number; minimumCashMinor: string; /** The open month combines posted actuals through the cutoff with approved remaining expectations. */ openMonth?: ForecastOpenMonth; settlement?: CashSettlementInput; recurrence?: RecurrenceState[]; /** Dimensions and variables that formula drivers read; omitted when the company has none. */ model?: ForecastModel; /** Operating metrics, seasonality profiles and the company escalation that pattern drivers read. */ patterns?: PatternContext };
export type ForecastNodeKind = "ending_cash" | "net_burn" | "trailing_burn_3m" | "cash_over_trailing_burn" | "cash_out_month" | "runway_months";
export type ForecastNode = { id: string; kind: ForecastNodeKind; month: string; label: string; formula: string; formulaVersion: string; value: string | null; inputNodeIds: string[]; driverIds: string[] };
export type ForecastMonth = { month: string; basis: "actual" | "forecast"; openingCashMinor: string; endingCashMinor: string; receiptsMinor: string; spendingMinor: string; driverIds: string[] };
export type ForecastRunway = { cashOutMonth: string | null; runwayMonths: number | null; trailingBurn3mMinor: string; cashOverTrailingBurn: string | null; minimumCashMinor: string; horizonMonths: number };
export type ForecastRun = { formulaVersion: string; asOfMonth: string; horizon: { start: string; end: string }; currency: string; months: ForecastMonth[]; nodes: ForecastNode[]; projectedLines: PostedJournalLine[]; forecastedCloseMatches?: ForecastedCloseMatch[]; settlements?: CashOccurrenceResult[]; drivers: ForecastDriver[]; exceptions: { driverId: string; reason: string }[]; runway: ForecastRunway; verificationStatus: "verified" | "exception"; /** The model variables formula drivers used, with monthly totals; only when a driver has a formula. */ modelSummary?: ForecastModelSummary; /** Operating metric values pattern drivers used, by month; only when a driver has a pattern. */ metrics?: Record<string, Record<string, string>> };

const monthsBetween = (from: string, to: string) => { const [fromYear, fromMonth] = from.split("-").map(Number); const [toYear, toMonth] = to.split("-").map(Number); return (toYear! - fromYear!) * 12 + (toMonth! - fromMonth!); };
const tenths = (value: bigint) => { const negative = value < 0n; const magnitude = negative ? -value : value; return `${negative ? "-" : ""}${magnitude / 10n}.${magnitude % 10n}`; };
const node = (kind: ForecastNodeKind, month: string, label: string, formula: string, value: string | null, inputNodeIds: string[], driverIds: string[]): ForecastNode => ({ id: `${kind}:${month}`, kind, month, label, formula, formulaVersion: forecastFormulaVersion, value, inputNodeIds, driverIds });
/**
 * Derive the live forecast from the posted-actuals cash summary and confirmed
 * drivers. Projected months roll as-of cash forward over projected cash lines,
 * so no statement is built. Nothing here posts: projected lines exist only in
 * this run, so any change to a driver or an actual produces a new, comparable run.
 */
export function buildForecastRun(input: ForecastRunInput): ForecastRun {
  if (!isValidMonth(input.asOfMonth)) throw new Error(`Invalid forecast as-of month: ${input.asOfMonth}`);
  if (!Number.isInteger(input.horizonMonths) || input.horizonMonths < 1) throw new Error("Forecast horizon must be a positive whole number of months.");
  if (!/^\d+$/.test(input.minimumCashMinor)) throw new Error("Minimum cash must be a non-negative minor-unit amount.");
  if (input.actuals.asOfMonth !== input.asOfMonth) throw new Error(`Actuals summary is as of ${input.actuals.asOfMonth}, not the forecast as-of ${input.asOfMonth}.`);
  if (input.actuals.currency !== input.currency) throw new Error(`Actuals summary is in ${input.actuals.currency}, not the forecast currency ${input.currency}.`);
  const horizon = { start: addMonths(input.asOfMonth, 1), end: addMonths(input.asOfMonth, input.horizonMonths) };
  if (input.openMonth && input.openMonth.month !== horizon.start) throw new Error(`Open forecast month must be ${horizon.start}.`);
  const sortedDrivers = [...input.drivers].sort((left, right) => left.id.localeCompare(right.id));
  // Formula drivers take monthly amounts from the model over [as-of, horizon end]; the as-of month is
  // the base for prev. A run without a formula driver takes exactly the fixed-amount path.
  const resolution = sortedDrivers.some((driver) => driver.amountFormula !== undefined) ? resolveFormulaDrivers(sortedDrivers, input.model, monthRange(input.asOfMonth, horizon.end)) : null;
  const formulaDrivers = resolution ? resolution.drivers : sortedDrivers;
  const templates = [...input.templates].sort((left, right) => left.id.localeCompare(right.id));
  // Pattern drivers resolve after formulas, since a pattern may reference a formula driver's amounts.
  const patterns = formulaDrivers.some((driver) => driver.pattern) ? resolvePatternDrivers(formulaDrivers, { months: monthRange(input.asOfMonth, horizon.end), templates, accountLines: new Map(input.accounts.flatMap((account) => account.reportLine ? [[account.accountId, account.reportLine] as const] : [])), ...(input.model ? { model: input.model } : {}), ...(input.patterns ? { context: input.patterns } : {}) }) : null;
  const drivers = patterns ? patterns.drivers : formulaDrivers;
  const unresolved = new Set([...(resolution?.exceptions ?? []), ...(patterns?.exceptions ?? [])].map((exception) => exception.driverId));
  const accountById = new Map(input.accounts.map((account) => [account.accountId, account]));
  const projection = buildProjectedEntries(unresolved.size ? drivers.filter((driver) => !unresolved.has(driver.id)) : drivers, templates, horizon, undefined, input.accounts, input.recognitionProofs?.map((proof) => ({ ...proof, valid: proof.valid && proof.currency === input.currency })));
  const exceptions = [...(resolution?.exceptions ?? []), ...(patterns?.exceptions ?? []), ...projection.exceptions];
  for (const state of input.recurrence ?? []) if (state.state === "stale" || state.pendingCount > 0) exceptions.push({ driverId: state.policy.driverId, reason: state.reason ?? `${state.policy.definition.driver.label}: ${state.pendingCount} recurring expectations are waiting for the next forecast update.` });
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
  const driverProjectedLines: PostedJournalLine[] = entries.flatMap((entry) => {
    const driver = driverById.get(entry.sourceDriverId)!;
    return entry.lines.map((line, index) => ({
      ...accountById.get(line.accountId)!,
      id: `${entry.projectionKey}:${index}`, entryId: entry.projectionKey, entrySource: "forecast_run", basis: "forecast" as const,
      currency: input.currency, debitMinor: line.debitMinor, creditMinor: line.creditMinor, postingDate: entry.postingDate, period: entry.period,
      provenance: { sourceLocation: `forecast-driver:${driver.id}`, ...(driver.factId ? { factId: driver.factId } : {}), ...(driver.decisionId ? { decisionId: driver.decisionId } : {}) },
    }));
  });
  // Historical patterns are suggestions only. Only reviewed occurrence identities
  // replace a driver projection; shared accounts never suppress another obligation.
  const settlement = input.settlement ? settleForecastLines(driverProjectedLines, input.settlement, horizon, input.currency) : null;
  const projectedLines = settlement?.lines ?? driverProjectedLines;
  if (settlement) exceptions.push(...settlement.exceptions);
  const driversByMonth = new Map<string, string[]>();
  for (const entry of entries) driversByMonth.set(entry.period, [...new Set([...(driversByMonth.get(entry.period) ?? []), entry.sourceDriverId])].sort());

  const groups = resolveCashGroups(projectedLines, new Map(input.actuals.cashGroups));
  const projectedByMonth = new Map<string, PostedJournalLine[]>();
  for (const line of projectedLines) projectedByMonth.set(line.period, [...(projectedByMonth.get(line.period) ?? []), line]);
  const nodes: ForecastNode[] = [];
  const months: ForecastMonth[] = [];
  const firstMonth = addMonths(input.asOfMonth, -3);
  const actualMonths = input.actuals.months;
  nodes.push(node("ending_cash", firstMonth, "Ending cash", "sum(cash asset balances)", actualMonths[0]!.openingCashMinor, [], []));
  let opening = BigInt(actualMonths[0]!.openingCashMinor);
  for (let month = addMonths(input.asOfMonth, -2); month <= horizon.end; month = addMonths(month, 1)) {
    const actual = actualMonths.find((candidate) => candidate.month === month);
    const monthLines = projectedByMonth.get(month) ?? [];
    const openActualLines = input.openMonth?.month === month ? input.openMonth.actualLines.filter((line) => !line.postingDate || line.postingDate <= input.openMonth!.throughDate) : [];
    const combinedLines = [...openActualLines, ...monthLines];
    const ending = actual ? BigInt(actual.endingCashMinor) : opening + combinedLines.reduce((sum, line) => sum + (isCashBalanceRow(line, groups) ? wholeMinor(line.debitMinor) - wholeMinor(line.creditMinor) : 0n), 0n);
    const flow = actual ? { receipts: BigInt(actual.receiptsMinor), spending: BigInt(actual.spendingMinor) } : cashFlowTotals(combinedLines);
    const driverIds = driversByMonth.get(month) ?? [];
    months.push({ month, basis: month <= input.asOfMonth ? "actual" : "forecast", openingCashMinor: opening.toString(), endingCashMinor: ending.toString(), receiptsMinor: flow.receipts.toString(), spendingMinor: flow.spending.toString(), driverIds });
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
    formulaVersion: forecastFormulaVersion, asOfMonth: input.asOfMonth, horizon, currency: input.currency, months, nodes, projectedLines, ...(settlement ? { settlements: settlement.results } : {}), drivers, exceptions, ...(resolution ? { modelSummary: resolution.summary } : {}), ...(patterns ? { metrics: patterns.metrics } : {}),
    runway: { cashOutMonth, runwayMonths, trailingBurn3mMinor: trailingBurn.toString(), cashOverTrailingBurn: ratio, minimumCashMinor: input.minimumCashMinor, horizonMonths: input.horizonMonths },
    verificationStatus: exceptions.length ? "exception" : "verified",
  };
}
