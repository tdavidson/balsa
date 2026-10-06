import { describe, expect, it } from "vitest";
import { defaultForecastHorizonMonths, forecastHorizonFor, maxForecastHorizonMonths, resolveModelTimeline, validateTimeline } from "./model-timeline";

describe("model timeline", () => {
  it("keeps the rolling 24-month forecast when no timeline is set", () => {
    expect(forecastHorizonFor("2026-09", null)).toBe(defaultForecastHorizonMonths);
    expect(resolveModelTimeline({ modelFirstPeriod: null, modelLastPeriod: null, fiscalYearEnd: null }, "2026-09")).toMatchObject({ firstPeriod: "2025-10", lastPeriod: "2028-09", fiscalYearEndMonth: 12, forecastHorizonMonths: 24, isDefault: true });
  });

  it("runs the forecast to the user's last period, within bounds", () => {
    expect(forecastHorizonFor("2026-09", "2027-12")).toBe(15);
    expect(forecastHorizonFor("2026-09", "2026-09")).toBe(1);
    expect(forecastHorizonFor("2026-09", "2046-09")).toBe(maxForecastHorizonMonths);
    const timeline = resolveModelTimeline({ modelFirstPeriod: "2025-01", modelLastPeriod: "2027-12", fiscalYearEnd: "06" }, "2026-09");
    expect(timeline).toMatchObject({ firstPeriod: "2025-01", lastPeriod: "2027-12", fiscalYearEndMonth: 6, forecastHorizonMonths: 15, isDefault: false, warnings: [] });
  });

  it("warns when the timeline ends before the as-of month", () => {
    expect(resolveModelTimeline({ modelFirstPeriod: "2025-01", modelLastPeriod: "2026-06", fiscalYearEnd: null }, "2026-09").warnings).toHaveLength(1);
  });

  it("validates a submitted timeline", () => {
    expect(validateTimeline({ firstPeriod: "2025-01", lastPeriod: "2028-12", fiscalYearEndMonth: 12 })).toBeNull();
    expect(validateTimeline({ firstPeriod: "2028-01", lastPeriod: "2025-12", fiscalYearEndMonth: 12 })).toMatch(/before/);
    expect(validateTimeline({ firstPeriod: "2010-01", lastPeriod: "2030-12", fiscalYearEndMonth: 12 })).toMatch(/at most/);
    expect(validateTimeline({ firstPeriod: "2025-01", lastPeriod: "2025-12", fiscalYearEndMonth: 13 })).toMatch(/1 to 12/);
  });
});
