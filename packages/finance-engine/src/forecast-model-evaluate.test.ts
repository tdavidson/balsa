import { describe, expect, it } from "vitest";
import { canonicalizeModel, evaluateFormula, evaluateModel, formatDecimal, monthRange, resolveFormulaDrivers, validateModel, type Cube, type ForecastModel, type ForecastVariable, type ForecastVariableInput } from "./forecast-model";
import type { ForecastDriver } from "./forecast-projections";

const months = ["2026-08", "2026-09", "2026-10", "2026-11"];
const team = { name: "team", items: ["Eng", "Sales"] };
const region = { name: "region", items: ["EU", "US"] };
const tier = { name: "tier", items: ["a", "b", "c"] };
const empty: ForecastModel = { dimensions: [], variables: [] };
const byItem = (dim: string, from: string, values: Record<string, string>): ForecastVariableInput[] => Object.entries(values).map(([item, value]) => ({ coords: { [dim]: item }, from, value }));
const scalarInputs = (entries: [string, string][]): ForecastVariableInput[] => entries.map(([from, value]) => ({ coords: {}, from, value }));
const variable = (name: string, dims: string[], definition: { formula: string } | { inputs: ForecastVariableInput[] }, kind: "money" | "number" = "number"): ForecastVariable =>
  ({ name, kind, dims, ...("formula" in definition ? { formula: definition.formula, inputs: [] } : { inputs: definition.inputs }) });
const readable = (cube: Cube) => Object.fromEntries([...cube.cells].map(([key, row]) => [key, row.map((value) => (value === null ? null : formatDecimal(value)))]));
const firstMonth = (cube: Cube) => Object.fromEntries(Object.entries(readable(cube)).map(([key, row]) => [key, row[0]]));
const cube = (model: ForecastModel, name: string) => {
  const result = evaluateModel(model, months);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.cubes.get(name)!;
};
const formula = (model: ForecastModel, text: string) => {
  const result = evaluateFormula(text, model, months);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.cube;
};
const scalar = (text: string) => readable(formula(empty, text))[""]![0];

const factorInputs: ForecastVariableInput[] = ([["EU", "a", "1"], ["EU", "b", "2"], ["EU", "c", "3"], ["US", "a", "4"], ["US", "b", "5"], ["US", "c", "6"]] as const).map(([r, t, value]) => ({ coords: { region: r, tier: t }, from: "2026-08", value }));
const cubeModel: ForecastModel = {
  dimensions: [team, region, tier],
  variables: [
    variable("base", ["team"], { inputs: byItem("team", "2026-08", { Eng: "10", Sales: "20" }) }),
    variable("factor", ["region", "tier"], { inputs: factorInputs }),
    variable("product", ["tier", "team", "region"], { formula: "base * factor" }),
  ],
};

describe("model evaluation", () => {
  it("evaluates arithmetic with precedence and half-even division", () => {
    expect(scalar("1 + 2 * 3")).toBe("7");
    expect(scalar("(1 + 2) * 3")).toBe("9");
    expect(scalar("10 - 4 - 3")).toBe("3");
    expect(scalar("12 / 3 / 2")).toBe("2");
    expect(scalar("-2 * 3")).toBe("-6");
    expect(scalar("2 - -3")).toBe("5");
    expect(scalar("1 / 3")).toBe("0.333333");
    expect(scalar("2 / 3")).toBe("0.666667");
  });

  it("broadcasts across three dimensions", () => {
    const product = cube(cubeModel, "product");
    expect(product.dims).toEqual(["region", "team", "tier"]);
    expect(product.cells.size).toBe(12);
    expect(readable(product)["US|Sales|c"]).toEqual(["120", "120", "120", "120"]);
    expect(readable(product)["EU|Eng|a"]).toEqual(["10", "10", "10", "10"]);
    expect(firstMonth(formula(cubeModel, "base * 2 + factor"))["US|Eng|b"]).toBe("25");
  });

  it("reduces some or all dimensions and selects items", () => {
    expect(firstMonth(formula(cubeModel, "sum(product, tier)"))).toEqual({ "EU|Eng": "60", "EU|Sales": "120", "US|Eng": "150", "US|Sales": "300" });
    expect(firstMonth(formula(cubeModel, "sum(product)"))).toEqual({ "": "630" });
    expect(firstMonth(formula(cubeModel, "avg(product, region, tier)"))).toEqual({ Eng: "35", Sales: "70" });
    expect(firstMonth(formula(cubeModel, "min(product, team)"))).toEqual({ "EU|a": "10", "EU|b": "20", "EU|c": "30", "US|a": "40", "US|b": "50", "US|c": "60" });
    expect(firstMonth(formula(cubeModel, "max(product)"))).toEqual({ "": "120" });
    expect(firstMonth(formula(cubeModel, "product[team=Eng, tier=c]"))).toEqual({ EU: "30", US: "60" });
    expect(firstMonth(formula(cubeModel, "sum(product[team=Sales], region)"))).toEqual({ a: "100", b: "140", c: "180" });
  });

  it("reads inputs as step functions and fills empty cells with 0", () => {
    const model: ForecastModel = { dimensions: [team], variables: [variable("headcount", ["team"], { inputs: [
      { coords: { team: "Eng" }, from: "2026-11", value: "5" },
      { coords: { team: "Eng" }, from: "2026-01", value: "2" },
      { coords: { team: "Eng" }, from: "2026-09", value: "3" },
    ] })] };
    expect(readable(cube(model, "headcount"))).toEqual({ Eng: ["2", "3", "3", "5"], Sales: ["0", "0", "0", "0"] });
    expect(validateModel(model)).toEqual({ errors: [], warnings: [{ variable: "headcount", message: '"headcount" has no inputs for team=Sales; those cells are 0' }] });
  });

  it("reads prev from the previous month, and the first month from itself", () => {
    const model: ForecastModel = { dimensions: [], variables: [variable("x", [], { inputs: scalarInputs([["2026-08", "1"], ["2026-10", "4"]]) }), variable("lagged", [], { formula: "prev(x) * 2" })] };
    expect(readable(cube(model, "x"))).toEqual({ "": ["1", "1", "4", "4"] });
    expect(readable(cube(model, "lagged"))).toEqual({ "": ["2", "2", "2", "8"] });
  });

  it("rounds half away from zero to the given places", () => {
    expect(scalar("round(2.345, 2)")).toBe("2.35");
    expect(scalar("round(-2.345, 2)")).toBe("-2.35");
    expect(scalar("round(2.5, 0)")).toBe("3");
    expect(scalar("round(1 / 3, 4)")).toBe("0.3333");
  });

  it("marks division by zero and overflow as error cells without throwing", () => {
    const model: ForecastModel = { dimensions: [], variables: [
      variable("x", [], { inputs: scalarInputs([["2026-08", "1"], ["2026-10", "4"]]) }),
      variable("y", [], { inputs: scalarInputs([["2026-09", "2"]]) }),
      variable("ratio", [], { formula: "x / y" }),
      variable("total", [], { formula: "ratio + 1" }),
    ] };
    expect(readable(cube(model, "ratio"))).toEqual({ "": [null, "0.5", "2", "2"] });
    expect(readable(cube(model, "total"))).toEqual({ "": [null, "1.5", "3", "3"] });
    const zeros: ForecastModel = { dimensions: [team], variables: [variable("z", ["team"], { inputs: byItem("team", "2026-08", { Eng: "0", Sales: "1" }) })] };
    expect(readable(formula(zeros, "sum(1 / z)"))).toEqual({ "": [null, null, null, null] });
    expect(readable(formula(empty, "1000000000000000 * 1000"))).toEqual({ "": [null, null, null, null] });
    expect(scalar("1000000000000000")).toBe("1000000000000000");
  });

  it("requires consecutive evaluation months", () => {
    expect(monthRange("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(() => evaluateModel(empty, ["2026-08", "2026-10"])).toThrow("Model months must be consecutive YYYY-MM months");
  });
});

describe("model validation", () => {
  it("detects cycles", () => {
    const model: ForecastModel = { dimensions: [], variables: [variable("a", [], { formula: "b + 1" }), variable("b", [], { formula: "a * 2" }), variable("c", [], { formula: "c + 1" })] };
    const { errors } = validateModel(model);
    expect(errors).toEqual([{ variable: "a", message: "Cycle: a → b → a" }, { variable: "c", message: "Cycle: c → c" }]);
    expect(evaluateModel(model, months)).toEqual({ ok: false, errors });
  });

  it("reports unknown names, dimensions, items, and shape errors with positions", () => {
    const model: ForecastModel = { dimensions: [team], variables: [
      variable("headcount", ["team"], { inputs: byItem("team", "2026-08", { Eng: "3", Sales: "2" }) }),
      variable("a", [], { formula: "sum(headcount) + nope" }),
      variable("b", [], { formula: "headcount[region=EU]" }),
      variable("c", [], { formula: "headcount[team=Ops]" }),
      variable("d", [], { formula: "headcount" }),
      variable("e", ["team"], { formula: "sum(headcount, region)" }),
    ] };
    expect(validateModel(model).errors).toEqual([
      { variable: "a", position: 17, message: 'Unknown variable "nope"' },
      { variable: "b", position: 10, message: '"headcount" has no dimension "region"' },
      { variable: "c", position: 10, message: '"Ops" is not an item of team' },
      { variable: "d", position: 0, message: 'The formula for "d" produces dimensions [team] but the variable declares []' },
      { variable: "e", position: 15, message: 'sum cannot collapse "region": the expression has no such dimension' },
    ]);
  });

  it("rejects bad names, duplicates, mixed definitions, and bad inputs", () => {
    const model: ForecastModel = {
      dimensions: [team, { name: "team", items: ["X"] }, { name: "bad-name", items: ["a", "a", "1x"] }],
      variables: [
        variable("sum", [], { inputs: [] }),
        { name: "mixed", kind: "number", dims: [], formula: "1", inputs: scalarInputs([["2026-08", "1"]]) },
        variable("mixed", [], { inputs: [] }),
        variable("inputs", ["team"], { inputs: [
          { coords: {}, from: "2026-08", value: "1" },
          { coords: { team: "Ops" }, from: "2026-08", value: "1" },
          { coords: { team: "Eng" }, from: "2026-13", value: "1" },
          { coords: { team: "Eng" }, from: "2026-08", value: "1.1234567" },
          { coords: { team: "Eng" }, from: "2026-08", value: "1" },
          { coords: { team: "Eng" }, from: "2026-08", value: "2" },
        ] }),
        variable("ghost", ["unknown"], { inputs: [] }),
      ],
    };
    const naming = "must start with a letter or underscore and use only letters, digits, and underscores";
    expect(validateModel(model).errors.map((issue) => issue.message)).toEqual([
      'Dimension "team" is defined twice',
      `Dimension name "bad-name" ${naming}`,
      'Item "a" appears twice in bad-name',
      `Item "1x" in bad-name ${naming}`,
      '"sum" is a function name and cannot name a variable',
      'Variable "mixed" is defined twice',
      'Variable "ghost" uses unknown dimension "unknown"',
      'Variable "mixed" has both a formula and inputs; keep one',
      'An input for "inputs" must name exactly its dimensions [team]',
      'An input for "inputs" uses team=Ops, which is not an item of team',
      'An input for "inputs" has an invalid month "2026-13"',
      'An input for "inputs" has an invalid value "1.1234567"',
      '"inputs" has two inputs for team=Eng from 2026-08',
    ]);
  });

  it("enforces model limits", () => {
    const many = (count: number, prefix: string) => Array.from({ length: count }, (_, index) => `${prefix}${index}`);
    expect(validateModel({ dimensions: many(13, "d").map((name) => ({ name, items: ["a"] })), variables: [] }).errors).toContainEqual({ message: "A model has at most 12 dimensions" });
    expect(validateModel({ dimensions: [], variables: many(201, "v").map((name) => variable(name, [], { inputs: scalarInputs([["2026-08", "1"]]) })) }).errors).toContainEqual({ message: "A model has at most 200 variables" });
    expect(validateModel({ dimensions: [{ name: "big", items: many(501, "i") }], variables: [] }).errors).toContainEqual({ dimension: "big", message: 'Dimension "big" has more than 500 items' });
    const grid = (size: number) => ({ dimensions: [{ name: "p", items: many(size, "p") }, { name: "q", items: many(size, "q") }], variables: [variable("grid", ["p", "q"], { inputs: [] })] });
    expect(validateModel(grid(500)).errors).toContainEqual({ variable: "grid", message: 'Variable "grid" has 6250000 cells (dimension items × months); the limit is 250000' });
    const oversizedWithInput: ForecastModel = {
      dimensions: [{ name: "p", items: many(500, "p") }, { name: "q", items: many(500, "q") }],
      variables: [variable("grid", ["p", "q"], { inputs: [{ coords: { p: "p0", q: "q0" }, from: "2026-08", value: "1" }] })],
    };
    expect(validateModel(oversizedWithInput)).toEqual({
      errors: [{ variable: "grid", message: 'Variable "grid" has 6250000 cells (dimension items × months); the limit is 250000' }],
      warnings: [],
    });
    // 100 × 100 items × 25 months = 250,000 cells: exactly at the limit.
    expect(validateModel(grid(100)).errors).toEqual([]);
    // An intermediate over the limit is rejected even when the result is a single cell per month.
    const cross: ForecastModel = { dimensions: [{ name: "p", items: many(200, "p") }, { name: "q", items: many(200, "q") }], variables: [variable("x", ["p"], { inputs: [] }), variable("y", ["q"], { inputs: [] }), variable("z", [], { formula: "sum(x * y)" })] };
    expect(validateModel(cross).errors).toContainEqual({ variable: "z", position: 6, message: "This expression spans 1000000 cells; the limit is 250000" });
    expect(validateModel({ dimensions: [], variables: [variable("long", [], { formula: `${"1+".repeat(1000)}1` })] }).errors).toEqual([{ variable: "long", position: 2000, message: "Formula is longer than 2000 characters" }]);
  });

  it("validates driver formulas against the model", () => {
    const model: ForecastModel = { dimensions: [team], variables: [variable("payroll", ["team"], { inputs: byItem("team", "2026-08", { Eng: "1", Sales: "1" }) })] };
    expect(validateModel(model, { driverFormulas: [{ id: "ok", formula: "sum(payroll)" }, { id: "wide", formula: "payroll" }, { id: "bad", formula: "sum(nope)" }] }).errors).toEqual([
      { driverId: "wide", message: "The formula still has dimensions team; use sum(...) to collapse team" },
      { driverId: "bad", position: 4, message: 'Unknown variable "nope"' },
    ]);
  });

  it("canonicalizes the model for hashing", () => {
    const model = canonicalizeModel({ dimensions: [team, region], variables: [
      { name: "z", kind: "number", dims: ["team", "region"], inputs: [{ coords: { team: "Eng", region: "US" }, from: "2026-09", value: "1" }, { coords: { region: "EU", team: "Eng" }, from: "2026-08", value: "2" }] },
      { name: "a", kind: "money", dims: [], formula: "1", inputs: [] },
    ] });
    expect(model.dimensions.map((dimension) => dimension.name)).toEqual(["region", "team"]);
    expect(model.variables.map((entry) => entry.name)).toEqual(["a", "z"]);
    expect(model.variables[1]).toEqual({ name: "z", kind: "number", dims: ["region", "team"], inputs: [{ coords: { region: "EU", team: "Eng" }, from: "2026-08", value: "2" }, { coords: { region: "US", team: "Eng" }, from: "2026-09", value: "1" }] });
    expect(Object.keys(model.variables[1]!.inputs[1]!.coords)).toEqual(["region", "team"]);
  });
});

describe("resolveFormulaDrivers", () => {
  const payrollModel: ForecastModel = { dimensions: [team], variables: [
    variable("headcount", ["team"], { inputs: byItem("team", "2026-08", { Eng: "3", Sales: "2" }) }),
    variable("salary", ["team"], { inputs: byItem("team", "2026-08", { Eng: "10000", Sales: "8000" }) }, "money"),
    variable("payroll", ["team"], { formula: "headcount * salary" }, "money"),
    variable("tax", ["team"], { formula: "payroll * 0.0765" }, "money"),
    variable("unused", [], { inputs: scalarInputs([["2026-08", "1"]]) }),
  ] };
  const driver = (id: string, amountFormula?: string): ForecastDriver => ({ id, label: id, itemType: "obligation", direction: "spend", amountMinor: "", cadence: "monthly", effectiveFrom: "2026-09", ...(amountFormula !== undefined ? { amountFormula } : {}) });

  it("resolves a formula driver into monthly minor units and summarizes what it uses", () => {
    const result = resolveFormulaDrivers([driver("fixed"), driver("payroll", "sum(payroll) + sum(tax)")], payrollModel, months);
    expect(result.exceptions).toEqual([]);
    expect(result.drivers[0]).toEqual(driver("fixed"));
    expect(result.drivers[1]!.amountByMonth).toEqual({ "2026-08": "4951900", "2026-09": "4951900", "2026-10": "4951900", "2026-11": "4951900" });
    expect(result.summary.variables.map((entry) => [entry.name, entry.monthlyTotals["2026-09"], entry.driverIds])).toEqual([
      ["headcount", "5", ["payroll"]], ["payroll", "46000", ["payroll"]], ["salary", "18000", ["payroll"]], ["tax", "3519", ["payroll"]],
    ]);
  });

  it("returns the drivers untouched when none has a formula", () => {
    const drivers = [driver("fixed")];
    const result = resolveFormulaDrivers(drivers, payrollModel, months);
    expect(result.drivers).toBe(drivers);
    expect(result.summary).toEqual({ variables: [] });
  });

  it("turns a formula that keeps dimensions into an exception", () => {
    expect(resolveFormulaDrivers([driver("p", "payroll")], payrollModel, months).exceptions).toEqual([{ driverId: "p", reason: "The formula still has dimensions team; use sum(...) to collapse team" }]);
  });

  it("reports an invalid formula or an invalid model as exceptions, and evaluates a constant without a model", () => {
    expect(resolveFormulaDrivers([driver("p", "sum(nope)")], payrollModel, months).exceptions).toEqual([{ driverId: "p", reason: 'Formula is invalid at character 5: Unknown variable "nope"' }]);
    const broken: ForecastModel = { ...payrollModel, variables: [...payrollModel.variables, variable("loop", [], { formula: "loop" })] };
    expect(resolveFormulaDrivers([driver("p", "sum(payroll)")], broken, months).exceptions).toEqual([{ driverId: "p", reason: "The forecast model is invalid: Cycle: loop → loop" }]);
    expect(resolveFormulaDrivers([driver("p", "1000")], undefined, months).drivers[0]!.amountByMonth).toEqual({ "2026-08": "100000", "2026-09": "100000", "2026-10": "100000", "2026-11": "100000" });
  });

  it("marks errored months and keeps negative amounts for projection to reject", () => {
    const model: ForecastModel = { dimensions: [], variables: [variable("y", [], { inputs: scalarInputs([["2026-09", "2"]]) })] };
    expect(resolveFormulaDrivers([driver("p", "100 / y")], model, months).drivers[0]!.amountByMonth).toEqual({ "2026-08": "error", "2026-09": "5000", "2026-10": "5000", "2026-11": "5000" });
    expect(resolveFormulaDrivers([driver("n", "0 - 12.345")], model, months).drivers[0]!.amountByMonth!["2026-09"]).toBe("-1235");
  });
});
