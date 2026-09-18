import { describe, expect, it } from "vitest";
import type { ForecastDriver } from "@nevermodel/finance-engine";
import { projectDecisionEffectOnDrivers } from "./decision-driver-effects";

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
