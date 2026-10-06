"use client";
import { OperatingStudyRevision } from "./operating-study-revision";
import { useState } from "react";
import type { OperatingStudyPreview } from "@/lib/operating-studies";
import { Button } from "./ui/button";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { exactMoney } from "./opening-cash-review";
export function StudyTable({
  caption,
  headers,
  rows,
}: {
  caption: string;
  headers: string[];
  rows: (string | number)[][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="text-left text-muted-foreground">{caption}</caption>
        <thead>
          <tr>
            {headers.map((h) => (
              <th className="p-2" key={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t">
              {row.map((v, j) => (
                <td className="p-2 tabular-nums" key={j}>
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function CashFan({
  points,
  currency,
}: {
  points: { month: string; low: string; mid: string; high: string }[];
  currency: string;
}) {
  const values = points.flatMap((p) => [Number(p.low), Number(p.high)]),
    min = Math.min(0, ...values),
    max = Math.max(1, ...values),
    width = Math.max(640, points.length * 110),
    x = (i: number) => 45 + (i * (width - 90)) / Math.max(1, points.length - 1),
    y = (s: string) => 190 - ((Number(s) - min) / (max - min)) * 140;
  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} 260`}
        style={{ minWidth: width }}
        role="img"
        aria-label="Assumed ending-cash distribution: lower and upper marks show the fifth and ninety-fifth percentiles; the line is the median. Exact values follow."
        className="w-full text-primary"
      >
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          points={points.map((p, i) => `${x(i)},${y(p.mid)}`).join(" ")}
        />
        {points.map((p, i) => (
          <g key={p.month}>
            <line
              x1={x(i)}
              x2={x(i)}
              y1={y(p.low)}
              y2={y(p.high)}
              stroke="currentColor"
              strokeWidth="10"
              opacity=".25"
            />
            <circle cx={x(i)} cy={y(p.mid)} r="4" fill="currentColor" />
            <text
              x={x(i)}
              y={y(p.high) - 12}
              textAnchor="middle"
              fontSize="10"
              fill="currentColor"
            >
              {exactMoney(p.mid, currency)}
            </text>
            <text
              x={x(i)}
              y="230"
              textAnchor="middle"
              fontSize="11"
              fill="currentColor"
            >
              {p.month}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
export function OperatingStudyResults({
  preview,
  studyId = null,
}: {
  preview: OperatingStudyPreview;
  studyId?: string | null;
}) {
  const [worldIndex, setWorldIndex] = useState(0),
    [pathIndex, setPathIndex] = useState(0);
  const { result, context } = preview,
    currency = context.base.input.currency,
    money = (v: string) => exactMoney(v, currency);
  const observationEvidence =
    result.kind === "calibration"
      ? (result.observationEvidence ?? [])
      : (context.observationEvidence ?? []);
  if (result.kind === "calibration") {
    const { report } = result,
      c = report.calibration;
    return (
      <div className="flex flex-col gap-4">
        <Alert>
          <AlertTitle>
            {c.status === "proposal"
              ? "Adjustment worth reviewing"
              : c.status === "insufficient"
                ? "Insufficient calibration history"
                : "Adjustment not supported"}
          </AlertTitle>
          <AlertDescription>{c.notice}</AlertDescription>
        </Alert>
        <p>
          {report.metrics.count} distinct measured outcomes · bias{" "}
          {report.metrics.bias ?? "unavailable"} · mean absolute error{" "}
          {report.metrics.mae ?? "unavailable"} {report.binding.unit}. Positive
          bias means the forecast was too high.
        </p>
        <p className="text-sm text-muted-foreground">{result.notice}</p>
        <StudyTable
          caption="Accuracy by forecast age; incompatible ages stay separate"
          headers={[
            "Months ahead",
            "Outcomes",
            "Bias",
            "Mean absolute error",
            "WAPE %",
          ]}
          rows={report.horizons.map((h) => [
            h.horizon,
            h.count,
            h.bias ?? "—",
            h.mae ?? "—",
            h.wapePercent ?? "Undefined (zero actuals)",
          ])}
        />
        <StudyTable
          caption="Measured outcomes and source versions"
          headers={[
            "Period",
            "Approved",
            "Forecast age",
            "Predicted",
            "Observed",
            "Error",
            "Prediction / observation",
          ]}
          rows={report.scored.map((s) => [
            s.month,
            s.approvedAt.slice(0, 10),
            s.horizon,
            s.predicted,
            s.observed!,
            s.error,
            `${s.predictionId} / ${s.observationId}`,
          ])}
        />
        <details>
          <summary>Excluded observations ({report.excluded.length})</summary>
          <StudyTable
            caption="Exclusions remain visible"
            headers={["Prediction", "Period", "Reason"]}
            rows={report.excluded.map((s) => [
              s.predictionId,
              s.month,
              s.reason,
            ])}
          />
        </details>
        <StudyTable
          caption="Time-separated adjustment evaluation"
          headers={[
            "Fit cutoff",
            "Training months",
            "Holdout months",
            "Original holdout MAE",
            "Adjusted holdout MAE",
            "Proposed subtraction",
          ]}
          rows={[
            [
              c.fitCutoff,
              c.trainingMonths.join(", ") || "None",
              c.holdoutMonths.join(", ") || "None",
              c.baselineHoldout.mae ?? "—",
              c.status === "insufficient"
                ? "Unavailable"
                : (c.adjustedHoldout.mae ?? "—"),
              c.subtractFromFuturePrediction ?? "Unavailable",
            ],
          ]}
        />
        {result.cashTiming.length > 0 && (
          <StudyTable
            caption="Settlement timing by original expected month (no day-level promise is inferred)"
            headers={[
              "Expected month",
              "State",
              "Payment month",
              "Amount",
              "Month delay",
            ]}
            rows={result.cashTiming.flatMap((t) =>
              t.payments.map((p) => [
                t.month,
                t.status,
                p.date.slice(0, 7),
                money(p.amountMinor),
                p.monthDelay,
              ]),
            )}
          />
        )}
        <p className="text-sm">
          Any adjustment remains a hypothesis. Use an open review to propose a
          dated input revision; the accounting rules and approved forecast stay
          unchanged.
        </p>
        <details>
          <summary>Preserved observation sources</summary>
          <StudyTable
            caption="Sourced metric observations and corrections"
            headers={[
              "Observation",
              "Period",
              "Source",
              "Location",
              "Value",
              "State",
            ]}
            rows={observationEvidence.map((e) => [
              e.id,
              e.month,
              e.definition.source.sourceName,
              e.definition.source.sourceLocation ?? "—",
              `${e.definition.value} ${e.definition.unit}`,
              e.definition.withdrawn ? "withdrawn" : e.definition.coverage,
            ])}
          />
        </details>
        <OperatingStudyRevision preview={preview} studyId={studyId} />
      </div>
    );
  }
  if (result.kind === "conditional")
    return (
      <div className="flex flex-col gap-4">
        <Alert>
          <AlertTitle>Conditional comparison · unapproved</AlertTitle>
          <AlertDescription>{result.operating.notice}</AlertDescription>
        </Alert>
        <StudyTable
          caption="Branch timeline, highest-priority qualifying branch first"
          headers={[
            "Month",
            "Decision cutoff",
            "Branch",
            "State",
            "Committed through",
            "Reason",
          ]}
          rows={result.operating.timeline.map((t) => [
            t.month,
            t.decisionMonth,
            t.branchName,
            t.status,
            t.commitThrough ?? "—",
            t.reason,
          ])}
        />
        <details>
          <summary>Condition evidence and exact calculations</summary>
          {result.operating.timeline
            .filter((t) => t.evidence)
            .map((t, i) => (
              <div key={i}>
                <p>
                  {t.month}: {t.evidence!.status}
                </p>
                <p>{t.evidence!.reason}</p>
                <StudyTable
                  caption={`Evidence available at ${t.decisionMonth}`}
                  headers={[
                    "Measured month",
                    "Prediction",
                    "Observation",
                    "Compared value",
                    "Coverage",
                    "Observation ID",
                    "Issue",
                  ]}
                  rows={t.evidence!.periods.map((p) => [
                    p.month,
                    p.predicted ?? "—",
                    p.observed ?? "—",
                    p.value ?? "—",
                    p.coverage,
                    p.observationId ?? "—",
                    p.issue ?? "—",
                  ])}
                />
              </div>
            ))}
          <StudyTable
            caption="Operating values under the conditional plan"
            headers={["Metric", "Unit", ...result.operating.operating.months]}
            rows={context.model.nodes.map((n) => [
              `${n.label} · ${n.op}(${n.args.join(", ")})`,
              n.unit,
              ...result.operating.operating.values[n.id]!,
            ])}
          />
        </details>
        {result.financial.status === "available" ? (
          <>
            <p>{result.financial.notice}</p>
            <StudyTable
              caption="Ending cash against the current outlook"
              headers={[
                "Month",
                "Period",
                "Current outlook",
                "Conditional plan",
                "Difference",
              ]}
              rows={result.financial.run.months.map((m) => {
                const before = context.base.output.months.find(
                  (b) => b.month === m.month,
                )!.endingCashMinor;
                return [
                  m.month,
                  m.basis,
                  money(before),
                  money(m.endingCashMinor),
                  money(String(BigInt(m.endingCashMinor) - BigInt(before))),
                ];
              })}
            />
          </>
        ) : (
          <Alert>
            <AlertTitle>Financial comparison unavailable</AlertTitle>
            <AlertDescription>{result.financial.reason}</AlertDescription>
          </Alert>
        )}
        <p className="text-sm">
          Supported observed conditions can be evaluated in Reviews. Propose and
          approve a revision there before any branch changes the forecast.
        </p>
        <details>
          <summary>Preserved observation sources</summary>
          <StudyTable
            caption="Sourced metric observations and corrections"
            headers={[
              "Observation",
              "Period",
              "Source",
              "Location",
              "Value",
              "State",
            ]}
            rows={observationEvidence.map((e) => [
              e.id,
              e.month,
              e.definition.source.sourceName,
              e.definition.source.sourceLocation ?? "—",
              `${e.definition.value} ${e.definition.unit}`,
              e.definition.withdrawn ? "withdrawn" : e.definition.coverage,
            ])}
          />
        </details>
        <OperatingStudyRevision preview={preview} studyId={studyId} />
      </div>
    );
  const world = result.worlds[worldIndex] ?? result.worlds[0]!,
    path = world.paths[pathIndex] ?? world.paths[0]!;
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <AlertTitle>Assumed distributions · unapproved</AlertTitle>
        <AlertDescription>
          {world.notice} {world.summary.notice}
        </AlertDescription>
      </Alert>
      <div className="flex flex-wrap gap-2">
        {result.worlds.map((w, i) => (
          <Button
            variant="outline"
            key={i}
            onClick={() => {
              setWorldIndex(i);
              setPathIndex(0);
            }}
          >
            {w.name}
          </Button>
        ))}
      </div>
      <p>
        Inspecting {world.name}: {world.summary.valid} supported paths of{" "}
        {world.summary.attempted}; {world.summary.failed} failed.{" "}
        {world.summary.belowFloor} supported paths end below the stated cash
        floor.
      </p>
      <CashFan
        currency={currency}
        points={world.months
          .filter((m) => m.basis === "forecast" && m.summary.p50)
          .map((m) => ({
            month: m.month,
            low: m.summary.p05!.amountMinor,
            mid: m.summary.p50!.amountMinor,
            high: m.summary.p95!.amountMinor,
          }))}
      />
      <StudyTable
        caption="Exact cash distribution by month"
        headers={[
          "Month",
          "Period",
          "P05",
          "Median",
          "P95",
          "Supported / attempted",
          "Below floor",
        ]}
        rows={world.months.map((m) => [
          m.month,
          m.basis,
          m.summary.p05 ? money(m.summary.p05.amountMinor) : "—",
          m.summary.p50 ? money(m.summary.p50.amountMinor) : "—",
          m.summary.p95 ? money(m.summary.p95.amountMinor) : "—",
          `${m.summary.valid} / ${m.summary.attempted}`,
          m.summary.belowFloor,
        ])}
      />
      <p className="text-sm">
        Convergence check: first-half median{" "}
        {world.summary.firstHalfMedian
          ? money(world.summary.firstHalfMedian.amountMinor)
          : "unavailable"}
        ; full-sample median{" "}
        {world.summary.p50
          ? money(world.summary.p50.amountMinor)
          : "unavailable"}
        . Stability does not establish model accuracy.
      </p>
      <div className="flex flex-wrap gap-2">
        {[world.summary.p05, world.summary.p50, world.summary.p95]
          .filter((p) => p !== null)
          .map((p, i) => (
            <Button
              variant="outline"
              key={i}
              onClick={() => setPathIndex(p!.index)}
            >
              Inspect {i === 0 ? "downside" : i === 1 ? "median" : "upside"}{" "}
              path {p!.index + 1}
            </Button>
          ))}
      </div>
      <StudyTable
        caption="Input sensitivity: rank association with ending cash, not a causal effect"
        headers={["Input", "Rank association"]}
        rows={world.sensitivity.map((s) => [
          s.nodeId,
          s.rankAssociation ?? "Unavailable (constant or insufficient paths)",
        ])}
      />
      <StudyTable
        caption="Outcome groups (quantile bands)"
        headers={["Group", "Path numbers"]}
        rows={world.summary.groups.map((g) => [
          g.name,
          g.paths.map((i) => i + 1).join(", "),
        ])}
      />
      <details>
        <summary>All sampled paths, including failures</summary>
        <div className="flex flex-wrap gap-2">
          {world.paths.map((p) => (
            <Button
              key={p.index}
              variant="outline"
              onClick={() => setPathIndex(p.index)}
            >
              Path {p.index + 1}
              {p.status === "unavailable" ||
              ("financial" in p && p.financial.status === "unavailable")
                ? " · unsupported"
                : ""}
            </Button>
          ))}
        </div>
      </details>
      <h4 className="font-medium">Path {path.index + 1}</h4>
      <StudyTable
        caption="Sampled assumptions; shared ranks reveal joint dependence"
        headers={["Input", "From", "Value", "Rank"]}
        rows={path.draws.map((d) => [d.nodeId, d.from, d.value, d.rank])}
      />
      {path.status === "unavailable" ? (
        <p>{path.reason}</p>
      ) : (
        <>
          <StudyTable
            caption="Exact operating trace"
            headers={["Metric / formula", "Unit", ...path.operating.months]}
            rows={path.model.nodes.map((n) => [
              `${n.label}: ${n.op}(${n.args.join(", ")})`,
              n.unit,
              ...path.operating.values[n.id]!,
            ])}
          />
          <StudyTable
            caption="Entity contributions; shared cash is explicit"
            headers={["Entity", "Cohort", "Month", "Net model cash"]}
            rows={[
              ...path.entities.flatMap((e) =>
                e.cash.map((c) => [
                  e.name,
                  e.cohort,
                  c.month,
                  money(c.netMinor),
                ]),
              ),
              ...path.operating.months.map((month) => {
                const allocated = path.entities.reduce(
                    (s, e) =>
                      s +
                      BigInt(e.cash.find((c) => c.month === month)!.netMinor),
                    0n,
                  ),
                  total = path.operating.cash
                    .filter((c) => c.month === month)
                    .reduce(
                      (s, c) =>
                        s +
                        BigInt(c.amountMinor) *
                          (c.direction === "receipt" ? 1n : -1n),
                      0n,
                    );
                return [
                  "Shared / unallocated",
                  "Shared",
                  month,
                  money(String(total - allocated)),
                ];
              }),
            ]}
          />
          {path.financial.status === "available" ? (
            <details>
              <summary>Accounting trace and cash roll-forward</summary>
              <StudyTable
                caption="Monthly accounting results"
                headers={[
                  "Month",
                  "Basis",
                  "Opening cash",
                  "Receipts",
                  "Spending",
                  "Ending cash",
                ]}
                rows={path.financial.run.months.map((m) => [
                  m.month,
                  m.basis,
                  money(m.openingCashMinor),
                  money(m.receiptsMinor),
                  money(m.spendingMinor),
                  money(m.endingCashMinor),
                ])}
              />
              <StudyTable
                caption={`Projected journals · ${path.financial.run.formulaVersion}`}
                headers={["Period", "Account", "Debit", "Credit"]}
                rows={path.financial.run.projectedLines.map((l) => [
                  l.period,
                  l.accountId,
                  money(l.debitMinor),
                  money(l.creditMinor),
                ])}
              />
            </details>
          ) : (
            <p>{path.financial.reason}</p>
          )}
          {path.valuation && (
            <>
              <p>{path.valuation.notice}</p>
              <StudyTable
                caption="Valuation calculation"
                headers={[
                  "Month",
                  "Cash flow",
                  "Terminal value",
                  "Discount factor",
                  "Present value",
                ]}
                rows={path.valuation.trace.map((t) => [
                  t.month,
                  t.flow,
                  t.terminal,
                  t.discountFactor,
                  t.presentValue,
                ])}
              />
            </>
          )}
        </>
      )}
      {world.priceMatches.length > 0 && (
        <StudyTable
          caption="Sampled combinations closest to entered price; inspect their path assumptions above"
          headers={["Path", "Present value", "Difference from price"]}
          rows={world.priceMatches.map((p) => [
            p.index + 1,
            money(p.presentValueMinor),
            money(p.distanceFromPriceMinor),
          ])}
        />
      )}
    </div>
  );
}
