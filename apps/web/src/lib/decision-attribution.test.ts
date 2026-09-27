import { describe, expect, it } from "vitest";
import { buildForecastRun } from "@nevermodel/finance-engine";
import { fixtureBaseInput } from "@/test/forecast-fixture";
import { attributeDecision } from "./decision-attribution";
import { applyScenarioChanges, type ScenarioChange } from "./scenario-changes";
import type { GoalVersion } from "./goal-review-contract";
const goal = { id: "goal", definition: { name: "September cash", metric: "ending_cash_at_month", currency: "USD", startMonth: "2026-09", endMonth: "2026-09", targetMinor: "0" } } as GoalVersion;
describe("ordered decision attribution", () => {
  it("assigns interactions to the later change and exactly ties the total", async () => {
    const input = fixtureBaseInput(); const changes: ScenarioChange[] = [{ kind: "end_item", itemId: "payroll", effectiveTo: "2026-08" }, { kind: "end_item", itemId: "payroll", effectiveTo: "2026-10" }];
    const result = await attributeDecision(input, buildForecastRun(input), buildForecastRun(applyScenarioChanges(input, changes, "scenario")), [goal], [], changes, "scenario", async (value) => value);
    expect(result.steps.map((step) => step.values[0]?.deltaMinor)).toEqual(["100000", "-100000"]);
    expect(result.totals[0]).toMatchObject({ deltaMinor: "0", residualMinor: "0", complete: true });
  });
  it("does not invent individual effects when an intermediate model is invalid", async () => {
    const input = { ...fixtureBaseInput(), model: { dimensions: [], variables: [{ name: "x", kind: "number" as const, dims: [], formula: "y", inputs: [] }, { name: "y", kind: "number" as const, dims: [], inputs: [{ coords: {}, from: "2026-09", value: "1" }] }] } };
    const changes: ScenarioChange[] = [{ kind: "set_formula", variable: "y", formula: "x" }, { kind: "set_input", variable: "x", coords: {}, from: "2026-09", value: "2" }];
    const result = await attributeDecision(input, buildForecastRun(input), buildForecastRun(applyScenarioChanges(input, changes, "scenario")), [goal], [], changes, "scenario", async (value) => value);
    expect(result.steps[0]?.reasons).toHaveLength(1); expect(result.steps.map((step) => step.values[0]?.deltaMinor)).toEqual([null, null]); expect(result.totals[0]?.complete).toBe(false);
  });
});
