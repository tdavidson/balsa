import { evaluateOperatingModel, type OperatingModel } from "./operating-model";
import {
  evaluateOperatingTrigger,
  type OperatingTriggerRule,
  type TriggerObservation,
} from "./operating-triggers";
import { addMonths } from "./periods";
import { parseDecimal, formatDecimal } from "./forecast-model";
export const operatingConditionalVersion = "operating-conditional-2026-10-05.1";
export type OperatingBranch = {
  id: string;
  name: string;
  rule: OperatingTriggerRule;
  leadMonths: number;
  minimumMonths: number;
  inputs: { nodeId: string; value: string }[];
  switchCost: { nodeId: string; value: string } | null;
  limits: { nodeId: string; maximum: string }[];
  rationale: string;
};
export type ConditionalOperatingPlan = {
  startMonth: string;
  branches: OperatingBranch[];
};
export type KnownOperatingObservation = TriggerObservation & {
  nodeId: string;
  knownAt: string;
  supersedesId?: string | null;
};
/** This is a read-only policy simulation. Only past complete periods are available at a
 * decision point. Observed-mode records also require a knowledge timestamp before it.
 */
export function simulateConditionalOperatingPlan(
  model: OperatingModel,
  caseId: string,
  plan: ConditionalOperatingPlan,
  mode: "simulated" | "observed",
  observations: KnownOperatingObservation[] = [],
  knowledgeCutoff = "9999-12-31",
) {
  const baseline = evaluateOperatingModel(model, caseId);
  if (
    !baseline.months.includes(plan.startMonth) ||
    !plan.branches.length ||
    plan.branches.length > 6 ||
    new Set(plan.branches.map((b) => b.id)).size !== plan.branches.length ||
    observations.length > 2000
  )
    throw new Error(
      "Choose a valid start month and one to six distinct branches.",
    );
  for (const branch of plan.branches) {
    if (
      !branch.id ||
      !branch.name ||
      !branch.rationale.trim() ||
      !Number.isInteger(branch.leadMonths) ||
      branch.leadMonths < 0 ||
      branch.leadMonths > 6 ||
      !Number.isInteger(branch.minimumMonths) ||
      branch.minimumMonths < 1 ||
      branch.minimumMonths > 12 ||
      !branch.inputs.length ||
      branch.inputs.length > 12 ||
      branch.limits.length > 8 ||
      new Set(branch.inputs.map((i) => i.nodeId)).size !== branch.inputs.length
    )
      throw new Error("Invalid bounded branch definition.");
    for (const i of [
      ...branch.inputs,
      ...(branch.switchCost ? [branch.switchCost] : []),
    ])
      if (
        model.nodes.find((n) => n.id === i.nodeId)?.op !== "input" ||
        parseDecimal(i.value) === null
      )
        throw new Error("Branch changes require existing decimal input nodes.");
    if (
      branch.switchCost &&
      (parseDecimal(branch.switchCost.value)! < 0n ||
        plan.branches.some((b) =>
          b.inputs.some((i) => i.nodeId === branch.switchCost!.nodeId),
        ))
    )
      throw new Error("Use a separate nonnegative switching-cost input.");
    const branchRule = branch.rule;
    if (
      branchRule.kind === "threshold" &&
      model.nodes.find((n) => n.id === branchRule.nodeId)?.unit !==
        branchRule.unit
    )
      throw new Error("The branch rule must use the metric's existing unit.");
    for (const limit of branch.limits)
      if (
        !model.nodes.some((n) => n.id === limit.nodeId) ||
        parseDecimal(limit.maximum) === null
      )
        throw new Error(
          "Resource limits require existing nodes and exact bounds.",
        );
  }
  const chosen = model.cases.find((c) => c.id === caseId);
  let current: OperatingModel = {
    ...model,
    cases: [],
    nodes: model.nodes.map((n) => ({
      ...n,
      values:
        chosen?.overrides.find((o) => o.nodeId === n.id)?.values ?? n.values,
    })),
  };
  let run = baseline,
    active = (() => null as OperatingBranch | null)(),
    commitThrough = (() => null as string | null)(),
    pending: {
      branch: OperatingBranch;
      effectiveMonth: string;
      decisionMonth: string;
      evidence: ReturnType<typeof evaluateOperatingTrigger>;
    } | null = null;
  const managed = new Set(
    plan.branches.flatMap((b) => b.inputs.map((i) => i.nodeId)),
  );
  const timeline: {
    month: string;
    decisionMonth: string;
    branchId: string | null;
    branchName: string;
    status: "unchanged" | "scheduled" | "activated" | "committed" | "blocked";
    basis: "simulated" | "observed";
    reason: string;
    commitThrough: string | null;
    evidence: ReturnType<typeof evaluateOperatingTrigger> | null;
  }[] = [];
  function activate(
    branch: OperatingBranch,
    month: string,
    decisionMonth: string,
    evidence: ReturnType<typeof evaluateOperatingTrigger> | null,
  ) {
    const through = addMonths(month, branch.minimumMonths - 1);
    if (through > baseline.months.at(-1)!) {
      timeline.push({
        month,
        decisionMonth,
        branchId: branch.id,
        branchName: branch.name,
        status: "blocked",
        basis: mode,
        reason:
          "The minimum commitment extends beyond the modeled horizon. Extend the horizon before comparing this branch.",
        commitThrough: through,
        evidence,
      });
      return;
    }
    const candidate: OperatingModel = {
      ...current,
      nodes: current.nodes.map((n) => {
        const change = branch.inputs.find((i) => i.nodeId === n.id);
        if (managed.has(n.id))
          return {
            ...n,
            values: [
              ...n.values.filter((v) => v.month < month),
              ...baseline.months
                .filter((m) => m >= month)
                .map((m) => ({
                  month: m,
                  value:
                    change?.value ??
                    baseline.values[n.id]![baseline.months.indexOf(m)]!,
                })),
            ],
          };
        if (active && branch.switchCost?.nodeId === n.id)
          return {
            ...n,
            values: [
              ...n.values.filter((v) => v.month !== month),
              {
                month,
                value: formatDecimal(
                  parseDecimal(
                    run.values[n.id]![baseline.months.indexOf(month)]!,
                  )! + parseDecimal(branch.switchCost.value)!,
                ),
              },
            ].sort((a, b) => a.month.localeCompare(b.month)),
          };
        return n;
      }),
    };
    // Switching cost is a one-period pulse; restore the previously planned value next month.
    if (active && branch.switchCost) {
      const node = candidate.nodes.find(
        (n) => n.id === branch.switchCost!.nodeId,
      )!;
      const next = addMonths(month, 1);
      if (
        baseline.months.includes(next) &&
        !node.values.some((v) => v.month === next)
      )
        node.values = [
          ...node.values,
          {
            month: next,
            value: run.values[node.id]![baseline.months.indexOf(next)]!,
          },
        ].sort((a, b) => a.month.localeCompare(b.month));
    }
    let nextRun;
    try {
      nextRun = evaluateOperatingModel(candidate);
    } catch {
      timeline.push({
        month,
        decisionMonth,
        branchId: branch.id,
        branchName: branch.name,
        status: "blocked",
        basis: mode,
        reason: "The branch produces an unsupported operating calculation.",
        commitThrough: through,
        evidence,
      });
      return;
    }
    const breached = branch.limits.find((l) =>
      baseline.months
        .filter((m) => m >= month && m <= through)
        .some(
          (m) =>
            parseDecimal(
              nextRun.values[l.nodeId]![baseline.months.indexOf(m)]!,
            )! > parseDecimal(l.maximum)!,
        ),
    );
    if (breached) {
      timeline.push({
        month,
        decisionMonth,
        branchId: branch.id,
        branchName: branch.name,
        status: "blocked",
        basis: mode,
        reason: `Resource limit for ${breached.nodeId} would exceed ${breached.maximum} during the minimum commitment.`,
        commitThrough: through,
        evidence,
      });
      return;
    }
    current = candidate;
    run = nextRun;
    active = branch;
    commitThrough = through;
    timeline.push({
      month,
      decisionMonth,
      branchId: branch.id,
      branchName: branch.name,
      status: "activated",
      basis: mode,
      reason: branch.rationale,
      commitThrough,
      evidence,
    });
  }
  for (const month of baseline.months.filter((m) => m >= plan.startMonth)) {
    if (pending) {
      if (pending.effectiveMonth === month) {
        activate(
          pending.branch,
          month,
          pending.decisionMonth,
          pending.evidence,
        );
        pending = null;
      } else
        timeline.push({
          month,
          decisionMonth: pending.decisionMonth,
          branchId: pending.branch.id,
          branchName: pending.branch.name,
          status: "scheduled",
          basis: mode,
          reason: `Waiting for the stated lead time; effective ${pending.effectiveMonth}.`,
          commitThrough: null,
          evidence: null,
        });
      continue;
    }
    if (active && commitThrough && month <= commitThrough) {
      timeline.push({
        month,
        decisionMonth: month,
        branchId: active.id,
        branchName: active.name,
        status: "committed",
        basis: mode,
        reason: "The current branch remains within its minimum commitment.",
        commitThrough,
        evidence: null,
      });
      continue;
    }
    if (mode === "observed" && month > knowledgeCutoff.slice(0, 7)) {
      timeline.push({
        month,
        decisionMonth: month,
        branchId: active?.id ?? null,
        branchName: active?.name ?? "Keep initial plan",
        status: "unchanged",
        basis: mode,
        reason:
          "Future decision: no observations are available at this knowledge cutoff.",
        commitThrough,
        evidence: null,
      });
      continue;
    }
    const known = observations.filter(
      (o) =>
        Number.isFinite(Date.parse(o.knownAt)) &&
        Date.parse(o.knownAt) < Date.parse(`${month}-01T00:00:00.000Z`),
    );
    const replaced = new Set(known.map((o) => o.supersedesId));
    let selected = false;
    for (const branch of plan.branches) {
      const rule = branch.rule;
      const available =
        rule.kind === "threshold"
          ? mode === "simulated"
            ? baseline.months
                .filter((m) => m < month)
                .map((m) => ({
                  month: m,
                  observationId: `simulated:${rule.nodeId}:${m}`,
                  predicted:
                    baseline.values[rule.nodeId]![baseline.months.indexOf(m)]!,
                  observed:
                    run.values[rule.nodeId]![baseline.months.indexOf(m)]!,
                  coverage: "complete",
                  unit: rule.unit,
                  scope: rule.scope,
                }))
            : known.filter(
                (o) =>
                  o.nodeId === rule.nodeId &&
                  o.month < month &&
                  !replaced.has(o.observationId),
              )
          : [];
      const evaluation = evaluateOperatingTrigger(
        rule,
        available,
        `${month}-01`,
      );
      if (evaluation.status !== "triggered") continue;
      if (branch.id === active?.id) {
        selected = true;
        timeline.push({
          month,
          decisionMonth: month,
          branchId: branch.id,
          branchName: branch.name,
          status: "unchanged",
          basis: mode,
          reason:
            "The highest-priority qualifying branch remains the current plan.",
          commitThrough,
          evidence: evaluation,
        });
        break;
      }
      selected = true;
      const effective = addMonths(month, branch.leadMonths);
      if (effective > baseline.months.at(-1)!) {
        timeline.push({
          month,
          decisionMonth: month,
          branchId: branch.id,
          branchName: branch.name,
          status: "blocked",
          basis: mode,
          reason: "The lead time extends beyond the model horizon.",
          commitThrough: null,
          evidence: evaluation,
        });
      } else if (branch.leadMonths) {
        pending = {
          branch,
          effectiveMonth: effective,
          decisionMonth: month,
          evidence: evaluation,
        };
        timeline.push({
          month,
          decisionMonth: month,
          branchId: branch.id,
          branchName: branch.name,
          status: "scheduled",
          basis: mode,
          reason: `Condition met; proposed activation ${effective}.`,
          commitThrough: null,
          evidence: evaluation,
        });
      } else activate(branch, month, month, evaluation);
      break;
    }
    if (!selected)
      timeline.push({
        month,
        decisionMonth: month,
        branchId: active?.id ?? null,
        branchName: active?.name ?? "Keep initial plan",
        status: "unchanged",
        basis: mode,
        reason:
          mode === "observed"
            ? "No eligible complete evidence supports another branch at this decision cutoff."
            : "No other branch condition is met by the simulated past periods.",
        commitThrough,
        evidence: null,
      });
  }
  let checking: OperatingBranch | undefined;
  for (const row of timeline) {
    if (row.status === "activated")
      checking = plan.branches.find((b) => b.id === row.branchId);
    if (checking)
      for (const limit of checking.limits)
        if (
          parseDecimal(
            run.values[limit.nodeId]![baseline.months.indexOf(row.month)]!,
          )! > parseDecimal(limit.maximum)!
        )
          throw new Error(
            `Active branch ${checking.name} exceeds its ${limit.nodeId} resource limit in ${row.month}.`,
          );
  }
  return {
    formulaVersion: operatingConditionalVersion,
    mode,
    plan,
    baseline,
    model: current,
    operating: run,
    timeline,
    notice:
      mode === "simulated"
        ? "Conditions are satisfied by assumed model paths, not observed facts. No branch is approved or applied."
        : "Only observations known before each decision cutoff are eligible. This historical policy comparison does not approve or apply a branch.",
  };
}
