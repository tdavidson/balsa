import { describe, expect, it } from "vitest";
import { evaluateOperatingModel } from "@balsa/finance-engine";
import { buildHiringDecision } from "./hiring-decision";
import { operatingModelSchema } from "./operating-model-contract";
const args = { startMonth: "2027-01", hires: 2, annualSalary: "120000", benefitsPercent: "25", recruitingPerHire: "1000", minimumCash: "50000" };
const horizon = { start: "2026-10", end: "2027-12" };
describe("guided hiring decision", () => {
  it("uses the shared engine for recurring payroll and one-time recruiting in each case", () => {
    const model = buildHiringDecision(args, horizon, "USD"); expect(operatingModelSchema.safeParse(model).success).toBe(true);
    const base = evaluateOperatingModel(model, "base");
    expect(base.values.loaded_payroll?.[0]).toBe("25000");
    expect(base.values.recruiting?.slice(0, 4)).toEqual(["2000", "0", "0", "0"]);
    const delayed = evaluateOperatingModel(model, "delay");
    expect(delayed.values.loaded_payroll?.slice(0, 4)).toEqual(["0", "0", "0", "25000"]);
    expect(delayed.values.recruiting?.slice(0, 5)).toEqual(["0", "0", "0", "2000", "0"]);
    expect(evaluateOperatingModel(model, "no_hire").cash.every(row => row.amountMinor === "0")).toBe(true);
    expect(model.decision?.cashFloorMinor).toBe("5000000");
    expect(model.nodes.every(node => node.evidenceIds.length === 0)).toBe(true);
  });
  it("requires explicit compensation inputs and stays inside the company horizon", () => {
    expect(() => buildHiringDecision({ ...args, annualSalary: "" }, horizon, "USD")).toThrow();
    expect(() => buildHiringDecision({ ...args, startMonth: "2028-01" }, horizon, "USD")).toThrow("forecast horizon");
    const short = buildHiringDecision({ ...args, startMonth: "2027-12" }, horizon, "USD");
    expect(short.months).toBe(1); expect(short.cases.some(item => item.id === "delay")).toBe(false);
  });
});
