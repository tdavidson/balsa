import { describe, expect, it } from "vitest";
import { decimalToMinorUnits, divideDecimal, divideHalfAwayFromZero, divideHalfEven, formatDecimal, isModelIdentifier, multiplyDecimal, parseDecimal, parseFormula, roundDecimal, tokenizeFormula } from "./forecast-model";

const parsed = (formula: string) => {
  const result = parseFormula(formula);
  if (!result.ok) throw new Error(`${result.error.message} at ${result.error.position}`);
  return result.node;
};
const failure = (formula: string) => {
  const result = parseFormula(formula);
  if (result.ok) throw new Error(`expected "${formula}" to fail`);
  return result.error;
};

describe("model decimals", () => {
  it("parses and formats scale-6 decimals", () => {
    expect(parseDecimal("1.5")).toBe(1_500_000n);
    expect(parseDecimal("-0.000001")).toBe(-1n);
    expect(parseDecimal("42")).toBe(42_000_000n);
    expect(parseDecimal("1.1234567")).toBeNull();
    expect(parseDecimal("1.")).toBeNull();
    expect(parseDecimal(".5")).toBeNull();
    expect(parseDecimal("1e3")).toBeNull();
    expect(formatDecimal(1_500_000n)).toBe("1.5");
    expect(formatDecimal(-1n)).toBe("-0.000001");
    expect(formatDecimal(3_000_000n)).toBe("3");
    expect(formatDecimal(0n)).toBe("0");
  });

  it("divides half-even", () => {
    expect([divideHalfEven(5n, 2n), divideHalfEven(7n, 2n), divideHalfEven(-5n, 2n), divideHalfEven(-7n, 2n), divideHalfEven(5n, -2n), divideHalfEven(1n, 3n), divideHalfEven(2n, 3n)]).toEqual([2n, 4n, -2n, -4n, -2n, 0n, 1n]);
    expect(divideDecimal(1_000_000n, 3_000_000n)).toBe(333_333n);
    expect(divideDecimal(2_000_000n, 3_000_000n)).toBe(666_667n);
    expect(divideDecimal(1_000_000n, 2_000_000_000_000n)).toBe(0n);
    expect(divideDecimal(3_000_000n, 2_000_000_000_000n)).toBe(2n);
    expect(divideDecimal(1_000_000n, 0n)).toBeNull();
  });

  it("rescales products half-even", () => {
    expect(multiplyDecimal(1_500_000n, 1_500_000n)).toBe(2_250_000n);
    expect(multiplyDecimal(1n, 500_000n)).toBe(0n);
    expect(multiplyDecimal(3n, 500_000n)).toBe(2n);
    expect(multiplyDecimal(-3n, 500_000n)).toBe(-2n);
  });

  it("rounds half away from zero for round() and for minor units", () => {
    expect(divideHalfAwayFromZero(5n, 2n)).toBe(3n);
    expect(divideHalfAwayFromZero(-5n, 2n)).toBe(-3n);
    expect(divideHalfAwayFromZero(4n, 3n)).toBe(1n);
    expect(roundDecimal(2_345_000n, 2)).toBe(2_350_000n);
    expect(roundDecimal(-2_345_000n, 2)).toBe(-2_350_000n);
    expect(roundDecimal(2_500_000n, 0)).toBe(3_000_000n);
    expect(roundDecimal(333_333n, 4)).toBe(333_300n);
    expect(decimalToMinorUnits(1_005_000n)).toBe(101n);
    expect(decimalToMinorUnits(-1_005_000n)).toBe(-101n);
    expect(decimalToMinorUnits(1_004_999n)).toBe(100n);
    expect(decimalToMinorUnits(12_340_000n)).toBe(1_234n);
  });

  it.each([-1, 7, 1.5])("rejects invalid round places: %s", (places) => {
    expect(() => roundDecimal(1_000_000n, places)).toThrowError(new RangeError("Decimal places must be a whole number from 0 to 6"));
  });

  it("recognizes model identifiers", () => {
    expect(["team_1", "_x", "Eng"].map(isModelIdentifier)).toEqual([true, true, true]);
    expect(["1x", "a-b", "", "a b"].map(isModelIdentifier)).toEqual([false, false, false, false]);
  });
});

describe("formula tokenizer", () => {
  it("tokenizes with character positions", () => {
    expect(tokenizeFormula("a[t=E]*2.5")).toEqual([
      { type: "ident", text: "a", position: 0 }, { type: "op", text: "[", position: 1 }, { type: "ident", text: "t", position: 2 },
      { type: "op", text: "=", position: 3 }, { type: "ident", text: "E", position: 4 }, { type: "op", text: "]", position: 5 },
      { type: "op", text: "*", position: 6 }, { type: "number", text: "2.5", position: 7 }, { type: "end", text: "", position: 10 },
    ]);
  });
});

describe("formula parser", () => {
  it("parses precedence, associativity, and unary minus", () => {
    expect(parsed("1 + 2 * 3")).toEqual({
      type: "binary", op: "+", position: 2,
      left: { type: "number", value: 1_000_000n, position: 0 },
      right: { type: "binary", op: "*", position: 6, left: { type: "number", value: 2_000_000n, position: 4 }, right: { type: "number", value: 3_000_000n, position: 8 } },
    });
    expect(parsed("10 - 4 - 3")).toMatchObject({ op: "-", position: 7, left: { op: "-", position: 3 } });
    expect(parsed("-a * b")).toMatchObject({ type: "binary", op: "*", left: { type: "negate", operand: { type: "ref", name: "a" } } });
    expect(parsed("2 - -3")).toMatchObject({ op: "-", right: { type: "negate", operand: { type: "number", value: 3_000_000n } } });
    expect(parsed("(1 + 2) * 3")).toMatchObject({ op: "*", left: { op: "+" } });
  });

  it("parses selectors and every function", () => {
    expect(parsed("a[team=Eng] * 2")).toEqual({
      type: "binary", op: "*", position: 12,
      left: { type: "ref", name: "a", position: 0, selectors: [{ dim: "team", item: "Eng", position: 2 }] },
      right: { type: "number", value: 2_000_000n, position: 14 },
    });
    expect(parsed("x[region=EU, team=Eng]")).toMatchObject({ selectors: [{ dim: "region", item: "EU", position: 2 }, { dim: "team", item: "Eng", position: 13 }] });
    expect(parsed("sum(payroll)")).toEqual({ type: "reduce", fn: "sum", position: 0, dims: [], arg: { type: "ref", name: "payroll", position: 4, selectors: [] } });
    expect(parsed("avg(x, team, region)")).toMatchObject({ type: "reduce", fn: "avg", dims: [{ name: "team", position: 7 }, { name: "region", position: 13 }] });
    expect(parsed("min(x, team)")).toMatchObject({ type: "reduce", fn: "min" });
    expect(parsed("max(x)")).toMatchObject({ type: "reduce", fn: "max", dims: [] });
    expect(parsed("prev(x)")).toEqual({ type: "prev", position: 0, arg: { type: "ref", name: "x", position: 5, selectors: [] } });
    expect(parsed("round(x / 3, 2)")).toMatchObject({ type: "round", places: 2, arg: { type: "binary", op: "/" } });
  });

  it.each([
    ["1 +", "Formula ended early", 3], ["1 + $", 'Unexpected character "$"', 4], ["(1 + 2", "Expected a closing )", 6], ["1 2", 'Unexpected "2"', 2],
    ["1 + 2)", "Unmatched )", 5], ["foo(1)", 'Unknown function "foo"', 0], ["sum", "sum needs parentheses", 0], ["sum()", "sum needs an argument", 4],
    ["sum(x, 1)", "Expected a dimension name", 7], ["prev(x, 2)", "prev takes one argument", 6], ["round(x)", "round needs decimal places: round(value, places)", 7],
    ["round(x, 7)", "round places must be a whole number from 0 to 6", 9], ["round(x, 1.5)", "round places must be a whole number from 0 to 6", 9],
    ["1.1234567", "Numbers take at most 6 decimal places", 0], ["a[team]", "Expected = after the dimension", 6], ["a[team=]", "Expected an item name", 7],
    ["a[team=Eng", "Expected , or ]", 10], ["+1", 'Unexpected "+"', 0],
  ] as const)("reports %s as an error at its position", (formula, message, position) => {
    expect(failure(formula)).toEqual({ message, position });
  });

  it("limits formula length and nesting", () => {
    expect(failure(`${"1+".repeat(1000)}1`)).toEqual({ message: "Formula is longer than 2000 characters", position: 2000 });
    expect(parseFormula(`${"1+".repeat(999)}1`).ok).toBe(true);
    expect(parseFormula(`${"(".repeat(200)}1${")".repeat(200)}`).ok).toBe(true);
    expect(failure(`${"(".repeat(201)}1${")".repeat(201)}`)).toEqual({ message: "Formula is nested too deeply", position: 200 });
  });
});
