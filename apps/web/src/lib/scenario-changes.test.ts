import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildForecastRun, type ForecastDriver } from "@nevermodel/finance-engine";
import { fixtureBaseInput, fixturePayroll } from "@/test/forecast-fixture";
import { projectDecisionEffectOnDrivers } from "./decision-driver-effects";
import {
  applyScenarioChanges as applyScenarioInput, describeScenarioChange, effectToScenarioChange, parseScenarioChange, parseScenarioChanges, parseStoredChanges,
  runSimulation, scenarioChangeFromFlat, scenarioChangeToEffect, type ScenarioChange,
} from "./scenario-changes";

const payroll: ForecastDriver = { ...fixturePayroll, decisionId: "d0" };
const addContractor: ScenarioChange = { kind: "add_driver", label: "Contractor", direction: "spend", amount: 6000, cadence: "monthly", effectiveFrom: "2027-01", category: "contractor" };
const addGrant: ScenarioChange = { kind: "add_driver", label: "Grant", direction: "receipt", amount: 500, cadence: "monthly", effectiveFrom: "2026-09" };
const reprice: ScenarioChange = { kind: "change_amount", itemId: "payroll", amount: 1500.5, effectiveFrom: "2027-01" };
const end: ScenarioChange = { kind: "end_item", itemId: "payroll", effectiveTo: "2026-12" };
const endLater: ScenarioChange = { kind: "end_item", itemId: "payroll", effectiveTo: "2027-06" };

/** Scenario and decision drivers differ only in id prefix and lineage fields; strip those to compare semantics. */
const normalize = (drivers: ForecastDriver[]) => drivers.map((driver) => {
  const copy: Partial<ForecastDriver> = { ...driver, id: driver.id.replace(/^decision:/, "") };
  delete copy.decisionId;
  delete copy.scenarioId;
  return copy;
});
const project = (drivers: ForecastDriver[], changes: ScenarioChange[], scenarioId: string) =>
  changes.reduce<ForecastDriver[]>((current, change, index) => projectDecisionEffectOnDrivers(current, scenarioChangeToEffect(change), `scenario:${scenarioId}:${index}`), drivers);
const cash = (drivers: ForecastDriver[]) => {
  const run = buildForecastRun(fixtureBaseInput(drivers));
  return { months: run.months.map((month) => ({ month: month.month, endingCashMinor: month.endingCashMinor, receiptsMinor: month.receiptsMinor, spendingMinor: month.spendingMinor })), runway: run.runway };
};
const applyScenarioChanges = (drivers: ForecastDriver[], changes: ScenarioChange[], scenarioId: string) => applyScenarioInput(fixtureBaseInput(drivers), changes, scenarioId).drivers;

describe("applyScenarioChanges", () => {
  it("adds a driver with a scenario id, the scenario, and no decision", () => {
    expect(applyScenarioChanges([payroll], [addContractor], "s1")[1]).toEqual({ id: "scenario:s1:0", label: "Contractor", itemType: "obligation", direction: "spend", category: "contractor", amountMinor: "600000", cadence: "monthly", effectiveFrom: "2027-01", scenarioId: "s1" });
  });

  it("defaults a missing category to other, as promotion will", () => {
    expect(applyScenarioChanges([], [addGrant], "s1")[0]).toMatchObject({ id: "scenario:s1:0", itemType: "agreement", category: "other", amountMinor: "50000" });
  });

  it("re-prices from a month, keeping the original's lineage and its decision", () => {
    const [original, copy] = applyScenarioChanges([payroll], [reprice], "s1");
    expect(original).toEqual({ ...payroll, effectiveTo: "2026-12" });
    expect(copy).toEqual({ ...fixturePayroll, id: "scenario:s1:0", amountMinor: "150050", effectiveFrom: "2027-01", scenarioId: "s1" });
  });

  it("ends an item without replacing its own decision lineage", () => {
    expect(applyScenarioChanges([payroll], [end], "s1")).toEqual([{ ...payroll, effectiveTo: "2026-12" }]);
    expect(applyScenarioChanges([fixturePayroll], [end], "s1")).toEqual([{ ...fixturePayroll, effectiveTo: "2026-12" }]);
  });

  it("applies changes in order and indexes added ids by position", () => {
    expect(applyScenarioChanges([payroll], [reprice, endLater], "s1").find((driver) => driver.id === "payroll")?.effectiveTo).toBe("2027-06");
    expect(applyScenarioChanges([payroll], [endLater, reprice], "s1").find((driver) => driver.id === "payroll")?.effectiveTo).toBe("2026-12");
    expect(applyScenarioChanges([payroll], [addContractor, addContractor], "s1").map((driver) => driver.id)).toEqual(["payroll", "scenario:s1:0", "scenario:s1:1"]);
  });

  it("leaves the drivers alone when a change's item is not in the forecast", () => {
    expect(applyScenarioChanges([payroll], [{ kind: "change_amount", itemId: "gone", amount: 10, effectiveFrom: "2027-01" }, { kind: "end_item", itemId: "gone", effectiveTo: "2027-01" }], "s1")).toEqual([payroll]);
  });

  it("applies model changes in order, switches modes, and preserves the base input", () => {
    const base = { ...fixtureBaseInput(), model: { dimensions: [{ name: "team", items: ["Eng", "Sales"] }], variables: [{ name: "headcount", kind: "number" as const, dims: ["team"], inputs: [{ coords: { team: "Eng" }, from: "2026-09", value: "3" }] }] } };
    const changed = applyScenarioInput(base, [
      { kind: "set_input", variable: "headcount", coords: { team: "Eng" }, from: "2026-09", value: "4" },
      { kind: "set_input", variable: "headcount", coords: { team: "Eng" }, from: "2026-09", value: "5" },
      { kind: "set_formula", variable: "headcount", formula: "2 + 3" },
      { kind: "set_input", variable: "headcount", coords: { team: "Sales" }, from: "2026-10", value: "2" },
    ], "s1");
    expect(base.model.variables[0]!.inputs).toEqual([{ coords: { team: "Eng" }, from: "2026-09", value: "3" }]);
    expect(changed.model?.variables[0]).toEqual({ name: "headcount", kind: "number", dims: ["team"], inputs: [{ coords: { team: "Sales" }, from: "2026-10", value: "2" }] });
  });

  it("rejects unknown variables and invalid coordinates, but validates only the final model", () => {
    const base = { ...fixtureBaseInput(), model: { dimensions: [], variables: [
      { name: "x", kind: "number" as const, dims: [], formula: "y", inputs: [] },
      { name: "y", kind: "number" as const, dims: [], inputs: [{ coords: {}, from: "2026-09", value: "1" }] },
    ] } };
    expect(() => applyScenarioInput(base, [{ kind: "set_formula", variable: "y", formula: "x" }, { kind: "set_input", variable: "x", coords: {}, from: "2026-09", value: "2" }], "s1")).not.toThrow();
    expect(() => applyScenarioInput(base, [{ kind: "set_input", variable: "missing", coords: {}, from: "2026-09", value: "2" }], "s1")).toThrow(/unknown variable/);
    expect(() => applyScenarioInput(base, [{ kind: "set_input", variable: "y", coords: { team: "Eng" }, from: "2026-09", value: "2" }], "s1")).toThrow(/invalid coordinates/);
  });
});

describe("parity with projectDecisionEffectOnDrivers", () => {
  it("matches the mapped decision effect for every kind", () => {
    for (const change of [addContractor, addGrant, reprice, end]) {
      expect(normalize(applyScenarioChanges([payroll], [change], "s1"))).toEqual(normalize(project([payroll], [change], "s1")));
    }
  });

  it("matches a sequence of mapped effects, and forecasts identical cash", () => {
    const sequence = [addContractor, reprice, endLater, addGrant];
    const scenario = applyScenarioChanges([payroll], sequence, "s1");
    const decisions = project([payroll], sequence, "s1");
    expect(normalize(scenario)).toEqual(normalize(decisions));
    expect(cash(scenario)).toEqual(cash(decisions));
  });
});

describe("scenario change mapping", () => {
  it("maps each change to the decision effect promotion proposes, and back", () => {
    expect(scenarioChangeToEffect(addContractor)).toEqual({ kind: "add_item", item: { label: "Contractor", direction: "spend", amount: 6000, cadence: "monthly", effectiveFrom: "2027-01", category: "contractor", accountingTreatment: "cash" } });
    expect(scenarioChangeToEffect(reprice)).toEqual({ kind: "change_amount", itemId: "payroll", amount: 1500.5, effectiveFrom: "2027-01" });
    expect(scenarioChangeToEffect(end)).toEqual({ kind: "end_item", itemId: "payroll", effectiveTo: "2026-12" });
    for (const change of [addContractor, reprice, end]) expect(effectToScenarioChange(scenarioChangeToEffect(change))).toEqual(change);
    expect(effectToScenarioChange({ kind: "set_category", entityId: randomUUID(), category: "software" })).toBeNull();
    expect(effectToScenarioChange(undefined)).toBeNull();
  });

  it("describes changes like decision effects, naming the item when known", () => {
    expect(describeScenarioChange(addContractor)).toBe("Adds an expense: Contractor $6,000 monthly from 2027-01");
    expect(describeScenarioChange({ ...addGrant, effectiveTo: "2027-08" })).toBe("Adds a receipt: Grant $500 monthly from 2026-09 to 2027-08");
    expect(describeScenarioChange(reprice, "Payroll")).toBe("Changes Payroll to $1,500.5 from 2027-01");
    expect(describeScenarioChange(end)).toBe("Ends an item after 2026-12");
  });
});

describe("parsing", () => {
  const itemId = randomUUID();

  it("accepts valid changes and normalizes them", () => {
    expect(parseScenarioChanges([
      { kind: "add_driver", label: " Grant ", direction: "receipt", amount: 500, cadence: "monthly", effectiveFrom: "2026-09" },
      { kind: "change_amount", itemId, amount: 12.5, effectiveFrom: "2027-01" },
      { kind: "end_item", itemId, effectiveTo: "2026-08" },
    ])).toEqual([
      { kind: "add_driver", label: "Grant", direction: "receipt", amount: 500, cadence: "monthly", effectiveFrom: "2026-09" },
      { kind: "change_amount", itemId, amount: 12.5, effectiveFrom: "2027-01" },
      { kind: "end_item", itemId, effectiveTo: "2026-08" },
    ]);
  });

  it("rejects bad months, amounts, cadences, categories, ids, kinds, and reversed ranges", () => {
    const driver = { kind: "add_driver", label: "X", direction: "spend", amount: 10, cadence: "monthly", effectiveFrom: "2026-09" };
    for (const bad of [
      { ...driver, effectiveFrom: "2026-13" }, { ...driver, amount: -10 }, { ...driver, amount: 10.555 }, { ...driver, effectiveTo: "2026-08" },
      { ...driver, cadence: "weekly" }, { ...driver, category: "rent" }, { ...driver, label: "  " },
      { kind: "change_amount", itemId: "payroll", amount: 10, effectiveFrom: "2026-09" }, { kind: "end_item", itemId, effectiveTo: "soon" }, { kind: "remove", itemId },
    ]) expect(parseScenarioChange(bad)).toBeNull();
    expect(parseScenarioChanges([{ kind: "end_item", itemId, effectiveTo: "2026-08" }, { kind: "remove" }])).toBeNull();
    expect(parseScenarioChanges("nope")).toBeNull();
  });

  it("reads stored changes leniently and flat agent changes with nulls", () => {
    expect(parseStoredChanges([{ kind: "end_item", itemId, effectiveTo: "2026-08" }, { kind: "remove" }])).toEqual([{ kind: "end_item", itemId, effectiveTo: "2026-08" }]);
    expect(parseStoredChanges(null)).toEqual([]);
    expect(scenarioChangeFromFlat({ kind: "add_driver", label: "Grant", direction: "receipt", amount: 500, cadence: "monthly", effectiveFrom: "2026-09", effectiveTo: null, category: null, itemId: null }))
      .toEqual({ kind: "add_driver", label: "Grant", direction: "receipt", amount: 500, cadence: "monthly", effectiveFrom: "2026-09" });
    expect(scenarioChangeFromFlat({ kind: "set_input", variable: "headcount", coords: { team: "Eng" }, from: "2026-09", value: "5", formula: null })).toEqual({ kind: "set_input", variable: "headcount", coords: { team: "Eng" }, from: "2026-09", value: "5" });
    expect(describeScenarioChange({ kind: "set_formula", variable: "tax", formula: "payroll * 0.08" })).toBe("Sets tax formula");
    expect(scenarioChangeFromFlat("add a grant")).toBeNull();
  });
});

describe("runSimulation", () => {
  it("diffs the changed forecast against the base built from the same input", () => {
    const { baseRun, run, consequence } = runSimulation(fixtureBaseInput(), [{ kind: "add_driver", label: "Retainer", direction: "receipt", amount: 500, cadence: "monthly", effectiveFrom: "2026-09" }], { scenarioId: "s1" });
    expect(baseRun.runway).toMatchObject({ runwayMonths: 9, cashOutMonth: "2027-06" });
    // 900,000 − 50,000·n < 0 first at n = 19: eighteen funded months, cash-out 2026-08 + 19 = 2028-03.
    expect(run.runway).toMatchObject({ runwayMonths: 18, cashOutMonth: "2028-03" });
    expect(consequence?.runwayMonths).toEqual({ before: 9, after: 18 });
    expect(consequence?.drivers.added.map((driver) => driver.id)).toEqual(["scenario:s1:0"]);
  });

  it("adds scenario items before the changes, and reports no consequence for no change", () => {
    const grant: ForecastDriver = { id: "grant", label: "Grant", itemType: "agreement", direction: "receipt", amountMinor: "50000", cadence: "monthly", effectiveFrom: "2026-09", scenarioId: "s1" };
    expect(runSimulation(fixtureBaseInput(), [], { scenarioId: "s1", scenarioDrivers: [grant] }).run.runway.runwayMonths).toBe(18);
    expect(runSimulation(fixtureBaseInput(), [{ kind: "end_item", itemId: "grant", effectiveTo: "2026-08" }], { scenarioId: "s1", scenarioDrivers: [grant] }).run.runway.runwayMonths).toBe(9);
    expect(runSimulation(fixtureBaseInput(), []).consequence).toBeNull();
  });
});
