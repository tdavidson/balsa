import { formatDecimal, parseDecimal } from "./forecast-model";
import {
  evaluateOperatingModel,
  operatingModelVersion,
  type OperatingModel,
  type OperatingRun,
} from "./operating-model";
import { stableJson } from "./stable-json";
import type { observeOperatingCash } from "./operating-outcomes";

export const operatingVarianceVersion = "operating-variance-2026-10-05.1";
export type VarianceObservation = {
  id: string;
  nodeId: string;
  month: string;
  value: string | null;
  coverage: "complete" | "partial" | "missing" | "unavailable";
};
const decimal = (value: string) => {
  const parsed = parseDecimal(value);
  if (parsed === null) throw new Error("Invalid observation decimal.");
  return parsed;
};
const difference = (after: string, before: string) =>
  formatDecimal(decimal(after) - decimal(before));

/** A measured month replaces only that month. Expand original case schedules first,
 * so observations neither leak forward as new assumptions nor erase case overrides.
 */
function withObservations(
  model: OperatingModel,
  baseline: OperatingRun,
  observations: VarianceObservation[],
): OperatingModel {
  return {
    ...model,
    cases: [],
    nodes: model.nodes.map((node) =>
      node.op !== "input"
        ? node
        : {
            ...node,
            values: baseline.months.map((month, index) => ({
              month,
              value:
                observations.find(
                  (o) => o.nodeId === node.id && o.month === month,
                )?.value ?? baseline.values[node.id]![index]!,
            })),
          },
    ),
  };
}
export type OperatingVariance = ReturnType<typeof explainOperatingVariance>;
export function explainOperatingVariance(
  model: OperatingModel,
  baseline: OperatingRun,
  observations: VarianceObservation[],
  forecastStart: string,
  throughDate: string,
) {
  observations = [...observations].sort(
    (a, b) =>
      a.nodeId.localeCompare(b.nodeId) ||
      a.month.localeCompare(b.month) ||
      a.id.localeCompare(b.id),
  );
  const unavailable = (reason: string) => ({
    status: "unavailable" as const,
    formulaVersion: operatingVarianceVersion,
    reason,
  });
  if (baseline.formulaVersion !== operatingModelVersion)
    return unavailable(
      "The preserved operating formula version cannot be replayed with this evaluator.",
    );
  try {
    if (
      stableJson(evaluateOperatingModel(model, baseline.caseId)) !==
      stableJson(baseline)
    )
      return unavailable(
        "The current evaluator does not reproduce the preserved prediction. The original record remains available.",
      );
    const unique = new Set(observations.map((o) => `${o.nodeId}:${o.month}`));
    if (unique.size !== observations.length || observations.length > 1920)
      return unavailable(
        "Observations must identify unique metrics and periods within the supported model size.",
      );
    if (
      observations.some(
        (o) =>
          !model.nodes.some((n) => n.id === o.nodeId) ||
          !baseline.months.includes(o.month),
      )
    )
      return unavailable(
        "An observation does not belong to the preserved model.",
      );
    const complete = observations.filter(
      (o) =>
        o.coverage === "complete" &&
        o.value !== null &&
        o.month >= forecastStart &&
        o.month < throughDate.slice(0, 7),
    );
    const inputs = complete.filter(
      (o) => model.nodes.find((n) => n.id === o.nodeId)!.op === "input",
    );
    const order = [...new Set(inputs.map((o) => o.nodeId))].sort();
    if (order.length > 12)
      return unavailable(
        "This explanation supports at most 12 observed input variables. No partial attribution was calculated.",
      );
    const revisedModel = withObservations(model, baseline, inputs);
    const revised = evaluateOperatingModel(revisedModel);
    // A deterministic order for conditional effects, plus isolated effects to
    // keep interaction separate rather than calling an order-dependent allocation causal.
    let previous = baseline;
    const steps = order.map((nodeId, index) => {
      const included = inputs.filter((o) =>
        order.slice(0, index + 1).includes(o.nodeId),
      );
      const run = evaluateOperatingModel(
        withObservations(model, baseline, included),
      );
      const isolated = evaluateOperatingModel(
        withObservations(
          model,
          baseline,
          inputs.filter((o) => o.nodeId === nodeId),
        ),
      );
      const step = {
        nodeId,
        label: model.nodes.find((n) => n.id === nodeId)!.label,
        observations: inputs.filter((o) => o.nodeId === nodeId),
        before: previous,
        run,
        isolated,
      };
      previous = run;
      return step;
    });
    const metrics = model.nodes.map((node) => ({
      nodeId: node.id,
      label: node.label,
      unit: node.unit,
      months: baseline.months.flatMap((month, index) => {
        if (month < forecastStart) return [];
        const predicted = baseline.values[node.id]![index]!;
        const modeled = revised.values[node.id]![index]!;
        const observation = observations.find(
          (o) => o.nodeId === node.id && o.month === month,
        );
        const observed =
          complete.find((o) => o.nodeId === node.id && o.month === month)
            ?.value ?? null;
        const contributions = steps.map((step) => ({
          nodeId: step.nodeId,
          isolated: difference(
            step.isolated.values[node.id]![index]!,
            predicted,
          ),
          sequential: difference(
            step.run.values[node.id]![index]!,
            step.before.values[node.id]![index]!,
          ),
        }));
        const joint = decimal(modeled) - decimal(predicted);
        const interaction = formatDecimal(
          joint -
            contributions.reduce((sum, c) => sum + decimal(c.isolated), 0n),
        );
        const residual =
          observed === null ? null : difference(observed, modeled);
        return [
          {
            month,
            predicted,
            modeled,
            observed,
            coverage: observation?.coverage ?? "missing",
            contributions,
            interaction,
            residual,
            totalDifference:
              observed === null ? null : difference(observed, predicted),
            modeledDifference: formatDecimal(joint),
            reconciles:
              observed === null
                ? null
                : decimal(predicted) +
                    contributions.reduce(
                      (sum, c) => sum + decimal(c.isolated),
                      0n,
                    ) +
                    decimal(interaction) +
                    decimal(residual!) ===
                  decimal(observed),
          },
        ];
      }),
    }));
    return {
      status: "available" as const,
      formulaVersion: operatingVarianceVersion,
      order,
      substitutions: inputs,
      excluded: observations
        .filter((o) => !inputs.some((i) => i.id === o.id))
        .map((o) => ({
          id: o.id,
          nodeId: o.nodeId,
          month: o.month,
          reason:
            model.nodes.find((n) => n.id === o.nodeId)?.op !== "input"
              ? "Output observation retained for comparison; derived formulas are not overwritten."
              : "Only complete, current-source observations for finished forecast months can replace an input.",
        })),
      retainedInputIds: model.nodes
        .filter((n) => n.op === "input" && !order.includes(n.id))
        .map((n) => n.id),
      revisedModel,
      revised,
      metrics,
    };
  } catch {
    return unavailable(
      "Observed inputs cannot be evaluated safely under the preserved relationships. Inspect the observations and formulas; no partial explanation was returned.",
    );
  }
}

/** An exact bridge over the allocated cash belonging to the preserved prediction.
 * Amount variance is final only when every obligation touching the month is settled.
 * Timing moves known allocated amounts between months, never inventing day precision.
 */
export function explainOperatingCashTiming(
  cash: ReturnType<typeof observeOperatingCash>,
  nodeId: string,
  months: string[],
) {
  const selected = cash.filter((c) => c.nodeId === nodeId);
  const periods = [
    ...new Set([
      ...months,
      ...selected.flatMap((c) => c.payments.map((p) => p.date.slice(0, 7))),
    ]),
  ].sort();
  return periods.map((month) => {
    const expected = selected.filter((c) => c.month === month);
    const arrivals = selected.flatMap((c) =>
      c.payments
        .filter((p) => p.date.slice(0, 7) === month)
        .map((p) => ({ ...p, originalMonth: c.month, driverId: c.driverId })),
    );
    const relevant = selected.filter(
      (c) =>
        c.month === month ||
        c.payments.some((p) => p.date.slice(0, 7) === month),
    );
    const complete =
      relevant.length > 0 && relevant.every((c) => c.status === "settled");
    const predicted = expected.reduce(
      (sum, c) => sum + BigInt(c.amountMinor),
      0n,
    );
    const allocated = arrivals.reduce(
      (sum, p) => sum + BigInt(p.amountMinor),
      0n,
    );
    const timingIn = arrivals
      .filter((p) => p.originalMonth !== month)
      .reduce((sum, p) => sum + BigInt(p.amountMinor), 0n);
    const timingOut = expected
      .flatMap((c) => c.payments)
      .filter((p) => p.date.slice(0, 7) !== month)
      .reduce((sum, p) => sum + BigInt(p.amountMinor), 0n);
    const amount = complete
      ? expected.reduce(
          (sum, c) =>
            sum + BigInt(c.observedMinor ?? "0") - BigInt(c.amountMinor),
          0n,
        )
      : null;
    return {
      month,
      predictedMinor: String(predicted),
      allocatedMinor: arrivals.length || complete ? String(allocated) : null,
      amountDifferenceMinor: amount === null ? null : String(amount),
      timingInMinor: String(timingIn),
      timingOutMinor: String(-timingOut),
      differenceMinor: complete ? String(allocated - predicted) : null,
      complete,
      reconciles: complete
        ? predicted + amount! + timingIn - timingOut === allocated
        : null,
      payments: arrivals,
      unresolvedDriverIds: relevant
        .filter((c) => c.status !== "settled")
        .map((c) => c.driverId),
    };
  });
}
