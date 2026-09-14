import { describe, expect, it } from "vitest";
import { isCalculationJobStale } from "./calculation-outbox-recovery";

describe("calculation outbox recovery", () => {
  it("retries only claims older than the recovery window", () => {
    const now = new Date("2026-09-13T12:00:00.000Z");
    expect(isCalculationJobStale(new Date("2026-09-13T11:50:00.000Z"), now)).toBe(true);
    expect(isCalculationJobStale(new Date("2026-09-13T11:50:00.001Z"), now)).toBe(false);
  });

  it("permits a longer recovery window for a deliberately slow deployment", () => {
    const now = new Date("2026-09-13T12:00:00.000Z");
    expect(isCalculationJobStale(new Date("2026-09-13T11:45:00.000Z"), now, 20 * 60_000)).toBe(false);
  });
});
