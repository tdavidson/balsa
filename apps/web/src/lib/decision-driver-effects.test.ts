import { describe, expect, it } from "vitest";
import type { ForecastDriver } from "@balsa/finance-engine";
import { fixtureBaseInput } from "@/test/forecast-fixture";
import { projectDecisionEffect, projectDecisionEffectOnDrivers } from "./decision-driver-effects";

const payroll: ForecastDriver = { id: "p", label: "Payroll", itemType: "obligation", direction: "spend", category: "salary", amountMinor: "100000", cadence: "monthly", effectiveFrom: "2026-09", counterpartyEntityId: "e1" };

describe("projectDecisionEffectOnDrivers", () => {
  it("adds a base-forecast item and ignores scenario items", () => {
    const item = { label: "Contractor", direction: "spend" as const, amount: 6000, cadence: "monthly" as const, effectiveFrom: "2027-01", category: "contractor" as const, accountingTreatment: "cash" as const };
    expect(projectDecisionEffectOnDrivers([payroll], { kind: "add_item", item }, "d1").at(-1)).toEqual({ id: "decision:d1", label: "Contractor", itemType: "obligation", direction: "spend", category: "contractor", amountMinor: "600000", cadence: "monthly", effectiveFrom: "2027-01", decisionId: "d1" });
    expect(projectDecisionEffectOnDrivers([payroll], { kind: "add_item", item, scenario: "Hiring" }, "d1")).toEqual([payroll]);
  });
  it("ends, re-prices, and re-categorizes like the persisted effect", () => {
    expect(projectDecisionEffectOnDrivers([payroll], { kind: "end_item", itemId: "p", effectiveTo: "2026-12" }, "d2")[0]).toMatchObject({ effectiveTo: "2026-12", decisionId: "d2" });
    const changed = projectDecisionEffectOnDrivers([payroll], { kind: "change_amount", itemId: "p", amount: 1500.5, effectiveFrom: "2027-01" }, "d3");
    expect(changed[0]).toMatchObject({ id: "p", effectiveTo: "2026-12" });
    expect(changed[1]).toMatchObject({ id: "decision:d3", amountMinor: "150050", effectiveFrom: "2027-01", decisionId: "d3" });
    expect(changed[1]).not.toHaveProperty("effectiveTo");
    expect(projectDecisionEffectOnDrivers([payroll], { kind: "set_category", entityId: "e1", category: "contractor" }, "d4")[0]?.category).toBe("contractor");
  });
});

describe("projectDecisionEffect", () => {
  it("adds and replaces dimensions immutably while preserving unrelated input", () => {
    const input = { ...fixtureBaseInput([payroll]), model: { dimensions: [{ name: "team", items: ["Old"] }], variables: [] } };
    const added = projectDecisionEffect(input, { kind: "set_dimension", dimension: { name: "region", items: ["US"] } }, "d5");
    const replaced = projectDecisionEffect(added, { kind: "set_dimension", dimension: { name: "team", items: ["Eng", "Sales"] } }, "d6");
    expect(replaced.model?.dimensions).toEqual([{ name: "region", items: ["US"] }, { name: "team", items: ["Eng", "Sales"] }]);
    expect(input.model.dimensions).toEqual([{ name: "team", items: ["Old"] }]);
    expect(replaced.drivers).toBe(input.drivers);
    expect(replaced.actuals).toBe(input.actuals);
    expect(replaced.templates).toBe(input.templates);
    expect(replaced.accounts).toBe(input.accounts);
  });

  it("adds and replaces complete variables canonically without adding undefined optionals", () => {
    const input = fixtureBaseInput([payroll]);
    const zed = { kind: "set_variable" as const, variable: { name: "zed", kind: "number" as const, dims: [], formula: null, inputs: [{ coords: {}, from: "2026-09", value: "2" }] } };
    const alpha = { kind: "set_variable" as const, variable: { name: "alpha", kind: "money" as const, dims: [], formula: "zed * 2", inputs: [] } };
    const projected = projectDecisionEffect(projectDecisionEffect(input, zed, "d7"), alpha, "d8");
    expect(projected.model?.variables.map((variable) => variable.name)).toEqual(["alpha", "zed"]);
    expect(projected.model?.variables[1]).toEqual({ name: "zed", kind: "number", dims: [], inputs: [{ coords: {}, from: "2026-09", value: "2" }] });
    expect(input).not.toHaveProperty("model");
  });

  it("changes only the target item formula and attaches decision lineage", () => {
    const other = { ...payroll, id: "other" };
    const input = fixtureBaseInput([payroll, other]);
    const projected = projectDecisionEffect(input, { kind: "set_item_formula", itemId: "p", amountFormula: "sum(payroll)" }, "d9");
    expect(projected.drivers).toEqual([{ ...payroll, amountFormula: "sum(payroll)", decisionId: "d9" }, other]);
    expect(input.drivers).toEqual([payroll, other]);
  });
});
