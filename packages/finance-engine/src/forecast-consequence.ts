import type { ForecastDriver } from "./forecast-projections";
import type { ForecastRun } from "./forecast-run";

export type ForecastDriverRef = Pick<ForecastDriver, "id" | "label" | "direction" | "category" | "amountMinor" | "cadence" | "effectiveFrom" | "effectiveTo" | "evidenceId" | "decisionId">;
export type ForecastConsequence = {
  asOfMonth: { before: string | null; after: string };
  /** The as-of month moved. Only months forecast by both runs are compared, so the roll itself is not a cash change. */
  rolledForward: boolean;
  /** The forecast formula version changed since the previous run. Older stored rows lack this field; readers must treat a missing value as false. */
  methodChanged: boolean;
  cash: { month: string; beforeMinor: string | null; afterMinor: string | null; deltaMinor: string }[];
  horizonEndCash: { month: string; beforeMinor: string | null; afterMinor: string; deltaMinor: string };
  cashOutMonth: { before: string | null; after: string | null };
  runwayMonths: { before: number | null; after: number | null };
  projectedReceipts: { beforeMinor: string; afterMinor: string; deltaMinor: string };
  projectedSpending: { beforeMinor: string; afterMinor: string; deltaMinor: string };
  drivers: { added: ForecastDriverRef[]; removed: ForecastDriverRef[]; changed: { before: ForecastDriverRef; after: ForecastDriverRef; fields: string[] }[] };
  exceptions: { before: number; after: number };
};

const comparedFields = ["label", "direction", "category", "amountMinor", "cadence", "effectiveFrom", "effectiveTo"] as const;
const forecastMonths = (run: ForecastRun | null) => (run?.months ?? []).filter((month) => month.basis === "forecast");
const total = (run: ForecastRun | null, field: "receiptsMinor" | "spendingMinor", only: Set<string> | null) => forecastMonths(run).filter((month) => !only || only.has(month.month)).reduce((sum, month) => sum + BigInt(month[field]), 0n);
const pair = (before: bigint, after: bigint) => ({ beforeMinor: before.toString(), afterMinor: after.toString(), deltaMinor: (after - before).toString() });
const ref = (driver: ForecastDriver): ForecastDriverRef => ({ id: driver.id, label: driver.label, direction: driver.direction, amountMinor: driver.amountMinor, cadence: driver.cadence, effectiveFrom: driver.effectiveFrom, ...(driver.category ? { category: driver.category } : {}), ...(driver.effectiveTo ? { effectiveTo: driver.effectiveTo } : {}), ...(driver.evidenceId ? { evidenceId: driver.evidenceId } : {}), ...(driver.decisionId ? { decisionId: driver.decisionId } : {}) });

/** The forward consequence of moving from one forecast run to the next, or null when no headline figure moved. */
export function diffForecastRuns(previous: ForecastRun | null, next: ForecastRun): ForecastConsequence | null {
  const beforeCash = new Map(forecastMonths(previous).map((month) => [month.month, month.endingCashMinor]));
  const afterCash = new Map(forecastMonths(next).map((month) => [month.month, month.endingCashMinor]));
  // When the as-of month moves, the horizons are offset: one-sided months would read as the roll's own cash change.
  const rolledForward = previous !== null && previous.asOfMonth !== next.asOfMonth;
  const methodChanged = previous !== null && previous.formulaVersion !== next.formulaVersion;
  const common = rolledForward ? new Set([...afterCash.keys()].filter((month) => beforeCash.has(month))) : null;
  const months = common ? [...common].sort() : [...new Set([...beforeCash.keys(), ...afterCash.keys()])].sort();
  const cash = months.map((month) => {
    const beforeMinor = beforeCash.get(month) ?? null; const afterMinor = afterCash.get(month) ?? null;
    return { month, beforeMinor, afterMinor, deltaMinor: (BigInt(afterMinor ?? "0") - BigInt(beforeMinor ?? "0")).toString() };
  }).filter((row) => row.deltaMinor !== "0" || row.beforeMinor === null || row.afterMinor === null);
  const endMonth = common ? months.at(-1) ?? next.horizon.end : next.horizon.end;
  const endBefore = beforeCash.get(endMonth) ?? null; const endAfter = afterCash.get(endMonth) ?? "0";
  const endDelta = common && !common.size ? "0" : (BigInt(endAfter) - BigInt(endBefore ?? "0")).toString();
  const beforeDrivers = new Map((previous?.drivers ?? []).map((driver) => [driver.id, driver]));
  const afterDrivers = new Map(next.drivers.map((driver) => [driver.id, driver]));
  const drivers = {
    added: next.drivers.filter((driver) => !beforeDrivers.has(driver.id)).map(ref),
    removed: (previous?.drivers ?? []).filter((driver) => !afterDrivers.has(driver.id)).map(ref),
    changed: next.drivers.flatMap((driver) => {
      const prior = beforeDrivers.get(driver.id);
      const fields = prior ? comparedFields.filter((field) => prior[field] !== driver[field]) : [];
      return prior && fields.length ? [{ before: ref(prior), after: ref(driver), fields: [...fields] }] : [];
    }),
  };
  const consequence: ForecastConsequence = {
    asOfMonth: { before: previous?.asOfMonth ?? null, after: next.asOfMonth },
    rolledForward,
    methodChanged,
    cash,
    horizonEndCash: { month: endMonth, beforeMinor: endBefore, afterMinor: endAfter, deltaMinor: endDelta },
    cashOutMonth: { before: previous?.runway.cashOutMonth ?? null, after: next.runway.cashOutMonth },
    runwayMonths: { before: previous?.runway.runwayMonths ?? null, after: next.runway.runwayMonths },
    projectedReceipts: pair(total(previous, "receiptsMinor", common), total(next, "receiptsMinor", common)),
    projectedSpending: pair(total(previous, "spendingMinor", common), total(next, "spendingMinor", common)),
    drivers,
    exceptions: { before: previous?.exceptions.length ?? 0, after: next.exceptions.length },
  };
  const moved = methodChanged || cash.length > 0 || consequence.cashOutMonth.before !== consequence.cashOutMonth.after || consequence.runwayMonths.before !== consequence.runwayMonths.after
    || consequence.projectedReceipts.deltaMinor !== "0" || consequence.projectedSpending.deltaMinor !== "0" || consequence.exceptions.before !== consequence.exceptions.after;
  return moved ? consequence : null;
}
