import {
  evaluateOperatingModel,
  type OperatingModel,
  type OperatingRun,
} from "./operating-model";
import type { OperatingCashBinding } from "./operating-outcomes";
export const operatingPlanVersion = "operating-plan-2026-10-05.1";
export type OperatingPlanInput = {
  nodeId: string;
  month: string;
  value: string;
  reason: string;
};
export function reviseOperatingInputs(
  model: OperatingModel,
  caseId: string,
  inputs: OperatingPlanInput[],
  forecastStart: string,
) {
  if (
    !inputs.length ||
    inputs.length > 40 ||
    new Set(inputs.map((i) => `${i.nodeId}:${i.month}`)).size !== inputs.length
  )
    throw new Error("Choose one to 40 distinct input-month changes.");
  const baseline = evaluateOperatingModel(model, caseId);
  for (const input of inputs) {
    const node = model.nodes.find((n) => n.id === input.nodeId);
    if (
      node?.op !== "input" ||
      !baseline.months.includes(input.month) ||
      input.month < forecastStart ||
      !/^-?\d{1,12}(\.\d{1,6})?$/.test(input.value) ||
      !input.reason.trim()
    )
      throw new Error(
        "Only dated future inputs with exact values and a reason can change.",
      );
  }
  const selected = model.cases.find((c) => c.id === caseId);
  const revised: OperatingModel = {
    ...model,
    cases: [],
    nodes: model.nodes.map((node) => {
      const values =
        selected?.overrides.find((o) => o.nodeId === node.id)?.values ??
        node.values;
      const changes = inputs.filter((i) => i.nodeId === node.id);
      return {
        ...node,
        values: [
          ...values.filter((v) => !changes.some((i) => i.month === v.month)),
          ...changes.map((i) => ({ month: i.month, value: i.value })),
        ].sort((a, b) => a.month.localeCompare(b.month)),
        ...(changes.length
          ? {
              basis: "user_assumption" as const,
              rationale: changes
                .map((i) => `${i.month}: ${i.reason}`)
                .join("; ")
                .slice(0, 2000),
            }
          : {}),
      };
    }),
  };
  return { model: revised, operating: evaluateOperatingModel(revised) };
}
/** Keep each unchanged or historical contribution under its original identity. Captured
 * obligations can never be replaced here, even after final payment or cancellation.
 */
export function planOperatingReplacement(
  original: OperatingRun,
  revised: OperatingRun,
  bindings: OperatingCashBinding[],
  capturedDriverIds: string[],
  forecastStart: string,
) {
  const key = (c: { nodeId: string; month: string }) =>
    `${c.nodeId}:${c.month}`;
  if (
    new Set(bindings.map(key)).size !== bindings.length ||
    new Set(bindings.map((b) => b.driverId)).size !== bindings.length
  )
    throw new Error("Ambiguous operating cash ownership.");
  const captured = new Set(capturedDriverIds),
    retained: OperatingCashBinding[] = [],
    ended: OperatingCashBinding[] = [];
  const additions: OperatingRun["cash"] = [];
  for (const binding of bindings) {
    if (binding.month < forecastStart) {
      retained.push(binding);
      continue;
    }
    const prior = original.cash.find((c) => key(c) === key(binding));
    if (!prior || prior.amountMinor !== binding.amountMinor)
      throw new Error("The applied cash schedule cannot be reproduced.");
    const next = revised.cash.find((c) => key(c) === key(binding));
    const unchanged =
      next &&
      next.amountMinor === binding.amountMinor &&
      next.direction === prior.direction &&
      next.category === prior.category;
    if (unchanged) retained.push(binding);
    else if (captured.has(binding.driverId))
      throw new Error(
        `The ${binding.month} ${prior.label} obligation was reviewed in reconciliation. Keep it unchanged here; review any amount or timing change in reconciliation first.`,
      );
    else ended.push(binding);
  }
  for (const prior of original.cash.filter((c) => c.month >= forecastStart))
    if (!bindings.some((b) => key(b) === key(prior)))
      throw new Error(
        "A future operating contribution has no applied ownership receipt.",
      );
  for (const next of revised.cash.filter((c) => c.month >= forecastStart))
    if (!retained.some((b) => key(b) === key(next))) additions.push(next);
  return {
    formulaVersion: operatingPlanVersion,
    retained,
    ended,
    additions,
    captured: retained.filter((b) => captured.has(b.driverId)),
  };
}
