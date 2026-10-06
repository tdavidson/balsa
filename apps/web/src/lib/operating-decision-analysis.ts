import {
  addMonths,
  evaluateOperatingModel,
  formatDecimal,
  parseDecimal,
  type ForecastRunInput,
  type OperatingModel,
  type OperatingRun,
} from "@balsa/finance-engine";
import { runSimulation, type ScenarioChange } from "./scenario-changes";
import { operatingDecisionSchema } from "./operating-decision-contract";

export const operatingDecisionVersion = "operating-decision-2026-10-05.1";
export const unchangedCase = "__unchanged__";
const cashChanges = (run: OperatingRun): ScenarioChange[] =>
  run.cash.map((c) => ({
    kind: "add_driver",
    label: c.label,
    direction: c.direction,
    amount: Number(c.amountMinor) / 100,
    cadence: "once",
    effectiveFrom: c.month,
    category: c.category,
  }));
function selected(model: OperatingModel, id: string): OperatingModel {
  if (id === "base") return { ...model, cases: [] };
  const choice = model.cases.find((c) => c.id === id);
  if (!choice) throw new Error("Choose a valid operating alternative.");
  return {
    ...model,
    cases: [],
    nodes: model.nodes.map((node) => ({
      ...node,
      values:
        choice.overrides.find((o) => o.nodeId === node.id)?.values ??
        node.values,
    })),
  };
}
function withInput(
  model: OperatingModel,
  nodeId: string,
  from: string,
  value: string,
) {
  return {
    ...model,
    nodes: model.nodes.map((node) =>
      node.id === nodeId
        ? {
            ...node,
            values: [
              ...node.values.filter((v) => v.month !== from),
              { month: from, value },
            ].sort((a, b) => a.month.localeCompare(b.month)),
          }
        : node,
    ),
  };
}
const abs = (n: bigint) => (n < 0n ? -n : n);
/** Same accounting engine for every point; finite samples do not assert monotonicity or probabilities. */
export function analyzeOperatingDecision(
  input: ForecastRunInput,
  model: OperatingModel,
) {
  const parsed = operatingDecisionSchema.safeParse(model.decision);
  if (!parsed.success)
    throw new Error(
      "Complete the decision question, alternatives, range bounds and cash constraint.",
    );
  const spec = {
    ...parsed.data,
    constraints: parsed.data.constraints.filter(Boolean),
  };
  if (
    spec.deadline &&
    new Date(`${spec.deadline}T00:00:00Z`).toISOString().slice(0, 10) !==
      spec.deadline
  )
    throw new Error("Choose a valid decision deadline.");
  const end = addMonths(model.startMonth, model.months - 1);
  const ids = [unchangedCase, "base", ...model.cases.map((c) => c.id)];
  if (
    !ids.includes(spec.caseId) ||
    !ids.includes(spec.compareCaseId) ||
    spec.caseId === spec.compareCaseId
  )
    throw new Error("Choose two different available alternatives.");
  if (new Set(spec.ranges.map((r) => r.nodeId)).size !== spec.ranges.length)
    throw new Error("Each uncertain input can have one analysis range.");
  const floor = BigInt(spec.cashFloorMinor);
  const simulate = (id: string, changed?: OperatingModel) => {
    const operating =
      id === unchangedCase
        ? null
        : evaluateOperatingModel(changed ?? selected(model, id));
    const { run } = runSimulation(
      input,
      operating ? cashChanges(operating) : [],
    );
    const months = run.months.filter(
      (m) => m.month >= model.startMonth && m.month <= end,
    );
    if (months.length !== model.months)
      throw new Error("The decision horizon must fit within the forecast.");
    const minimum = months.reduce(
      (a, m) => (BigInt(m.endingCashMinor) < a ? BigInt(m.endingCashMinor) : a),
      BigInt(months[0]!.endingCashMinor),
    );
    const ending = BigInt(months.at(-1)!.endingCashMinor);
    return {
      operating,
      months,
      value: spec.metric === "minimum_cash" ? minimum : ending,
      minimum,
      ending,
      exceptions: run.exceptions,
    };
  };
  const choices = ids.map((id) => {
    const result = simulate(id);
    return {
      id,
      name:
        id === unchangedCase
          ? "Do nothing — current forecast"
          : id === "base"
            ? model.name
            : model.cases.find((c) => c.id === id)!.name,
      valueMinor: result.exceptions.length ? null : String(result.value),
      endingCashMinor: String(result.ending),
      minimumCashMinor: String(result.minimum),
      meetsCashFloor: result.exceptions.length ? null : result.minimum >= floor,
      constraints: spec.constraints.map((label) => ({
        label,
        status: "needs_review" as const,
      })),
      exceptions: result.exceptions,
    };
  });
  const left = simulate(spec.caseId);
  const right = simulate(spec.compareCaseId);
  const comparison = {
    leftId: spec.caseId,
    rightId: spec.compareCaseId,
    monthly: left.months.map((m, i) => ({
      month: m.month,
      leftMinor: m.endingCashMinor,
      rightMinor: right.months[i]!.endingCashMinor,
      deltaMinor: String(
        BigInt(m.endingCashMinor) - BigInt(right.months[i]!.endingCashMinor),
      ),
    })),
    outputs: model.outputs.map((o) => ({
      nodeId: o.nodeId,
      label: o.label,
      direction: o.direction,
      months: left.months.map((m) => {
        const l = BigInt(
          left.operating?.cash.find(
            (c) => c.nodeId === o.nodeId && c.month === m.month,
          )?.amountMinor ?? "0",
        );
        const r = BigInt(
          right.operating?.cash.find(
            (c) => c.nodeId === o.nodeId && c.month === m.month,
          )?.amountMinor ?? "0",
        );
        return {
          month: m.month,
          leftMinor: String(l),
          rightMinor: String(r),
          cashEffectMinor: String(
            (l - r) * (o.direction === "receipt" ? 1n : -1n),
          ),
        };
      }),
    })),
    inputs: model.nodes
      .filter((n) => n.op === "input")
      .map((n) => ({
        nodeId: n.id,
        label: n.label,
        unit: n.unit,
        left: left.operating?.values[n.id] ?? null,
        right: right.operating?.values[n.id] ?? null,
        basis: n.basis ?? "unclassified_assumption",
        evidenceIds: n.evidenceIds,
      }))
      .filter((n) => JSON.stringify(n.left) !== JSON.stringify(n.right)),
    exceptions: [...left.exceptions, ...right.exceptions],
    notice:
      "Output differences are accounting contributions, not independent causal effects. Inputs interact through the same operating graph. Do nothing means no incremental model cash, not zero existing operations.",
  };
  const sensitivities = spec.ranges.map((range) => {
    const node = model.nodes.find((n) => n.id === range.nodeId);
    const low = parseDecimal(range.low);
    const high = parseDecimal(range.high);
    if (
      !node ||
      node.op !== "input" ||
      low === null ||
      high === null ||
      low >= high ||
      range.from < model.startMonth ||
      range.from > end
    )
      throw new Error(
        "Each analysis range needs an input, an effective month inside the model, and a lower bound smaller than its upper bound.",
      );
    const points = [
      ...new Set(
        Array.from({ length: 11 }, (_, i) =>
          formatDecimal(low + ((high - low) * BigInt(i)) / 10n),
        ),
      ),
    ].map((value) => {
      try {
        const l = simulate(
          spec.caseId,
          spec.caseId === unchangedCase
            ? undefined
            : withInput(
                selected(model, spec.caseId),
                node.id,
                range.from,
                value,
              ),
        );
        const r = simulate(
          spec.compareCaseId,
          spec.compareCaseId === unchangedCase
            ? undefined
            : withInput(
                selected(model, spec.compareCaseId),
                node.id,
                range.from,
                value,
              ),
        );
        if (l.exceptions.length || r.exceptions.length)
          return {
            value,
            leftMinor: null,
            rightMinor: null,
            deltaMinor: null,
            floorHeadroomMinor: null,
            error: "Accounting exceptions prevent comparison at this value.",
          };
        return {
          value,
          leftMinor: String(l.value),
          rightMinor: String(r.value),
          deltaMinor: String(l.value - r.value),
          floorHeadroomMinor: String(l.minimum - floor),
          error: null,
        };
      } catch {
        return {
          value,
          leftMinor: null,
          rightMinor: null,
          deltaMinor: null,
          floorHeadroomMinor: null,
          error: "Operating calculation is invalid at this value.",
        };
      }
    });
    const crossings: {
      kind: "preference" | "cash_floor";
      low: string;
      high: string;
    }[] = [];
    for (let i = 1; i < points.length; i++) {
      for (const [key, kind] of [
        ["deltaMinor", "preference"],
        ["floorHeadroomMinor", "cash_floor"],
      ] as const) {
        const a = points[i - 1]![key];
        const b = points[i]![key];
        if (
          a !== null &&
          b !== null &&
          !(BigInt(a) === 0n && BigInt(b) === 0n) &&
          (BigInt(a) === 0n ||
            BigInt(b) === 0n ||
            BigInt(a) < 0n !== BigInt(b) < 0n)
        )
          crossings.push({
            kind,
            low: points[i - 1]!.value,
            high: points[i]!.value,
          });
      }
    }
    const values = points.flatMap((p) =>
      p.leftMinor === null ? [] : [BigInt(p.leftMinor)],
    );
    const swing = values.length
      ? values.reduce((a, b) => (a > b ? a : b)) -
        values.reduce((a, b) => (a < b ? a : b))
      : null;
    return {
      ...range,
      label: node.label,
      unit: node.unit,
      points,
      crossings,
      swingMinor: swing === null ? null : String(swing),
      complete: points.every((p) => p.error === null),
      question: `Verify ${node.label} in ${node.unit} from ${range.from}, including whether ${range.low}–${range.high} is a defensible range.`,
      notice:
        "Eleven evenly spaced values at most. Crossings are tested intervals, not exact thresholds; changes between samples can be missed. This input is varied in both alternatives from the selected month, until its next saved input step. Other assumptions stay fixed.",
    };
  });
  const research = [...sensitivities]
    .sort((a, b) => {
      if (a.swingMinor === null) return 1;
      if (b.swingMinor === null) return -1;
      const d = abs(BigInt(b.swingMinor)) - abs(BigInt(a.swingMinor));
      return d > 0n ? 1 : d < 0n ? -1 : a.nodeId.localeCompare(b.nodeId);
    })
    .map((s) => ({
      nodeId: s.nodeId,
      question: s.question,
      swingMinor: s.swingMinor,
      complete: s.complete,
      canChangePreference: s.crossings.some((c) => c.kind === "preference"),
    }));
  return {
    formulaVersion: operatingDecisionVersion,
    spec,
    choices,
    comparison,
    sensitivities,
    research,
    notice:
      "Cash comparisons do not establish the best business decision. Non-cash constraints require review. Sensitivity ranks exposure within your chosen ranges, not probabilities or the monetary value of research.",
  };
}
export type OperatingDecisionAnalysis = ReturnType<
  typeof analyzeOperatingDecision
>;
