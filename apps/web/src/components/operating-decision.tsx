"use client";
import { OperatingThresholdChart } from "./operating-threshold-chart";
import { useState } from "react";
import type { OperatingDecision, OperatingModel } from "@balsa/finance-engine";
import type { OperatingDecisionAnalysis } from "@/lib/operating-decision-analysis";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { exactMoney as money } from "./opening-cash-review";
const unchanged = "__unchanged__";
export const defaultOperatingDecision = (
  model: OperatingModel,
): OperatingDecision => ({
  question: model.description,
  deadline: null,
  constraints: [],
  caseId: "base",
  compareCaseId: unchanged,
  metric: "ending_cash",
  cashFloorMinor: "0",
  ranges: [],
});
export function OperatingDecisionForm({
  model,
  disabled,
  onChange,
  currency,
}: {
  model: OperatingModel;
  disabled: boolean;
  currency: string;
  onChange: (model: OperatingModel) => void;
}) {
  const decision = model.decision ?? defaultOperatingDecision(model);
  const [floorDraft, setFloorDraft] = useState<string | null>(null);
  const floorDisplay = /^-?\d+$/.test(decision.cashFloorMinor)
    ? (() => {
        const n = BigInt(decision.cashFloorMinor);
        const a = n < 0n ? -n : n;
        return `${n < 0n ? "-" : ""}${a / 100n}.${String(a % 100n).padStart(2, "0")}`;
      })()
    : "";
  const patch = (next: Partial<OperatingDecision>) =>
    onChange({ ...model, decision: { ...decision, ...next } });
  const choices = [
    { id: unchanged, name: "Do nothing — current forecast" },
    { id: "base", name: model.name },
    ...model.cases,
  ];
  return (
    <section className="flex flex-col gap-4" aria-label="Decision brief">
      <h3 className="text-xl font-semibold">Frame the decision</h3>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="decision-question">Decision to make</FieldLabel>
          <Textarea
            id="decision-question"
            disabled={disabled}
            value={decision.question}
            maxLength={2000}
            onChange={(e) => patch({ question: e.target.value })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="decision-deadline">
            Decision deadline (optional)
          </FieldLabel>
          <Input
            id="decision-deadline"
            type="date"
            disabled={disabled}
            value={decision.deadline ?? ""}
            onChange={(e) => patch({ deadline: e.target.value || null })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="decision-constraints">
            Constraints to review (one per line)
          </FieldLabel>
          <Textarea
            id="decision-constraints"
            disabled={disabled}
            value={decision.constraints.join("\n")}
            onChange={(e) =>
              patch({ constraints: e.target.value.split("\n").slice(0, 10) })
            }
            placeholder="For example: preserve delivery quality; no new permanent hires."
          />
          <p className="text-sm text-muted-foreground">
            These are review questions, not automatically satisfied conditions.
            Put binding approval conditions in your cash goals.
          </p>
        </Field>
        {(["caseId", "compareCaseId"] as const).map((key) => (
          <Field key={key}>
            <FieldLabel>
              {key === "caseId" ? "Action to evaluate" : "Compare with"}
            </FieldLabel>
            <Select
              value={decision[key]}
              disabled={disabled}
              onValueChange={(value) => patch({ [key]: value })}
            >
              <SelectTrigger
                aria-label={
                  key === "caseId" ? "Action to evaluate" : "Comparison action"
                }
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {choices
                    .filter(
                      (c) => key === "compareCaseId" || c.id !== unchanged,
                    )
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        ))}
        <Field>
          <FieldLabel>Cash measure to compare</FieldLabel>
          <Select
            disabled={disabled}
            value={decision.metric}
            onValueChange={(value) =>
              patch({ metric: value as OperatingDecision["metric"] })
            }
          >
            <SelectTrigger aria-label="Cash measure">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="ending_cash">
                  Ending cash at model horizon
                </SelectItem>
                <SelectItem value="minimum_cash">
                  Lowest month-end cash in horizon
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="decision-floor">
            Minimum month-end cash ({currency})
          </FieldLabel>
          <Input
            id="decision-floor"
            inputMode="decimal"
            disabled={disabled}
            value={floorDraft ?? floorDisplay}
            onChange={(e) => {
              const text = e.target.value;
              setFloorDraft(text);
              const match = /^(-?)(\d+)(?:\.(\d{0,2}))?$/.exec(text);
              patch({
                cashFloorMinor: match
                  ? String(
                      (BigInt(match[2]!) * 100n +
                        BigInt((match[3] ?? "").padEnd(2, "0"))) *
                        (match[1] ? -1n : 1n),
                    )
                  : "invalid",
              });
            }}
          />
          <p className="text-sm text-muted-foreground">
            This analysis constraint does not create an approval policy.
          </p>
        </Field>
      </FieldGroup>
      <h4 className="font-semibold">What could change the answer?</h4>
      <p className="text-sm text-muted-foreground">
        Choose up to four uncertain inputs and ranges you can defend. Eleven
        sample values are tested per range, with other inputs held fixed. Ranges
        are assumptions, not confidence intervals.
      </p>
      {decision.ranges.map((range, i) => (
        <FieldGroup key={range.nodeId} className="rounded-lg border p-4">
          <p className="font-medium">
            {model.nodes.find((n) => n.id === range.nodeId)?.label} ·{" "}
            {model.nodes.find((n) => n.id === range.nodeId)?.unit}
          </p>
          {(["from", "low", "high"] as const).map((key) => (
            <Field key={key}>
              <FieldLabel htmlFor={`range-${i}-${key}`}>
                {key === "from"
                  ? "Effective month"
                  : key === "low"
                    ? "Lower bound"
                    : "Upper bound"}
              </FieldLabel>
              <Input
                id={`range-${i}-${key}`}
                disabled={disabled}
                type={key === "from" ? "month" : "text"}
                value={range[key]}
                onChange={(e) =>
                  patch({
                    ranges: decision.ranges.map((r, j) =>
                      i === j ? { ...r, [key]: e.target.value } : r,
                    ),
                  })
                }
              />
            </Field>
          ))}
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() =>
              patch({ ranges: decision.ranges.filter((_, j) => j !== i) })
            }
          >
            Remove range
          </Button>
        </FieldGroup>
      ))}
      {decision.ranges.length < 4 && (
        <Select
          value=""
          disabled={disabled}
          onValueChange={(nodeId) =>
            patch({
              ranges: [
                ...decision.ranges,
                { nodeId, from: model.startMonth, low: "", high: "" },
              ],
            })
          }
        >
          <SelectTrigger aria-label="Add an uncertain input">
            <SelectValue placeholder="Choose an input to investigate" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {model.nodes
                .filter(
                  (n) =>
                    n.op === "input" &&
                    !decision.ranges.some((r) => r.nodeId === n.id),
                )
                .map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.label} · {n.unit}
                  </SelectItem>
                ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}
    </section>
  );
}
export function OperatingDecisionResults({
  analysis,
  currency,
  actualMonths,
}: {
  analysis: OperatingDecisionAnalysis;
  currency: string;
  actualMonths: { month: string; endingCashMinor: string }[];
}) {
  const [focus, setFocus] = useState<string | null>(null);
  const left = analysis.choices.find(
    (c) => c.id === analysis.comparison.leftId,
  )!;
  const right = analysis.choices.find(
    (c) => c.id === analysis.comparison.rightId,
  )!;
  const amount = (value: string | null) =>
    value === null ? "Unavailable" : money(value, currency);
  const chosen =
    analysis.sensitivities.find((s) => s.nodeId === focus) ??
    analysis.sensitivities[0];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Make the decision explicit</CardTitle>
        <CardDescription>
          {analysis.spec.question}
          {analysis.spec.deadline
            ? ` · Decision due ${analysis.spec.deadline}`
            : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <p className="text-sm text-muted-foreground">{analysis.notice}</p>
        <details>
          <summary className="cursor-pointer font-medium">
            Observed results versus assumptions
          </summary>
          <p className="mt-2 text-sm text-muted-foreground">
            Recorded actual cash comes from posted journals; coverage may be
            incomplete. Approved source facts are labeled in the evidence
            connection review. User assumptions and AI suggestions remain
            assumptions after approval.
          </p>
          <ul className="mt-2 text-sm">
            {actualMonths.map((m) => (
              <li key={m.month}>
                {m.month} · Recorded actual ending cash:{" "}
                {amount(m.endingCashMinor)}
              </li>
            ))}
          </ul>
          <a className="text-sm underline" href="/progress">
            Inspect cash calculations and coverage
          </a>
        </details>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="mb-2 text-left">
              Available actions, including doing nothing
            </caption>
            <thead>
              <tr>
                {[
                  "Action",
                  "Cash measure",
                  "Lowest cash",
                  "Cash floor",
                  "Other constraints",
                ].map((h) => (
                  <th scope="col" className="p-3 text-left" key={h}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {analysis.choices.map((c) => (
                <tr className="border-t" key={c.id}>
                  <th scope="row" className="p-3 text-left">
                    {c.name}
                  </th>
                  <td className="p-3 tabular-nums">{amount(c.valueMinor)}</td>
                  <td className="p-3 tabular-nums">
                    {c.valueMinor === null
                      ? "Unavailable"
                      : amount(c.minimumCashMinor)}
                  </td>
                  <td className="p-3">
                    {c.meetsCashFloor === null
                      ? "Unavailable"
                      : c.meetsCashFloor
                        ? "Meets tested floor"
                        : "Breaches tested floor"}
                  </td>
                  <td className="p-3">
                    {c.constraints.length
                      ? c.constraints.map((r) => (
                          <p key={r.label}>{r.label} — needs review</p>
                        ))
                      : "None specified"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {analysis.comparison.exceptions.length > 0 ? (
          <section>
            <h3 className="font-semibold">Comparison unavailable</h3>
            <ul className="list-disc pl-5 text-sm">
              {analysis.comparison.exceptions.map((e, i) => (
                <li key={i}>{e.reason}</li>
              ))}
            </ul>
          </section>
        ) : (
          <section className="flex flex-col gap-3">
            <h3 className="text-lg font-semibold">
              Why {left.name} and {right.name} differ
            </h3>
            <p className="text-sm text-muted-foreground">
              {analysis.comparison.notice}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="p-2 text-left">Month</th>
                    <th className="p-2 text-left">{left.name}</th>
                    <th className="p-2 text-left">{right.name}</th>
                    <th className="p-2 text-left">Ending cash difference</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.comparison.monthly.map((m) => (
                    <tr className="border-t" key={m.month}>
                      <th scope="row" className="p-2 text-left">
                        {m.month}
                      </th>
                      {[m.leftMinor, m.rightMinor, m.deltaMinor].map((v, i) => (
                        <td className="p-2 tabular-nums" key={i}>
                          {amount(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details open>
              <summary className="cursor-pointer font-medium">
                Trace the difference to cash flows and input assumptions
              </summary>
              {analysis.comparison.outputs.map((o) => (
                <div className="mt-3" key={o.nodeId}>
                  <p className="font-medium">
                    {o.label} · cash {o.direction === "receipt" ? "in" : "out"}
                  </p>
                  <ul className="text-sm">
                    {o.months
                      .filter((m) => m.cashEffectMinor !== "0")
                      .map((m) => (
                        <li key={m.month}>
                          {m.month}: {amount(m.leftMinor)} versus{" "}
                          {amount(m.rightMinor)} → {amount(m.cashEffectMinor)}{" "}
                          contribution to cash difference
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {analysis.comparison.inputs.map((n) => (
                  <div key={n.nodeId} className="rounded-md border p-3">
                    <p className="font-medium">
                      {n.label} · {n.unit}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {n.basis === "user_assumption"
                        ? "User assumption"
                        : n.basis === "ai_suggestion"
                          ? "AI suggestion"
                          : "Unclassified assumption"}{" "}
                      · {n.evidenceIds.length} source references; references do
                      not verify an assumption
                    </p>
                    <p className="break-words text-sm">
                      {left.name}:{" "}
                      {n.left?.join(" → ") ?? "No incremental operating model"}
                    </p>
                    <p className="break-words text-sm">
                      {right.name}:{" "}
                      {n.right?.join(" → ") ?? "No incremental operating model"}
                    </p>
                  </div>
                ))}
              </div>
            </details>
          </section>
        )}
        <section className="flex flex-col gap-3">
          <h3 className="text-lg font-semibold">What to verify next</h3>
          {analysis.research.length ? (
            <ol className="flex list-decimal flex-col gap-3 pl-5">
              {analysis.research.map((r) => (
                <li key={r.nodeId}>
                  <button
                    className="text-left underline"
                    onClick={() => setFocus(r.nodeId)}
                  >
                    {r.question}
                  </button>
                  <p className="text-sm text-muted-foreground">
                    Tested cash variation: {amount(r.swingMinor)}.{" "}
                    {r.canChangePreference
                      ? "The comparison crosses or reaches a tie in this range."
                      : "No comparison crossing detected at the tested values."}{" "}
                    {!r.complete &&
                      "Some values could not be calculated; ranking is incomplete."}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">
              Add uncertain input ranges above and calculate again to prioritize
              research.
            </p>
          )}
        </section>
        {chosen && (
          <section className="flex flex-col gap-3">
            <h3 className="text-lg font-semibold">
              Tested thresholds: {chosen.label}
            </h3>
            <p className="text-sm text-muted-foreground">{chosen.notice}</p>
            <OperatingThresholdChart
              range={chosen}
              leftName={left.name}
              rightName={right.name}
              currency={currency}
            />
            <ul className="list-disc pl-5 text-sm">
              {chosen.crossings.length ? (
                chosen.crossings.map((c, i) => (
                  <li key={i}>
                    {c.kind === "preference"
                      ? "Cash comparison changes sign or reaches a tie"
                      : "Cash floor is crossed or reached"}{" "}
                    between {c.low} and {c.high} {chosen.unit}.
                  </li>
                ))
              ) : (
                <li>
                  No threshold crossing detected at the sampled values. This is
                  not proof that none exists.
                </li>
              )}
            </ul>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {[
                      `${chosen.label} (${chosen.unit})`,
                      left.name,
                      right.name,
                      "Difference",
                      "Cash floor headroom",
                      "Calculation",
                    ].map((h, i) => (
                      <th scope="col" className="p-2 text-left" key={i}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {chosen.points.map((p) => (
                    <tr className="border-t" key={p.value}>
                      <th scope="row" className="p-2 text-left">
                        {p.value}
                      </th>
                      {[
                        p.leftMinor,
                        p.rightMinor,
                        p.deltaMinor,
                        p.floorHeadroomMinor,
                      ].map((v, i) => (
                        <td className="p-2 tabular-nums" key={i}>
                          {amount(v)}
                        </td>
                      ))}
                      <td className="p-2">{p.error ?? "Calculated"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        <p className="text-xs text-muted-foreground">
          Calculation version: {analysis.formulaVersion}. The saved experiment
          preserves these inputs, ranges and results.
        </p>
      </CardContent>
    </Card>
  );
}
