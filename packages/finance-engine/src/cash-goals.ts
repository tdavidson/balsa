import type { ForecastRun } from "./forecast-run";
import { isValidMonth } from "./periods";
import { monthRange } from "./forecast-model";
import { stableJson } from "./stable-json";

export const cashGoalFormulaVersion = "cash-goal-2026-09-25.1";
export type CashGoal = {
  name: string;
  metric: "ending_cash_at_month" | "minimum_month_end_cash";
  currency: string;
  startMonth: string;
  endMonth: string;
  targetMinor: string;
  manualConditions?: { id: string; label: string }[] | undefined;
};
export type CashGoalEvaluation = {
  formulaVersion: string;
  formula: string;
  goal: CashGoal;
  valueMinor: string | null;
  headroomMinor: string | null;
  firstBreachMonth: string | null;
  outcome: "meets_target" | "below_target" | "unavailable";
  basis: "actual" | "projected" | "mixed" | "unavailable";
  assurance: "supported" | "provisional" | "unavailable";
  reasons: string[];
  inputs: { month: string; endingCashMinor: string; basis: "actual" | "forecast"; nodeId: string }[];
};

export function cashGoalChange(before: CashGoalEvaluation, after: CashGoalEvaluation): string | null {
  if (before.formulaVersion !== after.formulaVersion || stableJson(before.goal) !== stableJson(after.goal) || before.valueMinor === null || after.valueMinor === null) return null;
  return (BigInt(after.valueMinor) - BigInt(before.valueMinor)).toString();
}

/** Amounts stay in integer minor units. A goal never changes the forecast input. */
export function evaluateCashGoal(goal: CashGoal, run: ForecastRun, coverageReasons: string[]): CashGoalEvaluation {
  const result: CashGoalEvaluation = {
    formulaVersion: cashGoalFormulaVersion,
    formula: goal.metric === "ending_cash_at_month" ? "ending_cash(endMonth) - targetMinor" : "min(ending_cash(startMonth..endMonth)) - targetMinor",
    goal: { ...goal }, valueMinor: null, headroomMinor: null, firstBreachMonth: null,
    outcome: "unavailable", basis: "unavailable", assurance: "unavailable", reasons: [], inputs: [],
  };
  const fail = (reason: string) => ({ ...result, reasons: [reason] });
  if (!["ending_cash_at_month", "minimum_month_end_cash"].includes(goal.metric) || !isValidMonth(goal.startMonth) || !isValidMonth(goal.endMonth) || goal.startMonth > goal.endMonth || !/^(0|[1-9]\d{0,29})$/.test(goal.targetMinor)) return fail("Invalid cash goal definition.");
  if (goal.currency !== run.currency) return fail("Goal and forecast currencies differ.");
  // Bound even direct callers; do not construct an unbounded date range.
  const distance = (Number(goal.endMonth.slice(0, 4)) - Number(goal.startMonth.slice(0, 4))) * 12 + Number(goal.endMonth.slice(5)) - Number(goal.startMonth.slice(5));
  if (distance > 120) return fail("Goal interval exceeds 120 months.");
  const months = goal.metric === "ending_cash_at_month" ? [goal.endMonth] : monthRange(goal.startMonth, goal.endMonth);
  for (const month of months) {
    const matches = run.months.filter((candidate) => candidate.month === month);
    if (matches.length !== 1 || !/^-?\d+$/.test(matches[0]!.endingCashMinor)) return fail("Required months are outside the available calculation or contain invalid values.");
    const row = matches[0]!;
    result.inputs.push({ month, endingCashMinor: row.endingCashMinor, basis: row.basis, nodeId: `ending_cash:${month}` });
  }
  const values = result.inputs.map((row) => BigInt(row.endingCashMinor));
  const value = values.reduce((minimum, next) => next < minimum ? next : minimum);
  const target = BigInt(goal.targetMinor);
  const reasons = [...coverageReasons, ...run.exceptions.map((exception) => exception.reason)];
  if (run.verificationStatus !== "verified" && !run.exceptions.length) reasons.push("The forecast calculation has unresolved exceptions.");
  return {
    ...result, valueMinor: value.toString(), headroomMinor: (value - target).toString(),
    firstBreachMonth: result.inputs.find((row) => BigInt(row.endingCashMinor) < target)?.month ?? null,
    outcome: value >= target ? "meets_target" : "below_target",
    basis: result.inputs.every((row) => row.basis === "actual") ? "actual" : result.inputs.every((row) => row.basis === "forecast") ? "projected" : "mixed",
    assurance: reasons.length ? "provisional" : "supported", reasons: [...new Set(reasons)],
  };
}
