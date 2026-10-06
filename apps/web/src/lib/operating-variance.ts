import {
  buildForecastRun,
  forecastFormulaVersion,
  stableJson,
  type ForecastRun,
  type OperatingVariance,
  type OperatingCashBinding,
} from "@balsa/finance-engine";
import {
  applyScenarioChanges,
  scenarioDriverId,
  type ScenarioChange,
} from "./scenario-changes";
import type { GoalDecisionSnapshot } from "./goal-decisions-contract";

const comparableMonths = (run: ForecastRun) =>
  run.months.map(({ driverIds: _, ...row }) => {
    void _;
    return row;
  });
const journalTotals = (run: ForecastRun) => {
  const totals = new Map<string, { debit: bigint; credit: bigint }>();
  for (const line of run.projectedLines) {
    const key = JSON.stringify([
      line.period,
      line.accountId,
      line.currency,
      line.entityId ?? null,
    ]);
    const prior = totals.get(key) ?? { debit: 0n, credit: 0n };
    totals.set(key, {
      debit: prior.debit + BigInt(line.debitMinor),
      credit: prior.credit + BigInt(line.creditMinor),
    });
  }
  return [...totals]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => [key, String(v.debit), String(v.credit)]);
};

/** A counterfactual on the approval's frozen accounting inputs, never today's
 * forecast plus another copy of this model. No posting or scenario is saved.
 */
export function replayOperatingFinancialEffects(
  variance: OperatingVariance,
  approval: GoalDecisionSnapshot | null,
  forecastStart: string,
  retainedBindings: OperatingCashBinding[] = [],
) {
  const unavailable = (reason: string) => ({
    status: "unavailable" as const,
    reason,
  });
  if (variance.status !== "available")
    return unavailable(
      "Operating relationships must reproduce the preserved run before financial effects can be replayed.",
    );
  if (!approval || approval.type !== "applied" || !approval.appliedOutlook)
    return unavailable(
      "The original approved financial inputs are unavailable.",
    );
  const original = approval.preview.scenarioRun;
  if (original.formulaVersion !== forecastFormulaVersion)
    return unavailable(
      "The preserved accounting formula version cannot be replayed with this evaluator.",
    );
  try {
    const reproduced = buildForecastRun(approval.preview.scenarioInput);
    if (
      stableJson(comparableMonths(reproduced)) !==
        stableJson(comparableMonths(original)) ||
      stableJson(journalTotals(reproduced)) !==
        stableJson(journalTotals(original))
    )
      return unavailable(
        "The original financial result cannot be reproduced exactly. The preserved forecast remains available.",
      );
    const scenarioId = approval.preview.scenario.id;
    const owned = new Set(
      approval.preview.scenario.changes.flatMap((change, index) =>
        change.kind === "add_driver"
          ? [scenarioDriverId(scenarioId, index)]
          : [],
      ),
    );
    const input = approval.preview.scenarioInput;
    if (
      input.settlement?.occurrences.some(
        (o) => o.driverId && owned.has(o.driverId),
      )
    )
      return unavailable(
        "This financial replay needs explicit settlement-aware replacement of the original model contributions.",
      );
    const preserved = new Set<string>();
    for (const binding of retainedBindings) {
      if (
        input.settlement?.occurrences.some(
          (o) => o.driverId === binding.driverId,
        )
      ) {
        const row = variance.revised.cash.find(
          (c) => c.nodeId === binding.nodeId && c.month === binding.month,
        );
        if (
          binding.month >= forecastStart &&
          row?.amountMinor !== binding.amountMinor
        )
          return unavailable(
            "The counterfactual changes an inherited captured obligation. Reconcile that commitment before interpreting a replacement cash schedule.",
          );
        preserved.add(`${binding.nodeId}:${binding.month}`);
      } else owned.add(binding.driverId);
    }
    const replayBase = {
      ...input,
      drivers: input.drivers.filter((d) => !owned.has(d.id)),
    };
    const changes: ScenarioChange[] = variance.revised.cash
      .filter(
        (row) =>
          row.month >= forecastStart &&
          !preserved.has(`${row.nodeId}:${row.month}`),
      )
      .map((row) => ({
        kind: "add_driver",
        label: row.label,
        direction: row.direction,
        amount: Number(row.amountMinor) / 100,
        cadence: "once",
        effectiveFrom: row.month,
        category: row.category,
      }));
    const replayInput = applyScenarioChanges(replayBase, changes, scenarioId);
    const replayRun = buildForecastRun(replayInput);
    if (replayRun.exceptions.length || original.exceptions.length)
      return unavailable(
        "Resolve unsupported financial calculations before interpreting this replay. No financial effect was asserted.",
      );
    const months = original.months.map((before) => {
      const after = replayRun.months.find((m) => m.month === before.month)!;
      return {
        month: before.month,
        basis: before.basis,
        originalOpeningMinor: before.openingCashMinor,
        replayedOpeningMinor: after.openingCashMinor,
        originalEndingMinor: before.endingCashMinor,
        replayedEndingMinor: after.endingCashMinor,
        endingDifferenceMinor: String(
          BigInt(after.endingCashMinor) - BigInt(before.endingCashMinor),
        ),
        receiptsDifferenceMinor: String(
          BigInt(after.receiptsMinor) - BigInt(before.receiptsMinor),
        ),
        spendingDifferenceMinor: String(
          BigInt(after.spendingMinor) - BigInt(before.spendingMinor),
        ),
      };
    });
    return {
      status: "available" as const,
      formulaVersion: forecastFormulaVersion,
      months,
      replayInput,
      replayRun,
      notice:
        "Replayed against the information and accounting treatment preserved at approval. This is a modeled consequence of observed operating inputs, not today's forecast or an explanation of actual company cash. Other decisions and newly observed cash are not added here.",
    };
  } catch {
    return unavailable(
      "Observed inputs could not be translated into supported journal and cash calculations. Review the source mappings and cash outputs.",
    );
  }
}
