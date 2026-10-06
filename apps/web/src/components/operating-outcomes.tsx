"use client";
import { StudyTable } from "./operating-study-results";
import { OperatingStudies } from "./operating-studies";
import { OperatingTriggers } from "./operating-triggers";
import { OperatingVariancePanel } from "./operating-variance";
import { useRef, useState } from "react";
import Link from "next/link";
import type {
  OperatingOutcomeView,
  loadOperatingOutcomeWorkspace,
  loadOperatingOutcomeReview,
} from "@/lib/operating-outcomes";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { exactMoney } from "./opening-cash-review";

type Workspace = Awaited<ReturnType<typeof loadOperatingOutcomeWorkspace>>;
type Point = {
  month: string;
  predicted: string;
  observed: string | null;
  status: string;
};
const minorToMajor = (value: string) => {
  const n = BigInt(value);
  return `${n < 0n ? "-" : ""}${(n < 0n ? -n : n) / 100n}.${String((n < 0n ? -n : n) % 100n).padStart(2, "0")}`;
};

export function OperatingOutcomeChart({
  points,
  unit,
  onSelect,
}: {
  points: Point[];
  unit: string;
  onSelect: (month: string) => void;
}) {
  const max = Math.max(
    1,
    ...points.flatMap((p) => [
      Math.abs(Number(p.predicted)),
      Math.abs(Number(p.observed ?? 0)),
    ]),
  );
  const width = Math.max(640, points.length * 110);
  const step = (width - 40) / Math.max(1, points.length);
  const baseline = 160;
  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} 315`}
        style={{ minWidth: width }}
        className="w-full"
        role="group"
        aria-label={`Predicted and observed ${unit}. Dashed bars are predictions; solid bars are observations. Exact values appear in the table below.`}
      >
        <line
          x1="20"
          x2={width - 20}
          y1={baseline}
          y2={baseline}
          stroke="currentColor"
          opacity="0.3"
        />
        {points.map((p, i) => {
          const x = 20 + i * step + step / 2;
          return (
            <g
              key={p.month}
              role="button"
              tabIndex={0}
              aria-label={`Inspect ${p.month}: predicted ${p.predicted}, observed ${p.observed ?? "missing"} ${unit}`}
              onClick={() => onSelect(p.month)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(p.month);
                }
              }}
              className="cursor-pointer text-primary"
            >
              {[
                { value: p.predicted, dx: -32, dashed: true },
                { value: p.observed, dx: 4, dashed: false },
              ].map((bar, j) => {
                if (bar.value === null)
                  return (
                    <text
                      key={j}
                      x={x + 18}
                      y={baseline - 10}
                      textAnchor="middle"
                      fontSize="12"
                      fill="currentColor"
                    >
                      —
                    </text>
                  );
                const n = Number(bar.value);
                const h = Math.max(1, (Math.abs(n) / max) * 100);
                return (
                  <g key={j}>
                    <rect
                      x={x + bar.dx}
                      y={n >= 0 ? baseline - h : baseline}
                      width="28"
                      height={h}
                      fill={bar.dashed ? "none" : "currentColor"}
                      fillOpacity="0.65"
                      stroke="currentColor"
                      strokeDasharray={bar.dashed ? "4 3" : undefined}
                    />
                    <text
                      x={x + bar.dx + 14}
                      y={n >= 0 ? baseline - h - 8 : baseline + h + 15}
                      textAnchor="middle"
                      fontSize="10"
                      fill="currentColor"
                    >
                      {bar.value}
                    </text>
                  </g>
                );
              })}
              <text
                x={x}
                y="293"
                textAnchor="middle"
                fontSize="12"
                fill="currentColor"
              >
                {p.month}
              </text>
            </g>
          );
        })}
        <text x="20" y="20" fontSize="12" fill="currentColor">
          Dashed: predicted · Solid: observed · —: no usable observation ({unit}
          )
        </text>
      </svg>
    </div>
  );
}
function Choice({
  id,
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Choose an option" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((o) => (
              <SelectItem value={o.id} key={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}
export function OperatingOutcomes({ companyId }: { companyId: string }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [view, setView] = useState<OperatingOutcomeView | null>(null);
  const [nodeId, setNodeId] = useState("");
  const [month, setMonth] = useState("");
  const [factId, setFactId] = useState("");
  const [historical, setHistorical] = useState(false);
  const [reviewReason, setReviewReason] = useState("");
  const [scope, setScope] = useState("");
  const [coverage, setCoverage] = useState("partial");
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const request = useRef<{ fingerprint: string; key: string } | null>(null);
  async function read<T>(query = "", body?: object): Promise<T> {
    const response = await fetch(
      `/api/operating-outcomes${query}`,
      body
        ? {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-company-id": companyId,
            },
            body: JSON.stringify(body),
          }
        : { cache: "no-store" },
    );
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error ?? "Unable to load outcomes.");
    if (result.companyId !== companyId)
      throw new Error("Company selection changed. Reload this page.");
    return result;
  }
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update outcomes.");
    } finally {
      setBusy(false);
    }
  }
  async function load(id: string) {
    const next = await read<OperatingOutcomeView>(`?id=${id}`);
    setHistorical(false);
    setView(next);
    setNodeId((current) =>
      next.rows.some((r) => r.nodeId === current)
        ? current
        : (next.rows[0]?.nodeId ?? ""),
    );
    setMonth((current) =>
      next.rows[0]?.months.some((m) => m.month === current)
        ? current
        : (next.rows[0]?.months[0]?.month ?? ""),
    );
    setAck(false);
    setFactId("");
  }
  async function save(body: object) {
    const fingerprint = JSON.stringify(body);
    if (request.current?.fingerprint !== fingerprint)
      request.current = { fingerprint, key: crypto.randomUUID() };
    return read<{ id: string }>("", {
      ...body,
      requestKey: request.current.key,
    });
  }
  const metric = view?.rows.find((r) => r.nodeId === nodeId);
  const observed = metric?.months.find((m) => m.month === month);
  const fact = view?.facts.find((f) => f.factId === factId);
  const cash = view?.cash.filter((c) => c.nodeId === nodeId) ?? [];
  const points: Point[] =
    metric?.months.map((m) => {
      if (!metric.cash)
        return {
          month: m.month,
          predicted: m.predicted,
          observed: m.observed,
          status: m.coverage,
        };
      const predicted = cash
        .filter((c) => c.month === m.month)
        .reduce((sum, c) => sum + BigInt(c.amountMinor), 0n);
      const payments = cash
        .flatMap((c) => c.payments)
        .filter((p) => p.date.slice(0, 7) === m.month);
      return {
        month: m.month,
        predicted: minorToMajor(String(predicted)),
        observed: payments.length
          ? minorToMajor(
              String(
                payments.reduce((sum, p) => sum + BigInt(p.amountMinor), 0n),
              ),
            )
          : null,
        status: payments.length
          ? "Allocated actuals · coverage not established"
          : "No allocated actuals",
      };
    }) ?? [];
  return (
    <Card id="operating-outcomes">
      <CardHeader>
        <CardTitle>Predictions & outcomes</CardTitle>
        <CardDescription>
          Compare an approved plan with what happened. Preserve the original
          prediction, inspect the evidence, and keep each review.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              act(async () => {
                setWorkspace(await read());
                if (view) await load(view.predictionId);
              })
            }
          >
            {busy
              ? "Loading…"
              : workspace
                ? "Refresh outcomes"
                : "Open approved outcomes"}
          </Button>
          <Link
            href="/goal-decisions"
            className="self-center text-sm underline"
          >
            Review and approve a decision
          </Link>
          <Link
            href="/reconciliation"
            className="self-center text-sm underline"
          >
            Reconcile collections and payments
          </Link>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Outcomes unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {notice && (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
        {workspace &&
          !workspace.predictions.length &&
          !workspace.legacyReviews.length && (
            <p className="text-sm text-muted-foreground">
              Approve a saved operating scenario through Decisions & outcomes to
              start tracking its predictions.
            </p>
          )}
        {!!workspace?.predictions.length && (
          <FieldGroup>
            <Choice
              id="outcome-prediction"
              label="Approved prediction version"
              value={view?.predictionId ?? ""}
              disabled={busy}
              onChange={(id) => act(() => load(id))}
              options={workspace.predictions.map((p) => ({
                id: p.id,
                label: `${p.name} · approved ${p.approvedAt.slice(0, 10)}`,
              }))}
            />
          </FieldGroup>
        )}
        {!!workspace?.legacyReviews.length && (
          <details>
            <summary className="cursor-pointer text-sm">
              Earlier approvals available for tracking
            </summary>
            <div className="mt-3 flex flex-col gap-2">
              {workspace.legacyReviews.map((r) => (
                <Button
                  key={r.id}
                  disabled={busy}
                  variant="outline"
                  onClick={() =>
                    act(async () => {
                      const result = await read<{ id: string }>("", {
                        action: "preserve",
                        reviewId: r.id,
                      });
                      setWorkspace(await read());
                      await load(result.id);
                    })
                  }
                >
                  Track {r.name}
                </Button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Uses the original saved calculation. Separately edited scenarios
              cannot be attributed to the original model.
            </p>
          </details>
        )}
        {view && (
          <>
            <nav
              aria-label="Selected decision views"
              className="flex flex-wrap gap-3 text-sm"
            >
              {[
                "Overview",
                "Model",
                "Outcomes",
                "Reviews",
                "Studies",
                "History",
              ].map((label) => (
                <a
                  key={label}
                  className="underline"
                  href={`#decision-${view.predictionId}-${label.toLowerCase()}`}
                >
                  {label}
                </a>
              ))}
            </nav>
            {historical && (
              <Alert>
                <AlertTitle>Preserved outcome review</AlertTitle>
                <AlertDescription>
                  This is the evidence and comparison as recorded at the time.
                  Refresh outcomes to return to the current view.
                </AlertDescription>
              </Alert>
            )}
            <p
              id={`decision-${view.predictionId}-overview`}
              className="text-sm text-muted-foreground"
            >
              Approved {view.prediction.approvedAt.slice(0, 10)} · observed
              through {view.throughDate} · calculation{" "}
              {view.prediction.operating.formulaVersion}
            </p>
            <details id={`decision-${view.predictionId}-model`}>
              <summary>Preserved approved model</summary>
              <StudyTable
                caption="Original formulas and predictions; revisions create new versions"
                headers={[
                  "Metric ID",
                  "Metric",
                  "Unit",
                  "Formula",
                  ...view.prediction.operating.months,
                ]}
                rows={view.prediction.model.nodes.map((n) => [
                  n.id,
                  n.label,
                  n.unit,
                  n.op === "input"
                    ? "Dated input"
                    : `${n.op}(${n.args.join(", ")})`,
                  ...view.prediction.operating.values[n.id]!,
                ])}
              />
            </details>
            <h3
              id={`decision-${view.predictionId}-outcomes`}
              className="font-medium"
            >
              Outcomes for the selected prediction
            </h3>
            <FieldGroup className="md:grid md:grid-cols-2">
              <Choice
                id="outcome-metric"
                label="Metric"
                value={nodeId}
                disabled={busy}
                onChange={(v) => {
                  setNodeId(v);
                  setAck(false);
                  setFactId("");
                  setScope("");
                }}
                options={view.rows.map((r) => ({
                  id: r.nodeId,
                  label: `${r.label} (${r.unit})`,
                }))}
              />
              <Choice
                id="outcome-month"
                label="Inspect period"
                value={month}
                disabled={busy}
                onChange={(v) => {
                  setMonth(v);
                  setAck(false);
                }}
                options={(metric?.months ?? []).map((m) => ({
                  id: m.month,
                  label: m.month,
                }))}
              />
            </FieldGroup>
            {metric && (
              <>
                <OperatingOutcomeChart
                  points={points}
                  unit={metric.unit}
                  onSelect={(m) => {
                    setMonth(m);
                    setAck(false);
                  }}
                />
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <caption className="pb-2 text-left">
                      {metric.label} · {metric.unit}. Differences compare
                      observed minus predicted; partial values are provisional.
                    </caption>
                    <thead>
                      <tr>
                        {[
                          "Period",
                          "Predicted",
                          "Observed",
                          "Difference",
                          "Evidence coverage",
                        ].map((h) => (
                          <th key={h} scope="col" className="border-b p-2">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {points.map((p) => (
                        <tr key={p.month} aria-selected={p.month === month}>
                          <th scope="row" className="border-b p-2">
                            <button
                              className="underline"
                              onClick={() => {
                                setMonth(p.month);
                                setAck(false);
                              }}
                            >
                              {p.month}
                            </button>
                          </th>
                          <td className="border-b p-2 tabular-nums">
                            {p.predicted}
                          </td>
                          <td className="border-b p-2 tabular-nums">
                            {p.observed ?? "—"}
                          </td>
                          <td className="border-b p-2 tabular-nums">
                            {metric.cash
                              ? "See settlement below"
                              : (metric.months.find((m) => m.month === p.month)
                                  ?.difference ?? "—")}
                          </td>
                          <td className="border-b p-2">{p.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-sm">
                  Preserved relationship: <code>{metric.formula}</code>.{" "}
                  <a
                    className="underline"
                    href={`/api/operating-models?id=${view.experimentId}`}
                    download
                  >
                    Inspect original inputs and calculation
                  </a>
                </p>
                {metric.cash ? (
                  <div className="flex flex-col gap-3">
                    {cash.length ? (
                      cash.map((c) => (
                        <div key={c.driverId} className="rounded-md border p-4">
                          <p className="font-medium">
                            Expected {exactMoney(c.amountMinor, metric.unit)} in{" "}
                            {c.month} · {c.status.replaceAll("_", " ")}
                          </p>
                          <p className="text-sm">
                            Allocated:{" "}
                            {c.observedMinor === null
                              ? "No usable allocations"
                              : exactMoney(c.observedMinor, metric.unit)}{" "}
                            · difference from original expectation:{" "}
                            {c.differenceMinor === null
                              ? "unavailable"
                              : exactMoney(c.differenceMinor, metric.unit)}
                          </p>
                          {c.payments.map((p) => (
                            <p key={p.allocationId} className="mt-1 text-sm">
                              {p.date}: {exactMoney(p.amountMinor, metric.unit)}{" "}
                              · journal <code>{p.entryId}</code>
                              {p.date.slice(0, 7) !== c.month
                                ? " · different month from prediction"
                                : ""}
                            </p>
                          ))}
                          {c.occurrences.map((o) => (
                            <p
                              key={o.id}
                              className="mt-1 text-sm text-muted-foreground"
                            >
                              Remaining{" "}
                              {exactMoney(o.remainingMinor, metric.unit)} ·
                              current expected date {o.expectedDate} · {o.state}
                              {o.overdue ? " · overdue" : ""}
                            </p>
                          ))}
                          {!!c.invalidAllocationIds.length && (
                            <p className="mt-2 text-sm">
                              An allocation was reversed, changed, or is
                              unavailable at this cutoff. Reconcile it before
                              concluding the outcome.
                            </p>
                          )}
                        </div>
                      ))
                    ) : (
                      <p className="text-sm">
                        No applied cash contributions for this metric in this
                        version.
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Allocations can arrive outside the original horizon and
                      remain listed here. Monthly predictions do not establish a
                      day-level timing error. No usable allocation does not mean
                      zero cash.
                    </p>
                  </div>
                ) : (
                  <>
                    {observed?.definition && (
                      <div className="rounded-md border p-4 text-sm">
                        <p className="font-medium">
                          {month}: {observed.definition.value} {metric.unit} ·{" "}
                          {observed.coverage}
                        </p>
                        <p>Scope: {observed.definition.scope}</p>
                        <p>
                          Source: {observed.definition.source.sourceName} ·{" "}
                          {observed.definition.source.label} ·{" "}
                          {observed.definition.source.sourceLocation ??
                            "No location supplied"}
                        </p>
                        <p>{observed.definition.reason}</p>
                        {observed.coverage === "unavailable" && (
                          <p>
                            The observation was withdrawn, or its source changed
                            or is no longer approved. The saved value remains in
                            history but is excluded from the current comparison.
                          </p>
                        )}
                      </div>
                    )}
                    {!historical && (
                      <details>
                        <summary className="cursor-pointer font-medium">
                          {observed?.observationId
                            ? "Correct this observation"
                            : "Record an observation"}{" "}
                          for {month}
                        </summary>
                        <FieldGroup className="mt-4">
                          <Choice
                            id="outcome-fact"
                            label="Approved numeric source"
                            value={factId}
                            disabled={busy}
                            onChange={(v) => {
                              setFactId(v);
                              setAck(false);
                            }}
                            options={view.facts.map((f) => ({
                              id: f.factId,
                              label: `${f.sourceName} · ${f.label}: ${f.value}`,
                            }))}
                          />
                          {!view.facts.length && (
                            <p className="text-sm text-muted-foreground">
                              No approved numeric facts are available. Upload
                              and review supporting evidence first.
                            </p>
                          )}
                          {fact && (
                            <p className="text-sm">
                              Source value: {fact.value} ·{" "}
                              {fact.currency ?? "Unit needs your confirmation"}{" "}
                              · {fact.sourceLocation ?? "No source location"}
                            </p>
                          )}
                          <Field>
                            <FieldLabel htmlFor="outcome-scope">
                              Measured scope
                            </FieldLabel>
                            <Input
                              id="outcome-scope"
                              disabled={busy}
                              value={scope}
                              onChange={(e) => {
                                setScope(e.target.value);
                                setAck(false);
                              }}
                              placeholder="For example: delivery hours available for the whole team"
                            />
                            <FieldDescription>
                              Confirm this source measures the same population
                              and metric as the prediction, in {metric.unit}.
                            </FieldDescription>
                          </Field>
                          <Choice
                            id="outcome-coverage"
                            label="Period coverage"
                            value={coverage}
                            disabled={busy}
                            onChange={(v) => {
                              setCoverage(v);
                              setAck(false);
                            }}
                            options={[
                              {
                                id: "partial",
                                label: "Partial period or incomplete coverage",
                              },
                              {
                                id: "complete",
                                label: "Complete closed month",
                              },
                            ]}
                          />
                          <Field>
                            <FieldLabel htmlFor="outcome-reason">
                              Review note
                            </FieldLabel>
                            <Input
                              id="outcome-reason"
                              disabled={busy}
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                              placeholder="Why this source is suitable, or why a correction is needed"
                            />
                          </Field>
                          <Field orientation="horizontal">
                            <input
                              id="outcome-confirm"
                              type="checkbox"
                              checked={ack}
                              disabled={busy}
                              onChange={(e) => setAck(e.target.checked)}
                            />
                            <FieldLabel htmlFor="outcome-confirm">
                              I checked the metric, {metric.unit}, measured
                              scope, {month}, and coverage against this source.
                            </FieldLabel>
                          </Field>
                          <Button
                            disabled={
                              busy ||
                              !fact ||
                              !scope.trim() ||
                              !reason.trim() ||
                              !ack
                            }
                            onClick={() =>
                              act(async () => {
                                await save({
                                  action: "observe",
                                  predictionId: view.predictionId,
                                  nodeId,
                                  month,
                                  factId,
                                  unit: metric.unit,
                                  scope,
                                  coverage,
                                  reason,
                                  expectedObservationId:
                                    observed?.observationId ?? null,
                                  sourceToken: fact!.sourceToken,
                                  acknowledgeMapping: true,
                                });
                                await load(view.predictionId);
                                setNotice(
                                  "Observation preserved. The approved forecast is unchanged.",
                                );
                              })
                            }
                          >
                            Confirm observation
                          </Button>
                          {observed?.observationId &&
                            !observed.definition?.withdrawn && (
                              <Button
                                variant="outline"
                                disabled={busy || !reason.trim()}
                                onClick={() =>
                                  act(async () => {
                                    await save({
                                      action: "withdraw",
                                      predictionId: view.predictionId,
                                      observationId: observed.observationId,
                                      reason,
                                    });
                                    await load(view.predictionId);
                                    setNotice(
                                      "Observation withdrawn from the current comparison. Prior records are preserved.",
                                    );
                                  })
                                }
                              >
                                Withdraw observation
                              </Button>
                            )}
                        </FieldGroup>
                      </details>
                    )}
                  </>
                )}
              </>
            )}
            <h3
              id={`decision-${view.predictionId}-reviews`}
              className="font-medium"
            >
              Reviews and approval
            </h3>
            {!historical && (
              <OperatingTriggers
                key={`${companyId}:${view.predictionId}`}
                view={view}
                onInspect={(node, period) => {
                  setNodeId(node);
                  setMonth(period);
                  setAck(false);
                  setFactId("");
                  setScope("");
                }}
              />
            )}
            <h3
              id={`decision-${view.predictionId}-studies`}
              className="font-medium"
            >
              Decision studies
            </h3>
            {!historical && (
              <OperatingStudies
                key={`studies-${companyId}-${view.predictionId}`}
                companyId={companyId}
                model={view.prediction.model}
                source={{ kind: "prediction", predictionId: view.predictionId }}
              />
            )}
            <OperatingVariancePanel
              view={view}
              nodeId={nodeId}
              month={month}
              onInspect={(node, period) => {
                setNodeId(node);
                setMonth(period);
                setAck(false);
                setFactId("");
                setScope("");
              }}
            />
            <details id={`decision-${view.predictionId}-history`}>
              <summary className="cursor-pointer text-sm">
                Observation history ({view.history.length})
              </summary>
              <div className="mt-3 flex flex-col gap-3">
                {view.history.map((h) => (
                  <div key={h.id} className="border-b pb-2 text-sm">
                    <p>
                      {view.rows.find((r) => r.nodeId === h.nodeId)?.label ??
                        h.nodeId}{" "}
                      · {h.month}: {h.definition.value} {h.definition.unit} ·{" "}
                      {h.definition.withdrawn
                        ? "withdrawn"
                        : h.definition.coverage}
                    </p>
                    <p className="text-muted-foreground">
                      Recorded {h.recordedAt} · {h.definition.source.sourceName}
                      {h.supersedesId
                        ? " · correction of a prior observation"
                        : ""}
                    </p>
                    <p>{h.definition.reason}</p>
                  </div>
                ))}
              </div>
            </details>
            {!historical && (
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="outcome-review-reason">
                    Outcome review note
                  </FieldLabel>
                  <Input
                    id="outcome-review-reason"
                    value={reviewReason}
                    disabled={busy}
                    onChange={(e) => setReviewReason(e.target.value)}
                    placeholder="What this comparison establishes and what remains unknown"
                  />
                </Field>
                <Button
                  variant="outline"
                  disabled={busy || !reviewReason.trim()}
                  onClick={() =>
                    act(async () => {
                      await save({
                        action: "save_review",
                        predictionId: view.predictionId,
                        previewToken: view.previewToken,
                        reason: reviewReason,
                      });
                      await load(view.predictionId);
                      setNotice(
                        "Outcome review preserved with its evidence and calculation versions.",
                      );
                    })
                  }
                >
                  Preserve this outcome review
                </Button>
              </FieldGroup>
            )}
            {!!view.reviews.length && (
              <div className="flex flex-wrap gap-3">
                {view.reviews.map((r) => (
                  <Button
                    key={r.id}
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        const saved = await read<
                          Awaited<ReturnType<typeof loadOperatingOutcomeReview>>
                        >(`?review=${r.id}`);
                        setView({
                          ...saved.snapshot,
                          facts: [],
                          reviews: view.reviews,
                        });
                        setHistorical(true);
                        setNotice(saved.snapshot.reason);
                      })
                    }
                  >
                    Inspect review {r.createdAt.slice(0, 19).replace("T", " ")}
                  </Button>
                ))}
              </div>
            )}
            <details>
              <summary className="cursor-pointer text-sm">
                What this comparison can establish
              </summary>
              <ul className="mt-2 flex list-disc flex-col gap-2 pl-5 text-sm text-muted-foreground">
                {view.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}
