import { describe, expect, it } from "vitest";
import { evaluateOperatingModel, validateOperatingModel, type OperatingModel, type OperatingNode, type OperatingOp } from "./operating-model";
const node = (id: string, op: OperatingOp, args: string[] = [], value = "0", initial: string | null = null): OperatingNode => ({ id, label: id, unit: "number", op, args, values: op === "input" ? [{ month: "2026-10", value }] : [], initial, rationale: "Synthetic assumption", evidenceIds: [] });
const workflow = (): OperatingModel => ({ name: "Synthetic delivery", description: "Capacity constrains work; cash arrives one month after delivery.", startMonth: "2026-10", months: 6, nodes: [
  node("zero", "input"), { ...node("demand", "input", [], "300"), values: [{ month: "2026-10", value: "300" }, { month: "2026-11", value: "0" }] }, node("capacity", "input", [], "100"), node("backlog_start", "lag", ["backlog_end"], "0", "0"), node("work", "add", ["backlog_start", "demand"]), node("delivered", "min", ["work", "capacity"]), node("backlog_end", "subtract", ["work", "delivered"]), node("finished", "eq", ["backlog_end", "zero"]), node("was_work", "gt", ["work", "zero"]), node("milestone", "multiply", ["finished", "was_work"]), node("contract", "input", [], "60000"), node("earned", "if", ["milestone", "contract", "zero"]), { ...node("collected", "lag", ["earned"], "0", "0"), unit: "USD" },
], outputs: [{ nodeId: "collected", label: "Contract payment", direction: "receipt", category: "other" }], cases: [{ id: "capacity_up", name: "More capacity", rationale: "Synthetic staffing alternative", overrides: [{ nodeId: "capacity", values: [{ month: "2026-10", value: "150" }] }] }], limitations: ["Costs of extra capacity must be added before making a decision."] });
describe("generic operating model", () => {
  it("propagates workload through capacity and collection, without booking a recurring cumulative receipt", () => {
    const model = workflow(); const original = JSON.stringify(model);
    const run = evaluateOperatingModel(model);
    expect(run.values.backlog_end).toEqual(["200", "100", "0", "0", "0", "0"]);
    expect(run.cash).toMatchObject([{ amountMinor: "6000000", month: "2027-01", nodeId: "collected" }]);
    expect(evaluateOperatingModel(model, "capacity_up").cash[0]?.month).toBe("2026-12");
    expect(JSON.stringify(model)).toBe(original);
  });
  it("supports a different workflow: recurring inventory replenishment with a conditional order", () => {
    const model: OperatingModel = { ...workflow(), nodes: [node("zero", "input"), node("threshold", "input", [], "30"), node("demand", "input", [], "20"), node("batch", "input", [], "50"), node("opening", "lag", ["closing"], "0", "40"), node("low", "gt", ["threshold", "opening"]), node("order", "if", ["low", "batch", "zero"]), node("stock", "add", ["opening", "order"]), node("closing", "subtract", ["stock", "demand"]), node("unit_cost", "input", [], "12.345"), { ...node("purchase", "multiply", ["order", "unit_cost"]), unit: "USD" }], cases: [], outputs: [{ nodeId: "purchase", label: "Inventory purchases", direction: "spend", category: "other" }] };
    const run = evaluateOperatingModel(model);
    expect(run.values.closing).toEqual(["20", "50", "30", "10", "40", "20"]);
    expect(run.cash.map((row) => [row.month, row.amountMinor])).toEqual([["2026-11", "61725"], ["2027-02", "61725"]]);
  });
  it("rejects same-month cycles, missing references, invalid cases and duplicate output mappings", () => {
    const m = workflow();
    for (const model of [
      { ...m, nodes: [...m.nodes, node("cycle", "add", ["cycle", "zero"])] },
      { ...m, nodes: [...m.nodes, node("bad", "lag", ["absent"], "0", "0")] },
      { ...m, outputs: [...m.outputs, ...m.outputs] },
      { ...m, cases: [{ ...m.cases[0]!, overrides: [{ nodeId: "delivered", values: [{ month: "2026-10", value: "10" }] }] }] },
    ]) expect(() => validateOperatingModel(model)).toThrow();
    expect(() => evaluateOperatingModel(m, "unknown")).toThrow();
  });
  it("bounds work and requires starting values instead of silently treating missing inputs as zero", () => {
    const m = workflow();
    expect(() => validateOperatingModel({ ...m, months: 25 })).toThrow();
    expect(() => validateOperatingModel({ ...m, nodes: m.nodes.map((n) => n.id === "capacity" ? { ...n, values: [{ month: "2026-11", value: "100" }] } : n) })).toThrow();
    expect(() => evaluateOperatingModel({ ...m, nodes: [...m.nodes, node("invalid", "divide", ["contract", "zero"])] })).toThrow("Division by zero");
  });
  it("rejects negative cash and preserves deterministic decimal rounding", () => {
    const m = workflow();
    expect(() => evaluateOperatingModel({ ...m, nodes: m.nodes.map((n) => n.id === "contract" ? { ...n, values: [{ month: "2026-10", value: "-1" }] } : n) })).toThrow("negative");
    const run = evaluateOperatingModel({ ...m, nodes: m.nodes.map((n) => n.id === "contract" ? { ...n, values: [{ month: "2026-10", value: "0.005" }] } : n) });
    expect(run.cash[0]?.amountMinor).toBe("1");
    expect(evaluateOperatingModel(m)).toEqual(evaluateOperatingModel(m));
  });
});
