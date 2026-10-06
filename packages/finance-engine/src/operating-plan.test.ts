import { describe, it, expect } from "vitest";
import { evaluateOperatingModel, type OperatingModel } from "./operating-model";
import {
  reviseOperatingInputs,
  planOperatingReplacement,
} from "./operating-plan";
const model: OperatingModel = {
  name: "Synthetic receipts",
  description: "Synthetic",
  startMonth: "2026-10",
  months: 3,
  nodes: [
    {
      id: "receipts",
      label: "Receipts",
      unit: "USD",
      op: "input",
      args: [],
      values: [{ month: "2026-10", value: "20000" }],
      initial: null,
      rationale: "Synthetic",
      evidenceIds: [],
    },
  ],
  outputs: [
    {
      nodeId: "receipts",
      label: "Receipts",
      direction: "receipt",
      category: "other",
    },
  ],
  cases: [],
  limitations: [],
};
const original = evaluateOperatingModel(model),
  bindings = original.cash.map((c, i) => ({
    nodeId: c.nodeId,
    month: c.month,
    amountMinor: c.amountMinor,
    driverId: `driver-${i}`,
  }));
describe("review-linked operating replacements", () => {
  it("keeps captured cash identity and replaces only changed future contributions", () => {
    const revised = reviseOperatingInputs(
      model,
      "base",
      [
        {
          nodeId: "receipts",
          month: "2026-11",
          value: "25000",
          reason: "Reviewed renewal",
        },
      ],
      "2026-10",
    );
    const plan = planOperatingReplacement(
      original,
      revised.operating,
      bindings,
      ["driver-0"],
      "2026-10",
    );
    expect(plan.retained).toEqual([bindings[0]]);
    expect(plan.ended.map((b) => b.month)).toEqual(["2026-11", "2026-12"]);
    expect(plan.additions.map((b) => b.amountMinor)).toEqual([
      "2500000",
      "2500000",
    ]);
    expect(model.nodes[0]!.values).toEqual([
      { month: "2026-10", value: "20000" },
    ]);
  });
  it("does not replace captured obligations, including zeroing their projection", () => {
    for (const value of ["0", "18000", "25000"]) {
      const revised = reviseOperatingInputs(
        model,
        "base",
        [{ nodeId: "receipts", month: "2026-10", value, reason: "Assumption" }],
        "2026-10",
      );
      expect(() =>
        planOperatingReplacement(
          original,
          revised.operating,
          bindings,
          ["driver-0"],
          "2026-10",
        ),
      ).toThrow(/reconciliation/);
    }
  });
  it("preserves history and prohibits past, derived, duplicate, and unowned changes", () => {
    expect(() =>
      reviseOperatingInputs(
        model,
        "base",
        [{ nodeId: "receipts", month: "2026-10", value: "5", reason: "Past" }],
        "2026-11",
      ),
    ).toThrow(/future/);
    const i = {
      nodeId: "receipts",
      month: "2026-11",
      value: "5",
      reason: "Synthetic",
    };
    expect(() =>
      reviseOperatingInputs(model, "base", [i, i], "2026-10"),
    ).toThrow(/distinct/);
    expect(() =>
      planOperatingReplacement(
        original,
        original,
        bindings.slice(1),
        [],
        "2026-10",
      ),
    ).toThrow(/ownership/);
    const revised = reviseOperatingInputs(model, "base", [i], "2026-11");
    expect(revised.operating.values.receipts![0]).toBe("20000");
    expect(
      planOperatingReplacement(
        original,
        revised.operating,
        bindings,
        [],
        "2026-11",
      ).retained,
    ).toEqual([bindings[0]]);
  });
});
