import { describe, it, expect } from "vitest";
import {
  simulateConditionalOperatingPlan as simulate,
  type ConditionalOperatingPlan,
  type KnownOperatingObservation,
} from "./operating-conditional";
import type { OperatingModel, OperatingNode } from "./operating-model";
const node = (id: string, value: string, unit = "units"): OperatingNode => ({
  id,
  label: id,
  unit,
  op: "input",
  args: [],
  values: [{ month: "2026-01", value }],
  initial: null,
  rationale: "Synthetic assumption",
  evidenceIds: [],
});
const model: OperatingModel = {
  name: "Synthetic hiring",
  description: "Synthetic",
  startMonth: "2026-01",
  months: 8,
  nodes: [
    node("demand", "120"),
    node("capacity", "100"),
    node("cost", "10", "USD"),
    node("switch_cost", "0", "USD"),
    {
      ...node("total_cost", "0", "USD"),
      op: "add",
      args: ["cost", "switch_cost"],
      values: [],
    },
  ],
  outputs: [
    {
      nodeId: "total_cost",
      label: "Cost",
      direction: "spend",
      category: "other",
    },
  ],
  cases: [],
  limitations: [],
};
const plan: ConditionalOperatingPlan = {
  startMonth: "2026-01",
  branches: [
    {
      id: "hire",
      name: "Hire",
      rule: {
        kind: "threshold",
        nodeId: "demand",
        unit: "units",
        scope: "Whole business",
        measure: "observed",
        direction: "above",
        threshold: "110",
        tolerance: "0",
        consecutiveMonths: 2,
        reportingLagMonths: 0,
      },
      leadMonths: 1,
      minimumMonths: 2,
      inputs: [
        { nodeId: "capacity", value: "150" },
        { nodeId: "cost", value: "20" },
      ],
      switchCost: null,
      limits: [{ nodeId: "capacity", maximum: "200" }],
      rationale: "Synthetic hiring assumption",
    },
  ],
};
describe("bounded conditional operating plans", () => {
  it("waits for complete prior periods, then honors lead time and the minimum commitment", () => {
    const result = simulate(model, "base", plan, "simulated");
    expect(result.timeline.find((t) => t.status === "scheduled")).toMatchObject(
      { month: "2026-03", decisionMonth: "2026-03" },
    );
    expect(result.timeline.find((t) => t.status === "activated")).toMatchObject(
      { month: "2026-04", decisionMonth: "2026-03", commitThrough: "2026-05" },
    );
    expect(result.operating.values.capacity).toEqual([
      "100",
      "100",
      "100",
      "150",
      "150",
      "150",
      "150",
      "150",
    ]);
    expect(
      result.timeline.filter((t) => t.status === "activated"),
    ).toHaveLength(1);
  });
  it("does not use later-recorded evidence or corrections to justify an earlier decision", () => {
    const observations: KnownOperatingObservation[] = [
      {
        nodeId: "demand",
        month: "2026-01",
        observationId: "january",
        predicted: "120",
        observed: "125",
        coverage: "complete",
        scope: "Whole business",
        unit: "units",
        knownAt: "2026-02-05T00:00:00Z",
      },
      {
        nodeId: "demand",
        month: "2026-02",
        observationId: "february",
        predicted: "120",
        observed: "130",
        coverage: "complete",
        scope: "Whole business",
        unit: "units",
        knownAt: "2026-03-02T00:00:00Z",
      },
    ];
    const actual = simulate(
      model,
      "base",
      plan,
      "observed",
      observations,
      "2026-03-10",
    );
    expect(
      actual.timeline.some(
        (t) => t.status === "activated" || t.status === "scheduled",
      ),
    ).toBe(false);
    const delayed = {
      ...plan,
      branches: plan.branches.map((b) => ({
        ...b,
        rule:
          b.rule.kind === "threshold"
            ? { ...b.rule, reportingLagMonths: 1 }
            : b.rule,
      })),
    };
    const corrected = [
      ...observations,
      {
        ...observations[1]!,
        observationId: "correction",
        observed: "80",
        knownAt: "2026-05-05T00:00:00Z",
        supersedesId: "february",
      },
    ];
    const later = simulate(
      model,
      "base",
      delayed,
      "observed",
      corrected,
      "2026-06-01",
    );
    expect(later.timeline.find((t) => t.status === "scheduled")).toMatchObject({
      month: "2026-04",
    });
    expect(later.timeline.find((t) => t.status === "activated")).toMatchObject({
      month: "2026-05",
    });
  });
  it("blocks resource violations and commitments that exceed the visible horizon", () => {
    const resource = {
      ...plan,
      branches: plan.branches.map((b) => ({
        ...b,
        limits: [{ nodeId: "capacity", maximum: "130" }],
      })),
    };
    expect(
      simulate(model, "base", resource, "simulated").timeline.find(
        (t) => t.status === "blocked",
      )?.reason,
    ).toContain("Resource limit");
    const late = {
      ...plan,
      startMonth: "2026-08",
      branches: plan.branches.map((b) => ({
        ...b,
        leadMonths: 0,
        minimumMonths: 3,
      })),
    };
    expect(
      simulate(model, "base", late, "simulated").timeline[0]?.reason,
    ).toContain("beyond");
  });
  it("keeps switching costs to one period and restores baseline inputs not used by the next branch", () => {
    const first = {
      ...plan.branches[0]!,
      id: "first",
      name: "Outsource",
      rule: { kind: "review_date" as const, dueDate: "2026-01-01" },
      leadMonths: 0,
      minimumMonths: 2,
      inputs: [{ nodeId: "cost", value: "15" }],
    };
    const second = {
      ...plan.branches[0]!,
      rule: { kind: "review_date" as const, dueDate: "2026-03-01" },
      leadMonths: 0,
      switchCost: { nodeId: "switch_cost", value: "5" },
    };
    const result = simulate(
      model,
      "base",
      { startMonth: "2026-01", branches: [second, first] },
      "simulated",
    );
    expect(result.operating.values.total_cost!.slice(0, 5)).toEqual([
      "15",
      "15",
      "25",
      "20",
      "20",
    ]);
  });
});
