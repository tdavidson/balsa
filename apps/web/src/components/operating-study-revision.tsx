"use client";
import { useId, useState } from "react";
import {
  addMonths,
  formatDecimal,
  parseDecimal,
  type OperatingPlanInput,
} from "@balsa/finance-engine";
import type { OperatingStudyPreview } from "@/lib/operating-studies";
import type { loadOperatingTriggers } from "@/lib/operating-triggers";
import { OperatingPlanRevisions } from "./operating-plan-revisions";
import { Button } from "./ui/button";
import { Field, FieldLabel } from "./ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "./ui/select";
export function OperatingStudyRevision({
  preview,
  studyId,
}: {
  preview: OperatingStudyPreview;
  studyId: string | null;
}) {
  const [reviews, setReviews] = useState<{ id: string; name: string }[] | null>(
      null,
    ),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    id = useId();
  const prediction = preview.context.prediction,
    definition = preview.definition,
    result = preview.result;
  if (!prediction || !studyId || !preview.context.predictionId) return null;
  const inputs: OperatingPlanInput[] = [];
  const start =
    definition.kind === "calibration"
      ? addMonths(
          preview.context.base.output.horizon.start,
          definition.binding.horizonMonths,
        )
      : preview.context.base.output.horizon.start;
  if (
    result.kind === "calibration" &&
    definition.kind === "calibration" &&
    result.report.calibration.status === "proposal"
  ) {
    const node = prediction.model.nodes.find(
        (n) => n.id === definition.binding.nodeId,
      ),
      index = prediction.operating.months.indexOf(start);
    if (node?.op !== "input" || index < 0)
      return (
        <p className="text-sm">
          This calibrated metric is not a future input. Review its upstream
          assumptions before proposing a change.
        </p>
      );
    const value = formatDecimal(
      parseDecimal(prediction.operating.values[node.id]![index]!)! -
        parseDecimal(result.report.calibration.subtractFromFuturePrediction!)!,
    );
    inputs.push({
      nodeId: node.id,
      month: start,
      value,
      reason: `User-assumption proposal from preserved calibration study ${studyId}; subtract ${result.report.calibration.subtractFromFuturePrediction} ${node.unit}. Metric ${definition.binding.metricId}; ${definition.binding.scope}; ${definition.binding.aggregation}. Requires prospective validation.`,
    });
    const next = prediction.operating.months[index + 1];
    if (next)
      inputs.push({
        nodeId: node.id,
        month: next,
        value: prediction.operating.values[node.id]![index + 1]!,
        reason: `Restore the original assumption after the single calibrated forecast-age period from study ${studyId}.`,
      });
  } else if (result.kind === "conditional") {
    for (const node of prediction.model.nodes.filter((n) => n.op === "input")) {
      const months = prediction.operating.months.filter((m) => m >= start);
      if (
        !months.some((m) => {
          const i = prediction.operating.months.indexOf(m);
          return (
            prediction.operating.values[node.id]![i] !==
            result.operating.operating.values[node.id]![i]
          );
        })
      )
        continue;
      for (const month of months) {
        const i = prediction.operating.months.indexOf(month);
        inputs.push({
          nodeId: node.id,
          month,
          value: result.operating.operating.values[node.id]![i]!,
          reason: `User-assumption proposal from preserved conditional study ${studyId}; basis ${result.operating.mode}. The sampled or historical condition is not approval.`,
        });
      }
    }
  } else return null;
  if (!inputs.length || inputs.length > 40)
    return (
      <p className="text-sm">
        Use Reviews to select up to 40 future input changes from this study.
      </p>
    );
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        Review these {inputs.length} dated assumption changes against a
        currently open review. The preserved study is supporting analysis; its
        hypotheses still need your judgment and approval.
      </p>
      <Button
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const response = await fetch(
              `/api/operating-triggers?predictionId=${preview.context.predictionId}`,
              { cache: "no-store" },
            );
            const data = (await response.json()) as Awaited<
              ReturnType<typeof loadOperatingTriggers>
            > & { error?: string };
            if (!response.ok || data.companyId !== preview.companyId)
              throw new Error(data.error ?? "Company selection changed.");
            setReviews(
              data.rules.flatMap((r) =>
                r.active &&
                r.review &&
                ["open", "acknowledged"].includes(r.review.effectiveStatus)
                  ? [{ id: r.review.id, name: r.name }]
                  : [],
              ),
            );
          } catch (e) {
            setError(e instanceof Error ? e.message : "Review lookup failed.");
          } finally {
            setBusy(false);
          }
        }}
      >
        Choose a review for this proposal
      </Button>
      {error && <p role="alert">{error}</p>}
      {reviews && reviews.length === 0 && (
        <p>
          No open review is available. Create and explicitly evaluate a review
          rule for this prediction in Reviews.
        </p>
      )}
      {!!reviews?.length && (
        <Field>
          <FieldLabel htmlFor={id}>Open review</FieldLabel>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger id={id}>
              <SelectValue placeholder="Choose a review" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {reviews.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      )}
      {selected && (
        <OperatingPlanRevisions
          key={`${studyId}:${selected}`}
          companyId={preview.companyId}
          reviewId={selected}
          initialInputs={inputs}
        />
      )}
    </div>
  );
}
