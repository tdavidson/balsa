import { formatDecimal, parseDecimal } from "./forecast-model";
import { addMonths } from "./periods";

export const operatingTriggerVersion = "operating-triggers-2026-10-05.1";
export type OperatingTriggerRule =
  | { kind: "review_date"; dueDate: string }
  | {
      kind: "threshold";
      nodeId: string;
      unit: string;
      scope: string;
      measure: "observed" | "difference";
      direction: "above" | "below";
      threshold: string;
      tolerance: string;
      consecutiveMonths: number;
      reportingLagMonths: number;
    };
export type TriggerObservation = {
  month: string;
  observationId: string | null;
  predicted: string | null;
  observed: string | null;
  coverage: string;
  unit: string;
  scope: string | null;
};
export type OperatingTriggerResult = {
  formulaVersion: string;
  status: "triggered" | "clear" | "insufficient_data";
  reason: string;
  window: string[];
  boundary: string | null;
  periods: (TriggerObservation & {
    value: string | null;
    qualifies: boolean | null;
    issue: string | null;
  })[];
};
/** Only explicit reviewed, complete observations in the expected reporting window qualify.
 * A reporting lag shifts the required window; recording an old fact today never makes it fresh.
 * This evaluator never writes accounting or creates a forecast.
 */
export function evaluateOperatingTrigger(
  rule: OperatingTriggerRule,
  observations: TriggerObservation[],
  throughDate: string,
): OperatingTriggerResult {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(throughDate) ||
    !Number.isFinite(Date.parse(throughDate)) ||
    new Date(throughDate).toISOString().slice(0, 10) !== throughDate
  )
    throw new Error("Invalid trigger evaluation date.");
  const base = {
    formulaVersion: operatingTriggerVersion,
    boundary: null,
    periods: [],
    window: [],
  };
  if (rule.kind === "review_date") {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(rule.dueDate) ||
      !Number.isFinite(Date.parse(rule.dueDate)) ||
      new Date(rule.dueDate).toISOString().slice(0, 10) !== rule.dueDate
    )
      throw new Error("Invalid review date.");
    const due = throughDate >= rule.dueDate;
    return {
      ...base,
      status: due ? "triggered" : "clear",
      reason: due
        ? `Review due on ${rule.dueDate}.`
        : `Review is due on ${rule.dueDate}.`,
    };
  }
  const threshold = parseDecimal(rule.threshold),
    tolerance = parseDecimal(rule.tolerance);
  if (
    threshold === null ||
    tolerance === null ||
    tolerance < 0n ||
    !Number.isInteger(rule.consecutiveMonths) ||
    rule.consecutiveMonths < 1 ||
    rule.consecutiveMonths > 6 ||
    !Number.isInteger(rule.reportingLagMonths) ||
    rule.reportingLagMonths < 0 ||
    rule.reportingLagMonths > 3 ||
    !rule.scope.trim() ||
    !rule.unit.trim() ||
    observations.length > 24
  )
    throw new Error("Invalid bounded trigger rule.");
  const end = addMonths(throughDate.slice(0, 7), -1 - rule.reportingLagMonths);
  const window = Array.from({ length: rule.consecutiveMonths }, (_, i) =>
    addMonths(end, i + 1 - rule.consecutiveMonths),
  );
  const boundary =
    rule.direction === "above" ? threshold + tolerance : threshold - tolerance;
  const periods = window.map((month) => {
    const matches = observations.filter((o) => o.month === month);
    const observation = matches[0] ?? {
      month,
      observationId: null,
      predicted: null,
      observed: null,
      coverage: "missing",
      unit: rule.unit,
      scope: null,
    };
    const observed =
      observation.observed === null ? null : parseDecimal(observation.observed);
    const predicted =
      observation.predicted === null
        ? null
        : parseDecimal(observation.predicted);
    const issue =
      matches.length > 1
        ? "Ambiguous observations."
        : !observation.observationId ||
            observation.coverage !== "complete" ||
            observed === null
          ? "A complete, current approved observation is required."
          : observation.unit !== rule.unit || observation.scope !== rule.scope
            ? "The observation's unit or scope does not match the rule."
            : predicted === null
              ? "The preserved prediction is unavailable."
              : null;
    const value = issue
      ? null
      : rule.measure === "difference"
        ? observed! - predicted!
        : observed!;
    return {
      ...observation,
      value: value === null ? null : formatDecimal(value),
      qualifies:
        value === null
          ? null
          : rule.direction === "above"
            ? value > boundary
            : value < boundary,
      issue,
    };
  });
  const missing = periods.some((p) => p.issue !== null);
  const qualifies = periods.every((p) => p.qualifies === true);
  return {
    formulaVersion: operatingTriggerVersion,
    window,
    boundary: formatDecimal(boundary),
    periods,
    status: missing ? "insufficient_data" : qualifies ? "triggered" : "clear",
    reason: missing
      ? "The required reporting window lacks complete, matching evidence."
      : qualifies
        ? `All ${window.length} required months are ${rule.direction} the tolerance boundary.`
        : "The condition is not met in every required month.",
  };
}
