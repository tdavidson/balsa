import { describe, expect, it } from "vitest";
import { mergeModelDraft, rowsToModel, variableFromDraft, withDimension, withoutDimension, withoutVariable, withVariable } from "./forecast-model-rows";

const team = { name: "team", items: ["Eng", "Sales"] };
const headcount = { name: "headcount", kind: "number" as const, dims: ["team"], formula: null, inputs: [{ coords: { team: "Eng" }, from: "2026-09", value: "3" }] };
const payroll = { name: "payroll", kind: "money" as const, dims: ["team"], formula: "headcount * salary", inputs: [] };

describe("forecast model rows", () => {
  it("maps no rows to no model, so a company without one keeps its input hash", () => {
    expect(rowsToModel([], [])).toBeUndefined();
  });

  it("maps rows canonically: names sorted, formula only when set", () => {
    const model = rowsToModel([{ name: "region", items: ["US", "EU"] }, team], [payroll, headcount])!;
    expect(model.dimensions.map((dimension) => dimension.name)).toEqual(["region", "team"]);
    expect(model.dimensions[0]!.items).toEqual(["US", "EU"]);
    expect(model.variables).toEqual([
      { name: "headcount", kind: "number", dims: ["team"], inputs: [{ coords: { team: "Eng" }, from: "2026-09", value: "3" }] },
      { name: "payroll", kind: "money", dims: ["team"], formula: "headcount * salary", inputs: [] },
    ]);
    expect(variableFromDraft(headcount)).not.toHaveProperty("formula");
  });

  it("adds, replaces, renames, and removes by name", () => {
    const model = rowsToModel([team], [headcount])!;
    expect(withVariable(model, payroll).variables.map((variable) => variable.name)).toEqual(["headcount", "payroll"]);
    expect(withVariable(model, { ...headcount, name: "heads" }, "headcount").variables.map((variable) => variable.name)).toEqual(["heads"]);
    expect(withoutVariable(model, "headcount").variables).toEqual([]);
    expect(withDimension(model, { name: "team", items: ["Eng"] }).dimensions).toEqual([{ name: "team", items: ["Eng"] }]);
    expect(withoutDimension(model, "team").dimensions).toEqual([]);
    expect(mergeModelDraft(model, { dimensions: [{ name: "region", items: ["EU"] }], variables: [{ ...payroll, name: "cost", replaces: "missing" }] }).variables.map((variable) => variable.name)).toEqual(["cost", "headcount"]);
  });
});
