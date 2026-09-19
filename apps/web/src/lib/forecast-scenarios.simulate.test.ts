import { describe, expect, it } from "vitest";
import { fixtureBaseInput } from "@/test/forecast-fixture";
import { simulateForAgent } from "./forecast-scenarios";
import type { ScenarioForecastView } from "./scenario-changes";
import { ScenarioNotFound } from "./scenarios";

const retainer = { kind: "add_driver", label: "Retainer", direction: "receipt", amount: 500, cadence: "monthly", effectiveFrom: "2026-09", effectiveTo: null, category: null, itemId: null };
const loadBase = async () => fixtureBaseInput();
const noScenario = async (): Promise<ScenarioForecastView> => { throw new ScenarioNotFound("Scenario not found"); };
const deps = { loadBase, loadScenario: noScenario };

describe("simulate tool", () => {
  it("simulates flat changes against the stubbed base", async () => {
    const result = await simulateForAgent("company", { changes: [retainer] }, deps);
    if (!("consequence" in result)) throw new Error(`expected a simulation, got ${JSON.stringify(result)}`);
    expect(result.runway).toMatchObject({ runwayMonths: 18, cashOutMonth: "2028-03" });
    expect(result.consequence).toContain("runway 9 mo → 18 mo");
    expect(result.exceptions).toEqual([]);
  });

  it("reports a saved scenario's result by name", async () => {
    const view: ScenarioForecastView = {
      scenario: { id: "s1", name: "Hiring", description: null, changes: [], itemCount: 0 }, months: [],
      runway: { cashOutMonth: "2027-06", runwayMonths: 9, trailingBurn3mMinor: "100000", cashOverTrailingBurn: "9.0", minimumCashMinor: "0", horizonMonths: 24 },
      consequence: null, exceptions: [], sources: [],
    };
    expect(await simulateForAgent("company", { scenarioId: "s1" }, { loadBase, loadScenario: async () => view })).toEqual({ scenario: "Hiring", runway: view.runway, consequence: "No forecast effect", exceptions: [] });
  });

  it("explains input it cannot use", async () => {
    expect(await simulateForAgent("company", {}, deps)).toEqual({ error: expect.stringContaining("changes") });
    expect(await simulateForAgent("company", { query: "what if we hire" }, deps)).toEqual({ error: expect.stringContaining("changes") });
    expect(await simulateForAgent("company", { changes: [retainer, { kind: "remove" }] }, deps)).toEqual({ error: "Change 2 is not a valid scenario change." });
    expect(await simulateForAgent("company", { scenarioId: "missing" }, deps)).toEqual({ error: "Scenario not found." });
  });
});
