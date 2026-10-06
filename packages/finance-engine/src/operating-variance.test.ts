import { describe, expect, it } from "vitest";
import { evaluateOperatingModel, type OperatingModel } from "./operating-model";
import {
  explainOperatingVariance,
  explainOperatingCashTiming,
  type VarianceObservation,
} from "./operating-variance";
const input = (id: string, value: string, unit = "units") => ({
  id,
  label: id,
  unit,
  op: "input" as const,
  args: [],
  values: [{ month: "2026-10", value }],
  initial: null,
  rationale: "Synthetic assumption",
  evidenceIds: [],
});
const model: OperatingModel = {
  name: "Synthetic quantity and price",
  description: "Explicit quantity, rate, output and one-month collection delay",
  startMonth: "2026-10",
  months: 3,
  nodes: [
    input("quantity", "100"),
    input("rate", "10", "USD/unit"),
    {
      ...input("produced", "0", "USD"),
      op: "multiply",
      args: ["quantity", "rate"],
      values: [],
    },
    {
      ...input("cash", "0", "USD"),
      op: "lag",
      args: ["produced"],
      initial: "0",
      values: [],
    },
  ],
  outputs: [
    {
      nodeId: "cash",
      label: "Collections",
      direction: "receipt",
      category: "other",
    },
  ],
  cases: [],
  limitations: ["Synthetic only"],
};
const observations: VarianceObservation[] = [
  {
    id: "quantity-source",
    nodeId: "quantity",
    month: "2026-10",
    value: "80",
    coverage: "complete",
  },
  {
    id: "rate-source",
    nodeId: "rate",
    month: "2026-10",
    value: "12",
    coverage: "complete",
  },
  {
    id: "output-source",
    nodeId: "produced",
    month: "2026-10",
    value: "900",
    coverage: "complete",
  },
];
function explain(m = model, obs = observations) {
  return explainOperatingVariance(
    m,
    evaluateOperatingModel(m),
    obs,
    "2026-10",
    "2026-11-30",
  );
}
describe("operating variance explanations", () => {
  it("separates isolated effects, interactions and residual with exact reconciliation", () => {
    const result = explain();
    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    const october = result.metrics.find((m) => m.nodeId === "produced")!
      .months[0]!;
    expect(october).toMatchObject({
      predicted: "1000",
      modeled: "960",
      observed: "900",
      interaction: "-40",
      residual: "-60",
      totalDifference: "-100",
      reconciles: true,
    });
    expect(october.contributions).toEqual([
      { nodeId: "quantity", isolated: "-200", sequential: "-200" },
      { nodeId: "rate", isolated: "200", sequential: "160" },
    ]);
    expect(result.order).toEqual(["quantity", "rate"]);
    expect(explain(model, [...observations].reverse())).toEqual(result);
  });
  it("substitutes only measured months while explicit lags carry effects forward", () => {
    const original = structuredClone(model);
    const result = explain();
    if (result.status !== "available") throw Error("Expected valid replay");
    expect(result.revised.values.quantity).toEqual(["80", "100", "100"]);
    expect(result.revised.values.cash).toEqual(["0", "960", "1000"]);
    expect(result.revised.values.produced).toEqual(["960", "1000", "1000"]);
    expect(model).toEqual(original);
  });
  it("honors the selected case and restores its later dated assumptions", () => {
    const alternative: OperatingModel = {
      ...model,
      cases: [
        {
          id: "case",
          name: "Alternative",
          rationale: "Synthetic",
          overrides: [
            {
              nodeId: "quantity",
              values: [
                { month: "2026-10", value: "200" },
                { month: "2026-12", value: "150" },
              ],
            },
          ],
        },
      ],
    };
    const result = explainOperatingVariance(
      alternative,
      evaluateOperatingModel(alternative, "case"),
      observations,
      "2026-10",
      "2026-11-30",
    );
    if (result.status !== "available") throw Error("Expected case replay");
    expect(result.revised.values.quantity).toEqual(["80", "200", "150"]);
  });
  it("retains missing, partial, withdrawn and future inputs as assumptions, and does not override derived results", () => {
    const result = explain(
      model,
      observations.map((o) =>
        o.nodeId === "quantity"
          ? { ...o, coverage: "partial" }
          : o.nodeId === "rate"
            ? { ...o, coverage: "unavailable", value: null }
            : o,
      ),
    );
    if (result.status !== "available") throw Error("Expected comparison");
    expect(result.substitutions).toHaveLength(0);
    expect(
      result.metrics.find((m) => m.nodeId === "produced")!.months[0],
    ).toMatchObject({ modeled: "1000", observed: "900", residual: "-100" });
    const incomplete = explain(
      model,
      observations.map((o) => ({ ...o, coverage: "partial" })),
    );
    if (incomplete.status !== "available") throw Error("Expected comparison");
    expect(
      incomplete.metrics.find((m) => m.nodeId === "produced")!.months[0],
    ).toMatchObject({ observed: null, residual: null, reconciles: null });
    const current = explainOperatingVariance(
      model,
      evaluateOperatingModel(model),
      observations,
      "2026-10",
      "2026-10-31",
    );
    if (current.status !== "available") throw Error("Expected comparison");
    expect(current.substitutions).toHaveLength(0);
  });
  it("refuses incompatible formula versions, corrupted snapshots, invalid substitutions and oversized explanations", () => {
    const baseline = evaluateOperatingModel(model);
    expect(
      explainOperatingVariance(
        model,
        { ...baseline, formulaVersion: "old" },
        observations,
        "2026-10",
        "2026-11-30",
      ).status,
    ).toBe("unavailable");
    expect(
      explainOperatingVariance(
        model,
        {
          ...baseline,
          values: { ...baseline.values, quantity: ["999", "100", "100"] },
        },
        observations,
        "2026-10",
        "2026-11-30",
      ).status,
    ).toBe("unavailable");
    const division = {
      ...model,
      nodes: model.nodes.map((n) =>
        n.id === "produced" ? { ...n, op: "divide" as const } : n,
      ),
    };
    expect(
      explain(division, [{ ...observations[1]!, value: "0" }]).status,
    ).toBe("unavailable");
    const large = {
      ...model,
      nodes: [
        ...model.nodes,
        ...Array.from({ length: 13 }, (_, i) => input(`x${i}`, "1")),
      ],
    };
    expect(
      explain(
        large,
        Array.from({ length: 13 }, (_, i) => ({
          id: `o${i}`,
          nodeId: `x${i}`,
          month: "2026-10",
          value: "2",
          coverage: "complete",
        })),
      ).status,
    ).toBe("unavailable");
  });
  it("bridges final amount and month timing without classifying an open balance as a loss", () => {
    const cash = [
      {
        nodeId: "cash",
        month: "2026-10",
        driverId: "d",
        amountMinor: "2000000",
        observedMinor: "1800000",
        differenceMinor: "-200000",
        status: "settled",
        occurrences: [],
        invalidAllocationIds: [],
        payments: [
          {
            allocationId: "a",
            entryId: "e1",
            date: "2026-10-20",
            amountMinor: "1000000",
          },
          {
            allocationId: "b",
            entryId: "e2",
            date: "2026-11-10",
            amountMinor: "800000",
          },
        ],
      },
    ];
    const complete = explainOperatingCashTiming(cash, "cash", [
      "2026-10",
      "2026-11",
    ]);
    expect(complete[0]).toMatchObject({
      predictedMinor: "2000000",
      amountDifferenceMinor: "-200000",
      timingOutMinor: "-800000",
      allocatedMinor: "1000000",
      differenceMinor: "-1000000",
      reconciles: true,
    });
    expect(complete[1]).toMatchObject({
      predictedMinor: "0",
      timingInMinor: "800000",
      allocatedMinor: "800000",
      reconciles: true,
    });
    const partial = explainOperatingCashTiming(
      cash.map((c) => ({ ...c, status: "partial" })),
      "cash",
      ["2026-10"],
    );
    expect(partial[0]).toMatchObject({
      amountDifferenceMinor: null,
      differenceMinor: null,
      reconciles: null,
      complete: false,
    });
    const finalZero = explainOperatingCashTiming(
      cash.map((c) => ({ ...c, observedMinor: null, payments: [] })),
      "cash",
      ["2026-10"],
    );
    expect(finalZero[0]).toMatchObject({
      allocatedMinor: "0",
      amountDifferenceMinor: "-2000000",
      reconciles: true,
    });
  });
});
