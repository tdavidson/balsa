import { describe, expect, it } from "vitest";
import { type OperatingModel } from "@balsa/finance-engine";
import { fixtureBaseInput } from "@/test/forecast-fixture";
import {
  analyzeOperatingDecision,
  unchangedCase,
} from "./operating-decision-analysis";
const input = fixtureBaseInput([]);
const assumption = (id: string, value: string) => ({
  id,
  label: id,
  unit: "USD",
  op: "input" as const,
  args: [],
  values: [{ month: "2026-09", value }],
  initial: null,
  rationale: "Synthetic input",
  evidenceIds: [],
  basis: "user_assumption" as const,
});
const model: OperatingModel = {
  name: "Hire",
  description: "Synthetic decision",
  startMonth: "2026-09",
  months: 3,
  nodes: [assumption("sales", "1000"), assumption("cost", "1500")],
  outputs: [
    {
      nodeId: "sales",
      label: "Sales",
      direction: "receipt",
      category: "other",
    },
    { nodeId: "cost", label: "Cost", direction: "spend", category: "other" },
  ],
  cases: [
    {
      id: "outsource",
      name: "Outsource",
      rationale: "Synthetic alternative",
      overrides: [
        { nodeId: "cost", values: [{ month: "2026-09", value: "2000" }] },
      ],
    },
  ],
  limitations: [],
  decision: {
    question: "Hire or outsource?",
    deadline: "2026-09-15",
    constraints: ["Keep service quality"],
    caseId: "base",
    compareCaseId: unchangedCase,
    metric: "ending_cash",
    cashFloorMinor: "0",
    ranges: [{ nodeId: "sales", from: "2026-09", low: "1000", high: "2000" }],
  },
};
describe("deterministic operating decision analysis", () => {
  it("includes an unchanged baseline and finds a bounded break-even interval without mutating inputs", () => {
    const before = JSON.stringify({ input, model });
    const result = analyzeOperatingDecision(input, model);
    expect(result.choices).toHaveLength(3);
    expect(result.choices[0]?.id).toBe(unchangedCase);
    expect(result.sensitivities[0]?.crossings).toContainEqual({
      kind: "preference",
      low: "1400",
      high: "1500",
    });
    expect(
      result.sensitivities[0]?.points.find((p) => p.value === "1500")
        ?.deltaMinor,
    ).toBe("0");
    expect(result.sensitivities[0]?.swingMinor).toBe("300000");
    expect(result.research[0]?.canChangePreference).toBe(true);
    expect(result.choices[1]?.constraints).toEqual([
      { label: "Keep service quality", status: "needs_review" },
    ]);
    expect(JSON.stringify({ input, model })).toBe(before);
  });
  it("reconciles stream contributions with cumulative cash differences and exposes changed schedules", () => {
    const result = analyzeOperatingDecision(input, {
      ...model,
      decision: { ...model.decision!, compareCaseId: "outsource" },
    });
    let cumulative = 0n;
    for (const month of result.comparison.monthly) {
      cumulative += result.comparison.outputs.reduce(
        (sum, o) =>
          sum +
          BigInt(
            o.months.find((m) => m.month === month.month)!.cashEffectMinor,
          ),
        0n,
      );
      expect(month.deltaMinor).toBe(String(cumulative));
    }
    expect(result.comparison.inputs.map((i) => i.nodeId)).toEqual(["cost"]);
    expect(
      result.sensitivities[0]?.crossings.filter((c) => c.kind === "preference"),
    ).toEqual([]);
  });
  it("does not bridge invalid points or present accounting exceptions as a valid answer", () => {
    const result = analyzeOperatingDecision(input, {
      ...model,
      decision: {
        ...model.decision!,
        ranges: [
          { nodeId: "sales", from: "2026-09", low: "-1000", high: "1000" },
        ],
      },
    });
    expect(result.sensitivities[0]?.complete).toBe(false);
    expect(result.sensitivities[0]?.points[0]?.leftMinor).toBeNull();
    const broken = analyzeOperatingDecision({ ...input, templates: [] }, model);
    expect(broken.choices[1]?.valueMinor).toBeNull();
    expect(broken.sensitivities[0]?.swingMinor).toBeNull();
  });
  it("rejects bad ranges, unknown alternatives, duplicate inputs and impossible deadlines", () => {
    for (const patch of [
      { caseId: "missing" },
      { compareCaseId: "base" },
      { deadline: "2026-02-30" },
      { ranges: [{ nodeId: "sales", from: "2025-01", low: "1", high: "2" }] },
      { ranges: [{ nodeId: "sales", from: "2026-09", low: "2", high: "1" }] },
      { ranges: [model.decision!.ranges[0]!, model.decision!.ranges[0]!] },
    ])
      expect(() =>
        analyzeOperatingDecision(input, {
          ...model,
          decision: { ...model.decision!, ...patch },
        }),
      ).toThrow();
  });
  it("holds later dated steps and other assumptions fixed and labels research as conditional", () => {
    const stepped = {
      ...model,
      nodes: model.nodes.map((n) =>
        n.id === "sales"
          ? { ...n, values: [...n.values, { month: "2026-10", value: "1000" }] }
          : n,
      ),
    };
    const result = analyzeOperatingDecision(input, stepped);
    expect(result.sensitivities[0]?.swingMinor).toBe("100000");
    expect(result.notice).toContain("not probabilities");
  });
  it("finds multiple tested crossings for a nonlinear model without assuming monotonicity", () => {
    const nonlinear: OperatingModel = {
      ...model,
      nodes: [
        assumption("sales", "1000"),
        assumption("center", "1500"),
        assumption("cost", "100000"),
        {
          ...assumption("distance", "0"),
          op: "subtract",
          args: ["sales", "center"],
          values: [],
        },
        {
          ...assumption("receipts", "0"),
          op: "multiply",
          args: ["distance", "distance"],
          values: [],
        },
      ],
      outputs: [
        {
          nodeId: "receipts",
          label: "Nonlinear receipts",
          direction: "receipt",
          category: "other",
        },
        {
          nodeId: "cost",
          label: "Cost",
          direction: "spend",
          category: "other",
        },
      ],
      cases: [],
    };
    const result = analyzeOperatingDecision(input, nonlinear);
    expect(
      result.sensitivities[0]?.crossings.filter((c) => c.kind === "preference"),
    ).toEqual([
      { kind: "preference", low: "1100", high: "1200" },
      { kind: "preference", low: "1800", high: "1900" },
    ]);
  });
});
