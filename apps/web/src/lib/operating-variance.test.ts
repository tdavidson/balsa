import { describe, expect, it } from "vitest";
import {
  buildForecastRun,
  evaluateOperatingModel,
  explainOperatingVariance,
  type OperatingModel,
} from "@balsa/finance-engine";
import { fixtureBaseInput } from "@/test/forecast-fixture";
import { applyScenarioChanges, type ScenarioChange } from "./scenario-changes";
import { replayOperatingFinancialEffects } from "./operating-variance";
import type { GoalDecisionSnapshot } from "./goal-decisions-contract";
const model: OperatingModel = {
  name: "Synthetic rate",
  description: "Synthetic incremental receipt",
  startMonth: "2026-09",
  months: 3,
  nodes: [
    {
      id: "receipt",
      label: "Receipt",
      unit: "USD",
      op: "input",
      args: [],
      values: [
        { month: "2026-09", value: "20000" },
        { month: "2026-10", value: "0" },
      ],
      initial: null,
      rationale: "Synthetic",
      evidenceIds: [],
    },
  ],
  outputs: [
    {
      nodeId: "receipt",
      label: "Receipt",
      direction: "receipt",
      category: "other",
    },
  ],
  cases: [],
  limitations: [],
};
const baseline = evaluateOperatingModel(model);
const changes: ScenarioChange[] = [
  {
    kind: "add_driver",
    label: "Receipt",
    direction: "receipt",
    amount: 20000,
    cadence: "once",
    effectiveFrom: "2026-09",
    category: "other",
  },
];
const input = applyScenarioChanges(fixtureBaseInput([]), changes, "synthetic");
const original = buildForecastRun(input);
const approval = {
  type: "applied",
  appliedOutlook: { output: original },
  preview: {
    scenario: { id: "synthetic", changes },
    scenarioInput: input,
    scenarioRun: original,
  },
} as unknown as GoalDecisionSnapshot;
const variance = explainOperatingVariance(
  model,
  baseline,
  [
    {
      id: "source",
      nodeId: "receipt",
      month: "2026-09",
      value: "16000",
      coverage: "complete",
    },
  ],
  "2026-09",
  "2026-10-31",
);
describe("operating variance financial replay", () => {
  it("replaces original contributions through balanced journal projections and preserves actuals", () => {
    const frozen = structuredClone(approval);
    const replay = replayOperatingFinancialEffects(
      variance,
      approval,
      "2026-09",
    );
    expect(replay.status).toBe("available");
    if (replay.status !== "available") return;
    expect(
      replay.months
        .filter((m) => m.basis === "forecast")
        .every((m) => m.endingDifferenceMinor === "-400000"),
    ).toBe(true);
    expect(
      replay.months
        .filter((m) => m.basis === "actual")
        .every((m) => m.endingDifferenceMinor === "0"),
    ).toBe(true);
    expect(
      replay.replayRun.projectedLines.reduce(
        (sum, l) => sum + BigInt(l.debitMinor) - BigInt(l.creditMinor),
        0n,
      ),
    ).toBe(0n);
    expect(replay.replayInput.drivers).toHaveLength(1);
    expect(replay.replayInput.drivers[0]!.amountMinor).toBe("1600000");
    expect(approval).toEqual(frozen);
  });
  it("replaces inherited uncommitted contributions once when explaining a revised plan", () => {
    const inherited = structuredClone(approval);
    if (inherited.type !== "applied") throw Error("Expected approval");
    const driverId = inherited.preview.scenarioInput.drivers[0]!.id;
    inherited.preview.scenario = {
      ...inherited.preview.scenario,
      id: "revision",
      changes: [],
    };
    const replay = replayOperatingFinancialEffects(
      variance,
      inherited,
      "2026-09",
      [
        {
          nodeId: "receipt",
          month: "2026-09",
          driverId,
          amountMinor: "2000000",
        },
      ],
    );
    expect(replay.status).toBe("available");
    if (replay.status !== "available") return;
    expect(replay.replayInput.drivers).toHaveLength(1);
    expect(replay.replayInput.drivers[0]!.amountMinor).toBe("1600000");
    expect(
      replay.months
        .filter((m) => m.basis === "forecast")
        .every((m) => m.endingDifferenceMinor === "-400000"),
    ).toBe(true);
  });
  it("rejects an incompatible preserved financial version or tampered original totals", () => {
    const old = structuredClone(approval);
    if (old.type !== "applied") throw Error("Expected applied");
    old.preview.scenarioRun.formulaVersion = "old";
    expect(
      replayOperatingFinancialEffects(variance, old, "2026-09").status,
    ).toBe("unavailable");
    const corrupt = structuredClone(approval);
    if (corrupt.type !== "applied") throw Error("Expected applied");
    corrupt.preview.scenarioRun.months[0]!.endingCashMinor = "1";
    expect(
      replayOperatingFinancialEffects(variance, corrupt, "2026-09").status,
    ).toBe("unavailable");
  });
  it("does not assert financial effects with missing accounting mappings", () => {
    const unsupported = structuredClone(approval);
    if (unsupported.type !== "applied") throw Error("Expected applied");
    unsupported.preview.scenarioInput.templates = [];
    unsupported.preview.scenarioRun = buildForecastRun(
      unsupported.preview.scenarioInput,
    );
    expect(
      replayOperatingFinancialEffects(variance, unsupported, "2026-09").status,
    ).toBe("unavailable");
  });
});
