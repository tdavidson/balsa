import { buildForecastRun, cashGoalChange, evaluateCashGoal, type ForecastDriver, type ForecastRun, type ForecastRunInput } from "@nevermodel/finance-engine";
import { applyScenarioChanges, type ScenarioChange } from "./scenario-changes";
import type { GoalVersion } from "./goal-review-contract";
/** Ordered replay: scenario items by ID, then the stored change list. Interactions belong to the later step. */
export async function attributeDecision(input: ForecastRunInput, before: ForecastRun, after: ForecastRun, goals: GoalVersion[], drivers: ForecastDriver[], changes: ScenarioChange[], scenarioId: string, prepare: (input: ForecastRunInput) => Promise<ForecastRunInput>) {
  const ordered = [...drivers].sort((a, b) => a.id.localeCompare(b.id));
  const steps: { id: string; label: string; itemIds: string[]; changeIndex: number | null; values: { goalVersionId: string; beforeMinor: string | null; afterMinor: string | null; deltaMinor: string | null }[]; reasons: string[] }[] = [];
  let prior: ForecastRun | null = before;
  for (let index = 0; index < ordered.length + changes.length; index++) {
    const itemCount = Math.min(index + 1, ordered.length); const changeCount = Math.max(0, index + 1 - ordered.length);
    const driver = index < ordered.length ? ordered[index]! : null; const change = changeCount ? changes[changeCount - 1]! : null;
    let next: ForecastRun | null = null; const reasons: string[] = [];
    try { next = buildForecastRun(await prepare(applyScenarioChanges({ ...input, drivers: [...input.drivers, ...ordered.slice(0, itemCount)] }, changes.slice(0, changeCount), scenarioId))); }
    catch { reasons.push("This intermediate model cannot be evaluated. Its contribution remains in the residual."); }
    const values = goals.map((goal) => { const a = prior ? evaluateCashGoal(goal.definition, prior, []) : null; const b = next ? evaluateCashGoal(goal.definition, next, []) : null; return { goalVersionId: goal.id, beforeMinor: a?.valueMinor ?? null, afterMinor: b?.valueMinor ?? null, deltaMinor: a && b ? cashGoalChange(a, b) : null }; });
    steps.push({ id: driver ? `item:${driver.id}` : `change:${changeCount - 1}`, label: driver?.label ?? (change ? `${changeCount}. ${change.kind.replaceAll("_", " ")}` : "Change"), itemIds: driver ? [driver.id] : change && "itemId" in change ? [change.itemId] : [], changeIndex: driver ? null : changeCount - 1, values, reasons });
    prior = next;
  }
  const totals = goals.map((goal) => { const deltaMinor = cashGoalChange(evaluateCashGoal(goal.definition, before, []), evaluateCashGoal(goal.definition, after, [])); const explained = steps.reduce((sum, step) => sum + BigInt(step.values.find((value) => value.goalVersionId === goal.id)?.deltaMinor ?? "0"), 0n); return { goalVersionId: goal.id, deltaMinor, explainedMinor: explained.toString(), residualMinor: deltaMinor === null ? null : (BigInt(deltaMinor) - explained).toString(), complete: deltaMinor !== null && steps.every((step) => step.values.find((value) => value.goalVersionId === goal.id)?.deltaMinor !== null) && BigInt(deltaMinor) === explained }; });
  return { formulaVersion: "ordered-decision-attribution-2026-09-26.1", method: "Scenario items in ID order, then changes in their saved order. Each contribution compares consecutive evaluations of the same goal. Interactions are assigned to the later step; this is a model comparison, not causal evidence.", steps, totals };
}
export type DecisionAttribution = Awaited<ReturnType<typeof attributeDecision>>;
