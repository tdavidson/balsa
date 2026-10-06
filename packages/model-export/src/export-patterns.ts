import { metricForecastBasis, type DriverPattern, type ForecastDriver, type OperatingMetric } from "@balsa/finance-engine";
import type { ExportBasis, ExportPattern, ExportRef } from "./forecast-sheet";

const bases: Record<string, ExportBasis> = { pct_change: "% change", abs_change: "# change", log_change: "log change", pct_of: "% of", per_unit: "# per" };

/** A Balsa pattern in the workbook's driver columns, over the window it runs in. */
export function exportPattern(pattern: DriverPattern, window: { effectiveFrom: string; effectiveTo?: string | null }, profileName: (id: string) => string | null): ExportPattern {
  const change = pattern.change;
  const ref = change && "ref" in change ? change.ref : null;
  const using: ExportRef | null = !ref ? null : ref.kind === "driver" ? { kind: "driver", id: ref.driverId } : ref.kind === "metric" ? { kind: "metric", name: ref.name } : { kind: "line", line: ref.line };
  const escalation = pattern.escalation === "company" ? "company" as const : pattern.escalation ? { rate: Number(pattern.escalation.rate), everyMonths: pattern.escalation.everyMonths, anchorMonth: pattern.escalation.anchor === "driver_start" ? null : pattern.escalation.anchor.calendarMonth } : null;
  return {
    initialValue: Number(pattern.initialValue), startsIn: window.effectiveFrom, endsIn: window.effectiveTo ?? null,
    repeatsEvery: pattern.repeatsEveryMonths, basis: change ? bases[change.basis]! : "",
    changesEvery: change && "everyMonths" in change ? change.everyMonths : null, changingBy: change && "by" in change ? Number(change.by) : null,
    using, maxMonths: pattern.maxMonths ?? null, maxValue: pattern.maxValue !== undefined ? Number(pattern.maxValue) : null,
    seasonality: pattern.seasonalityProfileId ? profileName(pattern.seasonalityProfileId) : null, escalation,
  };
}

/** A fixed-amount driver as the equivalent pattern: its amount, repeating on its cadence. Null when Balsa computes it another way. */
export function driverExportPattern(driver: ForecastDriver, profileName: (id: string) => string | null): ExportPattern | null {
  if (driver.pattern) return exportPattern(driver.pattern, driver, profileName);
  if (driver.amountFormula || driver.amountByMonth || !/^\d+$/.test(driver.amountMinor)) return null;
  const step = { once: 0, monthly: 1, quarterly: 3, annual: 12 }[driver.cadence];
  return { initialValue: Number(BigInt(driver.amountMinor)) / 100, startsIn: driver.effectiveFrom, endsIn: driver.effectiveTo ?? null, repeatsEvery: step, basis: "", changesEvery: null, changingBy: null, using: null, maxMonths: null, maxValue: null, seasonality: null, escalation: null };
}

/** A metric's pattern as it actually runs: a self-growing pattern restarts at its last actual. */
export function metricExportPattern(metric: OperatingMetric, profileName: (id: string) => string | null): ExportPattern {
  const basis = metricForecastBasis(metric);
  return exportPattern(basis.pattern, basis.window, profileName);
}

/** Workbook deltas support same-month cash postings only. */
export function driverValuesOnlyReason(driver: Pick<ForecastDriver, "id" | "accountingTreatment">, reviewedDriverIds: ReadonlySet<string>, unknownSettlements = false): string | null {
  if (driver.accountingTreatment && driver.accountingTreatment !== "cash") return "Recognition schedule: recalculate changes in Balsa";
  if (reviewedDriverIds.has(driver.id) || unknownSettlements) return "Reviewed settlements: recalculate changes in Balsa";
  return null;
}
