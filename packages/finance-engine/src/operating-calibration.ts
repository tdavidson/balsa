import { formatDecimal, parseDecimal } from "./forecast-model";
import { isValidMonth } from "./periods";
export const operatingCalibrationVersion = "operating-calibration-2026-10-05.1";
export type CalibrationSample = {
  predictionId: string;
  observationId: string | null;
  month: string;
  approvedAt: string;
  predicted: string;
  observed: string | null;
  coverage: string;
  unit: string;
  scope: string;
  knownAt: string | null;
};
const abs = (n: bigint) => (n < 0n ? -n : n);
const monthNumber = (m: string) =>
  Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));
/** A user-reviewed metric binding is the cohort boundary. Never infer equivalence
 * from labels. Overlapping forecasts share one outcome, not independent samples. */
export function calibrateOperatingMetric(
  samples: CalibrationSample[],
  binding: {
    horizonMonths?: number;
    metricId: string;
    unit: string;
    scope: string;
    aggregation: "monthly_total" | "month_end" | "monthly_average";
  },
  throughDate: string,
) {
  const horizonMonths = binding.horizonMonths ?? 1;
  if (
    !Number.isInteger(horizonMonths) ||
    horizonMonths < 1 ||
    horizonMonths > 24
  )
    throw new Error("Choose a forecast age of 1–24 months.");
  if (
    !binding.metricId.trim() ||
    !binding.scope.trim() ||
    !binding.unit.trim() ||
    samples.length > 600
  )
    throw new Error("Choose a bounded, explicit metric cohort.");
  const excluded: { predictionId: string; month: string; reason: string }[] =
    [];
  const eligible: (CalibrationSample & { horizon: number; error: string })[] =
    [];
  for (const s of samples) {
    let reason = "";
    if (!isValidMonth(s.month) || !Number.isFinite(Date.parse(s.approvedAt)))
      reason = "Invalid prediction period or cutoff";
    else if (s.month >= throughDate.slice(0, 7))
      reason = "Period has not matured";
    else if (s.approvedAt.slice(0, 7) >= s.month)
      reason = "Prediction was approved during or after the measured period";
    else if (
      monthNumber(s.month) - monthNumber(s.approvedAt.slice(0, 7)) !==
      horizonMonths
    )
      reason = "Different forecast horizon";
    else if (s.unit !== binding.unit || s.scope !== binding.scope)
      reason = "Incompatible unit or scope";
    else if (
      s.coverage !== "complete" ||
      s.observed === null ||
      !s.observationId
    )
      reason = "Missing, partial or withdrawn observation";
    else if (
      !s.knownAt ||
      !Number.isFinite(Date.parse(s.knownAt)) ||
      s.knownAt.slice(0, 10) > throughDate
    )
      reason = "Observation was not known at the report cutoff";
    const p = parseDecimal(s.predicted),
      o = s.observed === null ? null : parseDecimal(s.observed);
    if (p === null || o === null) reason ||= "Unavailable exact value";
    if (reason) {
      excluded.push({ predictionId: s.predictionId, month: s.month, reason });
      continue;
    }
    eligible.push({
      ...s,
      horizon: monthNumber(s.month) - monthNumber(s.approvedAt.slice(0, 7)),
      error: formatDecimal(p! - o!),
    });
  }
  // Conflicting mappings to the same measured month are never silently averaged.
  const conflicts = new Set(
    eligible
      .filter((a) =>
        eligible.some((b) => a.month === b.month && a.observed !== b.observed),
      )
      .map((s) => s.month),
  );
  const seen = new Set<string>();
  const scored = eligible
    .sort(
      (a, b) =>
        a.approvedAt.localeCompare(b.approvedAt) ||
        a.predictionId.localeCompare(b.predictionId),
    )
    .filter((s) => {
      const reason = conflicts.has(s.month)
        ? "Conflicting observations for the same outcome"
        : seen.has(s.month)
          ? "Overlapping forecast of an already counted outcome"
          : null;
      if (reason) {
        excluded.push({ predictionId: s.predictionId, month: s.month, reason });
        return false;
      }
      seen.add(s.month);
      return true;
    })
    .sort((a, b) => a.month.localeCompare(b.month));
  function metrics(rows: typeof scored, adjustment = 0n) {
    if (!rows.length)
      return { count: 0, bias: null, mae: null, wapePercent: null };
    const errors = rows.map((s) => parseDecimal(s.error)! - adjustment),
      total = rows.reduce((n, s) => n + abs(parseDecimal(s.observed!)!), 0n),
      absolute = errors.reduce((n, e) => n + abs(e), 0n);
    return {
      count: rows.length,
      bias: formatDecimal(
        errors.reduce((n, e) => n + e, 0n) / BigInt(rows.length),
      ),
      mae: formatDecimal(absolute / BigInt(rows.length)),
      wapePercent:
        total === 0n ? null : formatDecimal((absolute * 100_000_000n) / total),
    };
  }
  const horizons = [...new Set(scored.map((s) => s.horizon))]
    .sort((a, b) => a - b)
    .map((horizon) => ({
      horizon,
      ...metrics(scored.filter((s) => s.horizon === horizon)),
    }));
  // A calibration is fit on earlier outcomes and evaluated only on later ones.
  const split = Math.floor(scored.length * 0.6),
    test = scored.slice(split);
  const fitCutoff = test.map((s) => s.approvedAt).sort()[0] ?? throughDate;
  const train = scored.slice(0, split).filter((s) => s.knownAt! < fitCutoff);
  const adjustment = train.length ? parseDecimal(metrics(train).bias!)! : 0n;
  const baseline = metrics(test),
    adjusted = metrics(test, adjustment);
  const enough = train.length >= 5 && test.length >= 3;
  const improved =
    enough && parseDecimal(adjusted.mae!)! < parseDecimal(baseline.mae!)!;
  return {
    formulaVersion: operatingCalibrationVersion,
    binding,
    throughDate,
    samples,
    scored,
    excluded,
    horizons,
    metrics: metrics(scored),
    coverage: {
      eligible: scored.length,
      considered: samples.length,
      excluded: excluded.length,
    },
    calibration: {
      status: !enough
        ? ("insufficient" as const)
        : improved
          ? ("proposal" as const)
          : ("not_supported" as const),
      fitCutoff,
      trainingMonths: train.map((s) => s.month),
      holdoutMonths: test.map((s) => s.month),
      subtractFromFuturePrediction: enough ? formatDecimal(adjustment) : null,
      baselineHoldout: baseline,
      adjustedHoldout: adjusted,
      notice: !enough
        ? "At least five earlier training outcomes and three later holdout outcomes are required. No confidence score or adjustment is inferred."
        : "This constant-bias adjustment is a scoped assumption proposal. Only the selected forecast age is fitted and scored. Approval and future validation are still required.",
    },
  };
}
