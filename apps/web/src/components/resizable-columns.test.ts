import { describe, expect, it } from "vitest";
import { moveBoundary } from "./resizable-columns";

describe("column resizing", () => {
  it("moves only the two neighbours of a handle and keeps the total", () => {
    const next = moveBoundary([0.4, 0.3, 0.3], 0, 0.1, [0.2, 0.2, 0.2]);
    expect(next[0]).toBeCloseTo(0.5); expect(next[1]).toBeCloseTo(0.2); expect(next[2]).toBe(0.3);
    expect(next.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1);
  });
  it("stops at each neighbour's minimum width", () => {
    expect(moveBoundary([0.4, 0.3, 0.3], 1, 0.5, [0.2, 0.2, 0.2])[2]).toBeCloseTo(0.2);
    expect(moveBoundary([0.4, 0.3, 0.3], 0, -0.5, [0.25, 0.2, 0.2])[0]).toBeCloseTo(0.25);
  });
});
