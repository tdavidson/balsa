import { describe, expect, it } from "vitest";
import { compactMoney, niceTicks } from "./cash-charts";

describe("chart axes", () => {
  it("covers the data with round ticks that include zero", () => {
    expect(niceTicks(0, 53880)).toEqual([0, 20000, 40000, 60000]);
    const mixed = niceTicks(-12000, 30000);
    expect(mixed[0]).toBeLessThanOrEqual(-12000); expect(mixed.at(-1)).toBeGreaterThanOrEqual(30000); expect(mixed).toContain(0);
    expect(niceTicks(0, 0)).toEqual([0, 1]);
  });
  it("compacts axis labels from a thousand up", () => {
    expect([compactMoney(950), compactMoney(1500), compactMoney(53880), compactMoney(-2_400_000)]).toEqual(["$950", "$1.5K", "$54K", "−$2.4M"]);
  });
});
