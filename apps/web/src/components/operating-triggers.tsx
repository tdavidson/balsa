"use client";
import { OperatingPlanRevisions } from "./operating-plan-revisions";
import { useId, useRef, useState } from "react";
import type { OperatingOutcomeView } from "@/lib/operating-outcomes";
import type { OperatingTriggerWorkspace } from "@/lib/operating-triggers";
import type { OperatingTriggerRule } from "@balsa/finance-engine";
import type { TriggerSnapshot } from "@/lib/operating-triggers-contract";
import { Button } from "./ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./ui/card";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "./ui/field";
import { Input } from "./ui/input";
import { Checkbox } from "./ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";

function RuleTrace({
  snapshot,
  onInspect,
}: {
  snapshot: TriggerSnapshot;
  onInspect: (node: string, month: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>
        {snapshot.result.reason} Evaluated{" "}
        {snapshot.evaluatedAt.slice(0, 19).replace("T", " ")} UTC.
      </p>
      {snapshot.rule.kind === "threshold" && (
        <p>
          Requires {snapshot.rule.consecutiveMonths} consecutive complete
          months, with {snapshot.rule.reportingLagMonths} month(s) reporting
          delay. Scope: {snapshot.rule.scope}.{" "}
          {snapshot.rule.measure === "difference"
            ? "Observed − predicted"
            : "Observed value"}{" "}
          must be strictly {snapshot.rule.direction} {snapshot.result.boundary}{" "}
          {snapshot.rule.unit} (threshold {snapshot.rule.threshold}, tolerance{" "}
          {snapshot.rule.tolerance}).
        </p>
      )}
      {snapshot.result.periods.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              Evidence checked for the review rule
            </caption>
            <thead>
              <tr>
                {[
                  "Month",
                  "Predicted",
                  "Observed",
                  "Compared value",
                  "Coverage",
                  "Result",
                ].map((h) => (
                  <th key={h} className="p-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snapshot.result.periods.map((p) => (
                <tr key={p.month} className="border-t">
                  <td className="p-2">
                    <Button
                      variant="link"
                      size="sm"
                      onClick={() =>
                        snapshot.rule.kind === "threshold" &&
                        onInspect(snapshot.rule.nodeId, p.month)
                      }
                    >
                      {p.month}
                    </Button>
                  </td>
                  <td className="p-2 tabular-nums">{p.predicted ?? "—"}</td>
                  <td className="p-2 tabular-nums">{p.observed ?? "—"}</td>
                  <td className="p-2 tabular-nums">{p.value ?? "—"}</td>
                  <td className="p-2">{p.coverage}</td>
                  <td className="p-2">
                    {p.issue ?? (p.qualifies ? "Condition met" : "Within rule")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <details>
        <summary className="cursor-pointer">
          Preserved sources and calculation version
        </summary>
        <p className="mt-2">
          {snapshot.result.formulaVersion} · Rule version {snapshot.ruleId}
        </p>
        {snapshot.evidence.map((e) => (
          <p key={e.observationId} className="mt-2">
            {e.month}: {e.definition.source.sourceName} ·{" "}
            {e.definition.source.label} ·{" "}
            {e.definition.source.sourceLocation ?? "No source location"} ·{" "}
            {e.definition.value} {e.definition.unit} · {e.definition.scope}.
            Observation {e.observationId}; source updated{" "}
            {e.definition.source.factUpdatedAt}.
          </p>
        ))}
        {snapshot.rule.kind === "review_date" && (
          <p>
            Calendar rule due {snapshot.rule.dueDate}; no observed business
            outcome is asserted.
          </p>
        )}
      </details>
    </div>
  );
}
export function OperatingTriggers({
  view,
  onInspect,
}: {
  view: OperatingOutcomeView;
  onInspect: (node: string, month: string) => void;
}) {
  const uid = useId();
  const metrics = view.rows.filter((r) => !r.cash);
  const [pastReview, setPastReview] =
    useState<OperatingTriggerWorkspace["rules"][number]["review"]>(null);
  const [workspace, setWorkspace] = useState<OperatingTriggerWorkspace | null>(
    null,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [name, setName] = useState(""),
    [kind, setKind] = useState("threshold"),
    [nodeId, setNodeId] = useState(metrics[0]?.nodeId ?? "");
  const [scope, setScope] = useState(""),
    [measure, setMeasure] = useState("observed"),
    [direction, setDirection] = useState("below"),
    [threshold, setThreshold] = useState(""),
    [tolerance, setTolerance] = useState("0"),
    [months, setMonths] = useState("2"),
    [lag, setLag] = useState("0"),
    [due, setDue] = useState(""),
    [reason, setReason] = useState(""),
    [ack, setAck] = useState(false),
    [replacesId, setReplacesId] = useState<string | null>(null);
  const [reviewReason, setReviewReason] = useState(""),
    [snoozeUntil, setSnoozeUntil] = useState("");
  const request = useRef<{ fingerprint: string; key: string } | null>(null);
  const metric = metrics.find((m) => m.nodeId === nodeId);
  async function read(
    body?: object,
  ): Promise<OperatingTriggerWorkspace | { companyId: string; id: string }> {
    const response = await fetch(
      `/api/operating-triggers${body ? "" : `?predictionId=${view.predictionId}`}`,
      body
        ? {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-company-id": view.companyId,
            },
            body: JSON.stringify(body),
          }
        : { cache: "no-store" },
    );
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error ?? "Unable to load review rules.");
    if (result.companyId !== view.companyId)
      throw new Error("Company selection changed. Reload this page.");
    return result;
  }
  async function run(body?: object) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (body) {
        const base = { ...body, predictionId: view.predictionId };
        const fingerprint = JSON.stringify(base);
        if (request.current?.fingerprint !== fingerprint)
          request.current = { fingerprint, key: crypto.randomUUID() };
        await read({ ...base, requestKey: request.current.key });
        request.current = null;
        setNotice("Review record saved. The forecast has not changed.");
      }
      setWorkspace((await read()) as OperatingTriggerWorkspace);
      return true;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to update the review queue.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function openReview(id: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/operating-triggers?predictionId=${view.predictionId}&reviewId=${id}`,
        { cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Unable to load preserved review.");
      if (result.companyId !== view.companyId)
        throw new Error("Company selection changed. Reload this page.");
      setPastReview(result.review);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to load preserved review.",
      );
    } finally {
      setBusy(false);
    }
  }
  function edit(row: OperatingTriggerWorkspace["rules"][number]) {
    setReplacesId(row.id);
    setName(row.name);
    setKind(row.rule.kind);
    setReason("");
    setAck(false);
    if (row.rule.kind === "review_date") setDue(row.rule.dueDate);
    else {
      setNodeId(row.rule.nodeId);
      setScope(row.rule.scope);
      setMeasure(row.rule.measure);
      setDirection(row.rule.direction);
      setThreshold(row.rule.threshold);
      setTolerance(row.rule.tolerance);
      setMonths(String(row.rule.consecutiveMonths));
      setLag(String(row.rule.reportingLagMonths));
    }
  }
  const input = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    type = "text",
    extra: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <Field>
      <FieldLabel htmlFor={`${uid}-${label}`}>{label}</FieldLabel>
      <Input
        id={`${uid}-${label}`}
        value={value}
        type={type}
        onChange={(e) => onChange(e.target.value)}
        disabled={busy}
        {...extra}
      />
    </Field>
  );
  const toggle = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    options: [string, string][],
  ) => (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(v) => v && onChange(v)}
        aria-label={label}
        disabled={busy}
      >
        {options.map(([v, l]) => (
          <ToggleGroupItem key={v} value={v}>
            {l}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Field>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Review triggers</CardTitle>
        <CardDescription>
          Watch an approved prediction for a reason to reconsider it. Rules run
          when you choose Evaluate; unattended monitoring is not enabled.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Button variant="outline" disabled={busy} onClick={() => void run()}>
          {workspace ? "Refresh review queue" : "Open review rules"}
        </Button>
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Review rules unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {notice && (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
        {pastReview && (
          <Card>
            <CardHeader>
              <CardTitle>
                Preserved review: {pastReview.snapshot.name}
              </CardTitle>
              <CardDescription>
                {pastReview.effectiveStatus} · Read-only record
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <RuleTrace snapshot={pastReview.snapshot} onInspect={onInspect} />
              {pastReview.history.map((e) => (
                <p key={e.id} className="text-sm">
                  {String(e.createdAt).slice(0, 19)} UTC · {e.status}:{" "}
                  {e.reason}
                </p>
              ))}
              <Button variant="outline" onClick={() => setPastReview(null)}>
                Close preserved review
              </Button>
            </CardContent>
          </Card>
        )}
        {workspace && (
          <>
            {workspace.rules.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No rules yet. Choose a condition below and confirm its scope.
              </p>
            )}
            {workspace.rules.map((row) => (
              <Card key={row.id}>
                <CardHeader>
                  <CardTitle>{row.name}</CardTitle>
                  <CardDescription>
                    {row.active ? "Current rule" : "Replaced rule"} ·{" "}
                    {row.latest
                      ? `Last evaluation: ${row.latest.snapshot.result.status.replaceAll("_", " ")}`
                      : "Not evaluated"}
                    {row.review
                      ? ` · Review ${row.review.effectiveStatus}`
                      : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {!row.latest && (
                    <p className="text-sm">
                      {row.rule.kind === "review_date"
                        ? `Review due ${row.rule.dueDate}`
                        : `${row.rule.nodeId}: ${row.rule.measure === "difference" ? "observed − predicted" : "observed"} ${row.rule.direction} ${row.rule.threshold} ${row.rule.unit}, tolerance ${row.rule.tolerance}; ${row.rule.consecutiveMonths} months, reporting delay ${row.rule.reportingLagMonths}; scope: ${row.rule.scope}`}
                      . {row.reason}
                    </p>
                  )}
                  {row.latest && (
                    <RuleTrace
                      snapshot={row.latest.snapshot}
                      onInspect={onInspect}
                    />
                  )}
                  {row.active && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void run({ action: "evaluate", ruleId: row.id })
                        }
                      >
                        Evaluate {row.name}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => edit(row)}
                      >
                        Revise rule
                      </Button>
                    </div>
                  )}
                  {row.review && (
                    <OperatingPlanRevisions
                      key={row.review.id}
                      companyId={view.companyId}
                      reviewId={row.review.id}
                    />
                  )}
                  {row.review && (
                    <>
                      <details>
                        <summary className="cursor-pointer text-sm">
                          Review history and original trigger
                        </summary>
                        <div className="mt-3 flex flex-col gap-3">
                          <RuleTrace
                            snapshot={row.review.snapshot}
                            onInspect={onInspect}
                          />
                          {row.review.history.map((event) => (
                            <p key={event.id} className="text-sm">
                              {String(event.createdAt)
                                .slice(0, 19)
                                .replace("T", " ")}{" "}
                              UTC · {event.status}
                              {event.snoozeUntil
                                ? ` until ${event.snoozeUntil}`
                                : ""}
                              : {event.reason}
                            </p>
                          ))}
                        </div>
                      </details>
                      {row.active &&
                        !["resolved", "superseded"].includes(
                          row.review.effectiveStatus,
                        ) && (
                          <FieldGroup>
                            <Field>
                              <FieldLabel htmlFor={`${uid}-${row.id}-reason`}>
                                Review note
                              </FieldLabel>
                              <Input
                                id={`${uid}-${row.id}-reason`}
                                value={reviewReason}
                                onChange={(e) =>
                                  setReviewReason(e.target.value)
                                }
                                maxLength={1000}
                                disabled={busy}
                              />
                              <FieldDescription>
                                Acknowledge receipt, defer a review, or record
                                why it is resolved. These actions do not approve
                                model changes.
                              </FieldDescription>
                            </Field>
                            <Field>
                              <FieldLabel htmlFor={`${uid}-${row.id}-snooze`}>
                                Snooze until (UTC, up to 90 days)
                              </FieldLabel>
                              <Input
                                id={`${uid}-${row.id}-snooze`}
                                type="date"
                                value={snoozeUntil}
                                onChange={(e) => setSnoozeUntil(e.target.value)}
                                disabled={busy}
                              />
                            </Field>
                            <div className="flex flex-wrap gap-2">
                              {(
                                [
                                  ["acknowledged", "Acknowledge"],
                                  ["snoozed", "Snooze"],
                                  ["resolved", "Resolve"],
                                ] as const
                              ).map(([status, label]) => (
                                <Button
                                  key={status}
                                  variant="outline"
                                  disabled={
                                    busy ||
                                    !reviewReason.trim() ||
                                    (status === "snoozed" && !snoozeUntil)
                                  }
                                  onClick={() =>
                                    void run({
                                      action: "transition",
                                      reviewId: row.review!.id,
                                      expectedEventId: row.review!.current.id,
                                      status,
                                      snoozeUntil:
                                        status === "snoozed"
                                          ? snoozeUntil
                                          : null,
                                      reason: reviewReason,
                                    })
                                  }
                                >
                                  {label}
                                </Button>
                              ))}
                            </div>
                          </FieldGroup>
                        )}
                    </>
                  )}
                  {row.evaluations.length > 1 && (
                    <details>
                      <summary className="cursor-pointer text-sm">
                        Recent evaluations ({row.evaluations.length}, newest
                        first)
                      </summary>
                      <div className="mt-3 flex flex-col gap-4">
                        {row.evaluations.slice(1).map((e) => (
                          <div key={e.id} className="flex flex-col gap-2">
                            <RuleTrace
                              snapshot={e.snapshot}
                              onInspect={onInspect}
                            />
                            {e.reviewId && (
                              <Button
                                variant="outline"
                                disabled={busy}
                                onClick={() => void openReview(e.reviewId!)}
                              >
                                Open preserved review
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </CardContent>
              </Card>
            ))}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const rule: OperatingTriggerRule =
                  kind === "review_date"
                    ? { kind: "review_date", dueDate: due }
                    : {
                        kind: "threshold",
                        nodeId,
                        unit: metric?.unit ?? "",
                        scope,
                        measure: measure as "observed" | "difference",
                        direction: direction as "above" | "below",
                        threshold,
                        tolerance,
                        consecutiveMonths: Number(months),
                        reportingLagMonths: Number(lag),
                      };
                if (
                  await run({
                    action: "create",
                    name,
                    rule,
                    replacesId,
                    reason,
                    acknowledgeRule: ack,
                  })
                ) {
                  setReplacesId(null);
                  setName("");
                  setReason("");
                  setAck(false);
                }
              }}
            >
              <FieldGroup>
                <h4 className="font-medium">
                  {replacesId
                    ? "Revise the selected rule"
                    : "Add a review rule"}
                </h4>
                {input("Rule name", name, setName, "text", {
                  required: true,
                  maxLength: 120,
                })}
                {toggle("Condition", kind, setKind, [
                  ["threshold", "Metric threshold"],
                  ["review_date", "Review date"],
                ])}
                {kind === "review_date" ? (
                  input("Review due date (UTC)", due, setDue, "date", {
                    required: true,
                  })
                ) : (
                  <>
                    <Field>
                      <FieldLabel htmlFor={`${uid}-metric`}>
                        Operating metric
                      </FieldLabel>
                      <Select
                        value={nodeId}
                        onValueChange={(v) => {
                          setNodeId(v);
                          setScope("");
                          setAck(false);
                        }}
                        disabled={busy}
                      >
                        <SelectTrigger id={`${uid}-metric`}>
                          <SelectValue placeholder="Choose a metric" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {metrics.map((m) => (
                              <SelectItem key={m.nodeId} value={m.nodeId}>
                                {m.label} ({m.unit})
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <FieldDescription>
                        Cash outputs remain in reconciliation. Rules use
                        complete reviewed operating observations.
                      </FieldDescription>
                    </Field>
                    {input("Exact observation scope", scope, setScope, "text", {
                      required: true,
                      maxLength: 240,
                      placeholder:
                        metric?.months.find((m) => m.definition)?.definition
                          ?.scope ?? "e.g. All company locations",
                    })}
                    {toggle("Compare", measure, setMeasure, [
                      ["observed", "Observed value"],
                      ["difference", "Observed − predicted"],
                    ])}
                    {toggle("Direction", direction, setDirection, [
                      ["below", "Below"],
                      ["above", "Above"],
                    ])}
                    {input(
                      `Threshold (${metric?.unit ?? "metric units"})`,
                      threshold,
                      setThreshold,
                      "text",
                      {
                        required: true,
                        inputMode: "decimal",
                        pattern: "-?[0-9]{1,12}(\\.[0-9]{1,6})?",
                      },
                    )}
                    {input(
                      "Tolerance (same units)",
                      tolerance,
                      setTolerance,
                      "text",
                      {
                        required: true,
                        inputMode: "decimal",
                        pattern: "[0-9]{1,12}(\\.[0-9]{1,6})?",
                      },
                    )}
                    {input(
                      "Consecutive complete months",
                      months,
                      setMonths,
                      "number",
                      { min: 1, max: 6, step: 1, required: true },
                    )}
                    {input("Reporting delay (months)", lag, setLag, "number", {
                      min: 0,
                      max: 3,
                      step: 1,
                      required: true,
                    })}
                    <p className="text-sm text-muted-foreground">
                      Zero delay requires the most recently closed month. One
                      month of delay shifts the required window back one month.
                      Missing or changed sources produce insufficient data.
                    </p>
                  </>
                )}
                {input("Why this warrants review", reason, setReason, "text", {
                  required: true,
                  maxLength: 1000,
                })}
                <Field orientation="horizontal">
                  <Checkbox
                    id={`${uid}-confirm`}
                    checked={ack}
                    onCheckedChange={(v) => setAck(v === true)}
                    disabled={busy}
                  />
                  <FieldLabel htmlFor={`${uid}-confirm`}>
                    I reviewed this rule, its units, scope and reporting delay.
                  </FieldLabel>
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="submit"
                    disabled={busy || !ack || (kind === "threshold" && !metric)}
                  >
                    {replacesId ? "Save new rule version" : "Save review rule"}
                  </Button>
                  {replacesId && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setReplacesId(null);
                        setAck(false);
                      }}
                    >
                      Cancel revision
                    </Button>
                  )}
                </div>
              </FieldGroup>
            </form>
          </>
        )}
      </CardContent>
    </Card>
  );
}
