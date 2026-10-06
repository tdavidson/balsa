import { describe, it, expect } from "vitest";
import {
  evaluateOperatingTrigger as evaluate,
  type OperatingTriggerRule,
  type TriggerObservation,
} from "./operating-triggers";
const rule: OperatingTriggerRule = {
  kind: "threshold",
  nodeId: "capacity",
  unit: "hours",
  scope: "All delivery staff",
  measure: "difference",
  direction: "below",
  threshold: "-10",
  tolerance: "5",
  consecutiveMonths: 2,
  reportingLagMonths: 0,
};
const observations: TriggerObservation[] = ["2026-10", "2026-11"].map(
  (month) => ({
    month,
    observationId: month,
    predicted: "100",
    observed: "80",
    coverage: "complete",
    unit: "hours",
    scope: "All delivery staff",
  }),
);
describe("bounded operating review triggers", () => {
  it("requires every consecutive period and compares exact differences beyond tolerance", () => {
    expect(evaluate(rule, observations, "2026-12-01")).toMatchObject({
      status: "triggered",
      window: ["2026-10", "2026-11"],
      boundary: "-15",
    });
    expect(
      evaluate(
        rule,
        [observations[0]!, { ...observations[1]!, observed: "85" }],
        "2026-12-01",
      ).status,
    ).toBe("clear");
    expect(
      evaluate(
        rule,
        [observations[0]!, { ...observations[1]!, observed: "84.999999" }],
        "2026-12-01",
      ).status,
    ).toBe("triggered");
    expect(
      evaluate(
        { ...rule, direction: "above", threshold: "10", measure: "observed" },
        observations,
        "2026-12-01",
      ).status,
    ).toBe("triggered");
  });
  it("keeps missing, partial, changed, mismatched and ambiguous evidence insufficient, even if another month is clear", () => {
    for (const change of [
      { coverage: "partial" },
      { coverage: "unavailable" },
      { observed: null },
      { scope: "Only contractors" },
      { unit: "jobs" },
      { observationId: null },
    ])
      expect(
        evaluate(
          rule,
          [
            { ...observations[0]!, observed: "100" },
            { ...observations[1]!, ...change },
          ],
          "2026-12-01",
        ).status,
      ).toBe("insufficient_data");
    expect(
      evaluate(rule, observations.slice(1), "2026-12-01").periods[0],
    ).toMatchObject({ predicted: null, value: null, qualifies: null });
    expect(
      evaluate(rule, [...observations, observations[0]!], "2026-12-01").status,
    ).toBe("insufficient_data");
  });
  it("does not treat old observations as fresh or include an open month; reporting delay is explicit", () => {
    expect(evaluate(rule, observations, "2027-01-01")).toMatchObject({
      status: "insufficient_data",
      window: ["2026-11", "2026-12"],
    });
    expect(
      evaluate({ ...rule, reportingLagMonths: 1 }, observations, "2027-01-01")
        .status,
    ).toBe("triggered");
    expect(evaluate(rule, observations, "2026-11-30").window).toEqual([
      "2026-09",
      "2026-10",
    ]);
  });
  it("treats zero as a valid complete observation and dates as calendar reminders", () => {
    expect(
      evaluate(
        {
          ...rule,
          measure: "observed",
          threshold: "0",
          tolerance: "0",
          direction: "above",
        },
        observations.map((o) => ({ ...o, observed: "0" })),
        "2026-12-01",
      ).status,
    ).toBe("clear");
    expect(
      evaluate({ kind: "review_date", dueDate: "2026-12-01" }, [], "2026-11-30")
        .status,
    ).toBe("clear");
    expect(
      evaluate({ kind: "review_date", dueDate: "2026-12-01" }, [], "2026-12-01")
        .status,
    ).toBe("triggered");
    expect(() =>
      evaluate(
        { kind: "review_date", dueDate: "2026-02-30" },
        [],
        "2026-12-01",
      ),
    ).toThrow();
    expect(() =>
      evaluate({ ...rule, consecutiveMonths: 7 }, observations, "2026-12-01"),
    ).toThrow();
  });
});
