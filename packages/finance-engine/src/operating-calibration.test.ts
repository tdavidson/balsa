import { describe, it, expect } from "vitest";
import {
  calibrateOperatingMetric as score,
  type CalibrationSample,
} from "./operating-calibration";
import { addMonths } from "./periods";
const binding = {
  metricId: "hours_completed",
  unit: "hours",
  scope: "Team A",
  aggregation: "monthly_total" as const,
};
const samples: CalibrationSample[] = Array.from({ length: 10 }, (_, i) => ({
  predictionId: `p${i}`,
  observationId: `o${i}`,
  month: addMonths("2025-01", i),
  approvedAt: `${addMonths("2025-01", i - 1)}-28T00:00:00Z`,
  predicted: "120",
  observed: "100",
  coverage: "complete",
  unit: "hours",
  scope: "Team A",
  knownAt: `${addMonths("2025-01", i + 1)}-01T00:00:00Z`,
}));
describe("operating calibration", () => {
  it("fits on prior known outcomes, validates on later forecasts, and leaves an unapproved suggestion", () => {
    const report = score(samples, binding, "2026-01-01");
    expect(report.metrics).toMatchObject({
      count: 10,
      bias: "20",
      mae: "20",
      wapePercent: "20",
    });
    expect(report.calibration).toMatchObject({
      status: "proposal",
      subtractFromFuturePrediction: "20",
      adjustedHoldout: { mae: "0" },
    });
    expect(report.calibration.trainingMonths).toHaveLength(5);
  });
  it("excludes overlapping versions, incomplete data, mismatched scope and forecasts made too late", () => {
    const duplicate = {
      ...samples[0]!,
      predictionId: "duplicate",
      approvedAt: "2024-12-29T00:00:00Z",
    };
    const report = score(
      [
        ...samples,
        duplicate,
        { ...samples[1]!, scope: "Other team" },
        { ...samples[2]!, coverage: "partial" },
        { ...samples[3]!, approvedAt: "2025-04-10T00:00:00Z" },
      ],
      binding,
      "2026-01-01",
    );
    expect(report.metrics.count).toBe(10);
    expect(report.excluded).toHaveLength(4);
  });
  it("does not use later-known training observations, and never invents sparse confidence", () => {
    expect(
      score(
        samples.map((s) => ({ ...s, knownAt: "2025-12-01T00:00:00Z" })),
        binding,
        "2026-01-01",
      ).calibration.status,
    ).toBe("insufficient");
    expect(
      score(samples.slice(0, 3), binding, "2026-01-01").calibration
        .subtractFromFuturePrediction,
    ).toBeNull();
  });
  it("keeps different forecast ages out of the fitted cohort",()=>{
    const report=score([...samples,{...samples[0]!,predictionId:"older_forecast",approvedAt:"2024-10-15T00:00:00Z",predicted:"200"}],{...binding,horizonMonths:1},"2026-01-01");
    expect(report.metrics.count).toBe(10);expect(report.excluded.at(-1)?.reason).toBe("Different forecast horizon");expect(report.calibration.subtractFromFuturePrediction).toBe("20");
  });
  it("excludes contradictory observations and preserves undefined percentage errors at zero", () => {
    const report = score(
      [
        ...samples,
        { ...samples[0]!, predictionId: "conflict", observed: "90" },
      ],
      binding,
      "2026-01-01",
    );
    expect(report.scored.some((s) => s.month === "2025-01")).toBe(false);
    expect(
      score([{ ...samples[0]!, observed: "0" }], binding, "2026-01-01").metrics
        .wapePercent,
    ).toBeNull();
  });
});
