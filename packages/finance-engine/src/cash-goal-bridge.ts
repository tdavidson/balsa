import { buildForecastRun, forecastFormulaVersion, type ForecastRun, type ForecastRunInput } from "./forecast-run";
import { summarizeActualCash } from "./forecast-actuals";
import { evaluateCashGoal, cashGoalChange, type CashGoalEvaluation } from "./cash-goals";
import type { PostedJournalLine } from "./ledger";
import { stableJson } from "./stable-json";

export const cashGoalBridgeFormulaVersion = "cash-goal-bridge-2026-09-25.1";
export type CashBridgeSnapshot = { companyId: string; goalVersionId: string; input: ForecastRunInput; output: ForecastRun; evaluation: CashGoalEvaluation; actualJournalLines: PostedJournalLine[]; coverage?: unknown };
export type CashBridgeStep = {
  category: "calendar" | "actuals" | "expectations" | "treatment" | "assumptions" | "settings";
  label: string; beforeMinor: string; afterMinor: string; deltaMinor: string;
  firstBreachBefore: string | null; firstBreachAfter: string | null;
  minimumMonthBefore: string | null; minimumMonthAfter: string | null;
  references: string[]; changes: string[]; limitations: string[];
};
export type CashGoalBridge = {
  formulaVersion: string; forecastFormulaVersion: string; status: "complete" | "partial" | "unavailable";
  currency: string; beforeMinor: string | null; afterMinor: string | null; deltaMinor: string | null;
  headroomBeforeMinor: string | null; headroomAfterMinor: string | null;
  explainedMinor: string; residualMinor: string | null; steps: CashBridgeStep[];
  coverageChanged: boolean; reasons: string[]; method: string;
};
const minimumMonth = (value: CashGoalEvaluation) => value.goal.metric === "minimum_month_end_cash" ? value.inputs.find((row) => row.endingCashMinor === value.valueMinor)?.month ?? null : null;
const changedIds = <T extends { id: string }>(before: T[], after: T[]) => {
  const a = new Map(before.map((item) => [item.id, item])); const b = new Map(after.map((item) => [item.id, item]));
  return [...new Set([...a.keys(), ...b.keys()])].sort().filter((id) => stableJson(a.get(id) ?? null) !== stableJson(b.get(id) ?? null));
};
const sourceRefs = (lines: PostedJournalLine[]) => lines.flatMap((line) => [line.id, ...Object.values(line.provenance ?? {}).filter((value): value is string => typeof value === "string")]);

/** A fixed-order model attribution, never a claim about isolated real-world causes.
 * Intermediate values are calculated by the same forecast and goal engines.
 * We do not replay a historical formula with today's code and pretend it is unchanged.
 */
export function buildCashGoalBridge(before: CashBridgeSnapshot, after: CashBridgeSnapshot): CashGoalBridge {
  const result: CashGoalBridge = {
    formulaVersion: cashGoalBridgeFormulaVersion, forecastFormulaVersion, status: "unavailable", currency: after.input.currency,
    beforeMinor: before.evaluation.valueMinor, afterMinor: after.evaluation.valueMinor, deltaMinor: null,
    headroomBeforeMinor: before.evaluation.headroomMinor, headroomAfterMinor: after.evaluation.headroomMinor,
    explainedMinor: "0", residualMinor: null, steps: [], coverageChanged: stableJson(before.coverage ?? null) !== stableJson(after.coverage ?? null), reasons: [],
    method: "Fixed order: calendar/cutoff, posted actuals, reviewed expectations and allocations, accounting treatment, driver/model assumptions, other settings. Each step includes its interaction with preceding steps. Intermediate values explain the comparison and are not approved operating forecasts. This is model attribution, not proof of real-world causation.",
  };
  if (before.companyId !== after.companyId || before.goalVersionId !== after.goalVersionId || before.input.currency !== after.input.currency || before.output.currency !== before.input.currency || after.output.currency !== after.input.currency || before.evaluation.goal.currency !== after.input.currency) {
    result.reasons.push("Company, goal version, or currency differs; these values cannot be compared."); return result;
  }
  const delta = cashGoalChange(before.evaluation, after.evaluation);
  if (delta === null) { result.reasons.push("The goal definition, formula, or available periods are incompatible."); return result; }
  result.deltaMinor = delta; result.residualMinor = delta; result.status = "partial";
  if (before.output.formulaVersion !== forecastFormulaVersion || after.output.formulaVersion !== forecastFormulaVersion) {
    result.reasons.push("A saved forecast uses another formula version. Its result is preserved; attribution remains an explicit residual until a compatible replay is available."); return result;
  }
  let input = structuredClone(before.input);
  let value: CashGoalEvaluation;
  const evaluate = (next: ForecastRunInput) => evaluateCashGoal(after.evaluation.goal, buildForecastRun(next), []);
  try { value = evaluate(input); } catch { result.reasons.push("The saved inputs cannot be replayed safely."); return result; }
  if (value.valueMinor !== before.evaluation.valueMinor) { result.reasons.push("Replaying the saved inputs does not reproduce the saved goal value. The difference remains unexplained."); return result; }
  let stopped = false;
  const step = (category: CashBridgeStep["category"], label: string, next: ForecastRunInput, references: string[], changes: string[]) => {
    if (stopped) return;
    let nextValue: CashGoalEvaluation;
    try { nextValue = evaluate(next); } catch { stopped = true; result.reasons.push(`${label}: intermediate calculation is unavailable.`); return; }
    if (nextValue.valueMinor === null) { stopped = true; result.reasons.push(`${label}: required goal periods are unavailable in the intermediate calculation.`); return; }
    const change = (BigInt(nextValue.valueMinor) - BigInt(value.valueMinor!)).toString();
    if (change !== "0" || changes.length || references.length) result.steps.push({ category, label, beforeMinor: value.valueMinor!, afterMinor: nextValue.valueMinor, deltaMinor: change, firstBreachBefore: value.firstBreachMonth, firstBreachAfter: nextValue.firstBreachMonth, minimumMonthBefore: minimumMonth(value), minimumMonthAfter: minimumMonth(nextValue), references: [...new Set(references)].sort(), changes, limitations: nextValue.reasons });
    input = next; value = nextValue;
  };
  const through = after.input.openMonth?.throughDate ?? after.input.settlement?.throughDate ?? `${after.input.asOfMonth}-31`;
  const oldActuals = before.actualJournalLines.filter((line) => !line.postingDate || line.postingDate <= through);
  const calendarChanged = before.input.asOfMonth !== after.input.asOfMonth || before.input.horizonMonths !== after.input.horizonMonths || before.input.openMonth?.throughDate !== after.input.openMonth?.throughDate;
  if (calendarChanged) {
    const next = { ...input, asOfMonth: after.input.asOfMonth, horizonMonths: after.input.horizonMonths, actuals: summarizeActualCash(oldActuals, input.currency, after.input.asOfMonth) };
    if (after.input.openMonth) next.openMonth = { ...after.input.openMonth, actualLines: oldActuals.filter((line) => line.period === after.input.openMonth!.month && line.currency === input.currency), forecastedLines: [], matches: [] };
    else delete next.openMonth;
    if (next.settlement) next.settlement = { ...next.settlement, throughDate: through };
    step("calendar", "Calendar and actuals cutoff", next, [], [`Historical anchor ${before.input.asOfMonth} → ${after.input.asOfMonth}; actuals through ${through}. Expectations that move outside the forecast window are not assumed settled.`]);
  }
  const actualIds = changedIds(before.actualJournalLines, after.actualJournalLines);
  const actualIdSet = new Set(actualIds);
  const actualLines = [...before.actualJournalLines, ...after.actualJournalLines].filter((line) => actualIdSet.has(line.id));
  const actualNext = { ...input, actuals: after.input.actuals };
  if (after.input.openMonth) actualNext.openMonth = after.input.openMonth; else delete actualNext.openMonth;
  if (actualNext.settlement) actualNext.settlement = { ...actualNext.settlement, actuals: after.input.settlement?.actuals ?? [] };
  step("actuals", "Posted actual activity", actualNext, sourceRefs(actualLines), actualIds.length ? [`${actualIds.length} actual journal lines were added, removed, or changed. This can include corrections, reversals, and changed account classification.`] : []);
  const oldSettlement = before.input.settlement; const newSettlement = after.input.settlement;
  const occurrenceIds = changedIds(oldSettlement?.occurrences ?? [], newSettlement?.occurrences ?? []);
  const allocationIds = changedIds(oldSettlement?.allocations ?? [], newSettlement?.allocations ?? []);
  const expectedNext = { ...input }; if (newSettlement) expectedNext.settlement = newSettlement; else delete expectedNext.settlement;
  const expectationChanges = occurrenceIds.map((id) => {
    const a = oldSettlement?.occurrences.find((item) => item.id === id); const b = newSettlement?.occurrences.find((item) => item.id === id);
    return `${b?.label ?? a?.label}: ${a ? `${a.amountMinor} minor units on ${a.expectedDate}, ${a.status}${a.final ? ", final" : ""}` : "not captured"} → ${b ? `${b.amountMinor} minor units on ${b.expectedDate}, ${b.status}${b.final ? ", final" : ""}` : "not captured"}.`;
  });
  if (allocationIds.length) expectationChanges.push(`${allocationIds.length} actual allocations changed; this step includes settlement, timing and final-amount effects together.`);
  step("expectations", "Reviewed expectations and settlement", expectedNext, [...occurrenceIds, ...allocationIds], expectationChanges);
  const treatmentIds = [...changedIds(before.input.templates, after.input.templates), ...changedIds(before.input.accounts.map((account) => ({ ...account, id: account.accountId })), after.input.accounts.map((account) => ({ ...account, id: account.accountId })))];
  step("treatment", "Accounting treatment", { ...input, templates: after.input.templates, accounts: after.input.accounts }, treatmentIds, treatmentIds.length ? ["Approved posting templates or active chart-account metadata changed. Historical classification changes are included with posted actuals above."] : []);
  const driverIds = changedIds(before.input.drivers, after.input.drivers);
  const assumptionChanges = driverIds.map((id) => {
    const a = before.input.drivers.find((item) => item.id === id); const b = after.input.drivers.find((item) => item.id === id);
    return `${b?.label ?? a?.label}: ${a ? `${a.amountFormula ?? `${a.amountMinor} minor units`}, ${a.cadence}, ${a.effectiveFrom}–${a.effectiveTo ?? "open"}` : "absent"} → ${b ? `${b.amountFormula ?? `${b.amountMinor} minor units`}, ${b.cadence}, ${b.effectiveFrom}–${b.effectiveTo ?? "open"}` : "absent"}.`;
  });
  if (stableJson(before.input.model ?? null) !== stableJson(after.input.model ?? null)) assumptionChanges.push("Forecast model variables or dimensions changed; their combined effect is included in this step.");
  const assumptionNext = { ...input, drivers: after.input.drivers }; if (after.input.model) assumptionNext.model = after.input.model; else delete assumptionNext.model;
  step("assumptions", "Driver and model assumptions", assumptionNext, driverIds.flatMap((id) => [id, ...[...before.input.drivers, ...after.input.drivers].filter((driver) => driver.id === id).flatMap((driver) => [driver.evidenceId, driver.factId, driver.decisionId].filter((ref): ref is string => Boolean(ref)))]), assumptionChanges);
  step("settings", "Other forecast settings", after.input, [], []);
  const explained = result.steps.reduce((sum, item) => sum + BigInt(item.deltaMinor), 0n);
  result.explainedMinor = explained.toString(); result.residualMinor = (BigInt(delta) - explained).toString();
  result.status = !stopped && result.residualMinor === "0" ? "complete" : "partial";
  if (result.residualMinor !== "0") result.reasons.push("An unexplained residual remains. The listed contributions do not fully explain the saved-to-current difference.");
  if (result.coverageChanged) result.reasons.push("Coverage or verification limitations changed. No cash effect is invented for a coverage assertion; financial corrections are reflected in actuals or assumptions.");
  return result;
}
