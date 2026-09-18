import { describe, expect, it } from "vitest";
import { driverIdsFromProvenance, normalizeCalculationProvenance } from "./calculation-provenance";

describe("calculation provenance normalization", () => {
  it("passes a journal node's array shape through unchanged", () => {
    const array = [{ sourceId: "s1", sourceLocation: "row 4" }, { evidenceId: "e1" }];
    expect(normalizeCalculationProvenance(array)).toBe(array);
  });

  it("extracts driver ids from a forecast node's object shape", () => {
    expect(driverIdsFromProvenance({ driverIds: ["d1", "d2"] })).toEqual(["d1", "d2"]);
    expect(driverIdsFromProvenance({ driverIds: [] })).toEqual([]);
  });

  it("ignores non-string entries and non-object/array shapes", () => {
    expect(driverIdsFromProvenance({ driverIds: ["d1", 2, null] })).toEqual(["d1"]);
    expect(driverIdsFromProvenance(null)).toEqual([]);
    expect(driverIdsFromProvenance("driverIds")).toEqual([]);
    expect(driverIdsFromProvenance([])).toEqual([]);
    expect(driverIdsFromProvenance({})).toEqual([]);
  });

  it("normalizes a forecast node's object shape into source entries, resolving labels", () => {
    const labels = new Map([["d1", "Acme retainer"]]);
    expect(normalizeCalculationProvenance({ driverIds: ["d1", "d2"] }, labels)).toEqual([
      { sourceId: "d1", sourceName: "Acme retainer" },
      { sourceId: "d2", sourceName: "d2" },
    ]);
  });

  it("falls back to an empty array with no driver-label map", () => {
    expect(normalizeCalculationProvenance({ driverIds: ["d1"] })).toEqual([{ sourceId: "d1", sourceName: "d1" }]);
  });
});
