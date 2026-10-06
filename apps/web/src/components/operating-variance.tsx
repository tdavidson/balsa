"use client";
import type { OperatingOutcomeView } from "@/lib/operating-outcomes";
import { formatDecimal, parseDecimal } from "@balsa/finance-engine";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { exactMoney } from "./opening-cash-review";

type BridgePart = { label: string; value: string; kind: "total" | "change" };
export function OperatingVarianceChart({
  parts,
  unit,
}: {
  parts: BridgePart[];
  unit: string;
}) {
  const bars = parts.reduce<Array<BridgePart & { from: string; to: string }>>(
    (prior, part) => {
      const value = parseDecimal(part.value)!;
      const running = parseDecimal(prior.at(-1)?.to ?? "0")!;
      const from = part.kind === "total" ? 0n : running;
      const to = part.kind === "total" ? value : running + value;
      return [
        ...prior,
        { ...part, from: formatDecimal(from), to: formatDecimal(to) },
      ];
    },
    [],
  );
  const low = Math.min(
    0,
    ...bars.flatMap((b) => [Number(b.from), Number(b.to)]),
  );
  const high = Math.max(
    1,
    ...bars.flatMap((b) => [Number(b.from), Number(b.to)]),
  );
  const width = Math.max(640, bars.length * 130);
  const step = (width - 40) / Math.max(1, bars.length);
  const y = (value: string) =>
    210 - ((Number(value) - low) / (high - low)) * 155;
  return (
    <div className="overflow-x-auto">
      <svg
        role="img"
        aria-label={`Variance bridge in ${unit}. Exact contributions and residual are in the table below.`}
        viewBox={`0 0 ${width} 285`}
        style={{ minWidth: width }}
        className="w-full text-primary"
      >
        <line
          x1="20"
          x2={width - 20}
          y1={y("0")}
          y2={y("0")}
          stroke="currentColor"
          opacity="0.3"
        />
        {bars.map((b, i) => {
          const x = 20 + i * step + step / 2;
          return (
            <g key={`${i}:${b.label}`}>
              <title>
                {b.label}: {b.value} {unit}
              </title>
              <rect
                x={x - 26}
                y={Math.min(y(b.from), y(b.to))}
                width="52"
                height={Math.max(1, Math.abs(y(b.from) - y(b.to)))}
                fill="currentColor"
                fillOpacity={b.kind === "total" ? 0.85 : 0.35}
                stroke="currentColor"
              />
              <text
                x={x}
                y={Math.min(y(b.from), y(b.to)) - 9}
                textAnchor="middle"
                fontSize="12"
                fill="currentColor"
              >
                {b.value}
              </text>
              <text
                x={x}
                y="248"
                textAnchor="middle"
                fontSize="11"
                fill="currentColor"
              >
                {b.label.length > 20 ? `${b.label.slice(0, 19)}…` : b.label}
              </text>
            </g>
          );
        })}
        <text x="20" y="20" fontSize="12" fill="currentColor">
          Preserved prediction → modeled effects → unexplained remainder ({unit}
          )
        </text>
      </svg>
    </div>
  );
}
export function OperatingVariancePanel({
  view,
  nodeId,
  month,
  onInspect,
}: {
  view: OperatingOutcomeView;
  nodeId: string;
  month: string;
  onInspect: (nodeId: string, month: string) => void;
}) {
  // Reviews created before this feature stay historical; never recalculate them silently.
  const explanation = view.explanation;
  if (!explanation)
    return (
      <p className="text-sm text-muted-foreground">
        This saved review predates variance explanations. Refresh outcomes to
        calculate an explanation using current evidence.
      </p>
    );
  const { variance, financialEffects, timing } = explanation;
  const selected = view.rows.find((r) => r.nodeId === nodeId);
  const metric =
    variance.status === "available"
      ? variance.metrics.find((m) => m.nodeId === nodeId)
      : null;
  const row = metric?.months.find((m) => m.month === month);
  const components =
    row?.contributions.filter(
      (c) => c.isolated !== "0" || c.sequential !== "0",
    ) ?? [];
  const label = (id: string) =>
    view.rows.find((r) => r.nodeId === id)?.label ?? id;
  const parts: BridgePart[] = row
    ? [
        { label: "Prediction", value: row.predicted, kind: "total" },
        ...components.map((c) => ({
          label: label(c.nodeId),
          value: c.isolated,
          kind: "change" as const,
        })),
        { label: "Interaction", value: row.interaction, kind: "change" },
        ...(row.residual !== null
          ? [
              {
                label: "Unexplained",
                value: row.residual,
                kind: "change" as const,
              },
            ]
          : []),
        {
          label: row.observed === null ? "Replayed model" : "Observed",
          value: row.observed ?? row.modeled,
          kind: "total",
        },
      ]
    : [];
  const timingRow = timing
    .find((t) => t.nodeId === nodeId)
    ?.months.find((m) => m.month === month);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Explain the difference</CardTitle>
        <CardDescription>
          Inspect what the preserved relationships account for, which effects
          interact, and what remains unknown.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {variance.status === "unavailable" ? (
          <Alert>
            <AlertTitle>Model explanation unavailable</AlertTitle>
            <AlertDescription>{variance.reason}</AlertDescription>
          </Alert>
        ) : (
          <>
            {row && !selected?.cash && (
              <>
                <h3 className="font-medium">
                  {metric!.label} · {month} · {metric!.unit}
                </h3>
                {selected?.formula === "Dated input" && (
                  <p className="text-sm text-muted-foreground">
                    This metric is an input. Its bridge records the observed
                    replacement; it does not explain why the input changed.
                    Select a derived metric to inspect the downstream effects.
                  </p>
                )}
                <OperatingVarianceChart parts={parts} unit={metric!.unit} />
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <caption className="pb-2 text-left">
                      Observed − prediction = isolated input effects +
                      interaction + unexplained remainder.
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col" className="border-b p-2">
                          Contribution
                        </th>
                        <th scope="col" className="border-b p-2">
                          Change ({metric!.unit})
                        </th>
                        <th scope="col" className="border-b p-2">
                          Basis
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {components.map((c) => (
                        <tr key={c.nodeId}>
                          <th scope="row" className="border-b p-2">
                            <Button
                              variant="link"
                              onClick={() => onInspect(c.nodeId, month)}
                            >
                              {label(c.nodeId)}
                            </Button>
                          </th>
                          <td className="border-b p-2 tabular-nums">
                            {c.isolated}
                          </td>
                          <td className="border-b p-2">
                            Replace this input alone in the original model
                          </td>
                        </tr>
                      ))}
                      <tr>
                        <th scope="row" className="border-b p-2">
                          Interaction
                        </th>
                        <td className="border-b p-2 tabular-nums">
                          {row.interaction}
                        </td>
                        <td className="border-b p-2">
                          Joint effect minus the sum of isolated effects
                        </td>
                      </tr>
                      <tr>
                        <th scope="row" className="border-b p-2">
                          Unexplained remainder
                        </th>
                        <td className="border-b p-2 tabular-nums">
                          {row.residual ?? "Unavailable"}
                        </td>
                        <td className="border-b p-2">
                          Observed result minus replayed model result
                        </td>
                      </tr>
                      <tr>
                        <th scope="row" className="border-b p-2">
                          Total observed difference
                        </th>
                        <td className="border-b p-2 tabular-nums">
                          {row.totalDifference ?? "Unavailable"}
                        </td>
                        <td className="border-b p-2">
                          {row.reconciles
                            ? "Bridge reconciles exactly"
                            : "Needs a complete, valid output observation"}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-sm">
                  The preserved model gives {row.modeled} {metric!.unit} after
                  substituting complete observed inputs.{" "}
                  {row.residual === null
                    ? "The observed result is missing, partial, or unavailable; the unexplained remainder cannot yet be measured."
                    : row.residual === "0"
                      ? "The observed result matches this replay. Agreement alone does not establish a causal explanation."
                      : `A remaining ${row.residual} ${metric!.unit} is not accounted for by these substitutions.`}
                </p>
                <details>
                  <summary className="cursor-pointer text-sm">
                    Inspect substitution order and conditional effects
                  </summary>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Order:{" "}
                    {variance.order.map(label).join(" → ") ||
                      "No complete observed input changes"}
                    . These allocations depend on the chosen order; the joint
                    result does not.
                  </p>
                  <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm">
                    {components.map((c) => (
                      <li key={c.nodeId}>
                        {label(c.nodeId)} after earlier substitutions:{" "}
                        {c.sequential} {metric!.unit}
                      </li>
                    ))}
                  </ul>
                </details>
              </>
            )}
            {!variance.substitutions.length && (
              <p className="text-sm text-muted-foreground">
                No complete input observations for finished months are
                available. The model retains its original assumptions.
              </p>
            )}
            {!!variance.substitutions.length && (
              <details>
                <summary className="cursor-pointer text-sm">
                  Observed inputs used ({variance.substitutions.length})
                </summary>
                <div className="mt-3 flex flex-col gap-3">
                  {variance.substitutions.map((o) => {
                    const record = view.history.find((h) => h.id === o.id);
                    return (
                      <div key={o.id} className="border-b pb-2 text-sm">
                        <Button
                          variant="link"
                          onClick={() => onInspect(o.nodeId, o.month)}
                        >
                          {label(o.nodeId)} · {o.month}: {o.value}
                        </Button>
                        <p>
                          {record?.definition.source.sourceName ??
                            "Preserved observation"}{" "}
                          ·{" "}
                          {record?.definition.source.sourceLocation ??
                            "No source location"}
                        </p>
                        <p className="text-muted-foreground">
                          {record?.definition.scope} · observation{" "}
                          <code>{o.id}</code>
                        </p>
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
            {!!variance.excluded.length && (
              <details>
                <summary className="cursor-pointer text-sm">
                  Observations not substituted ({variance.excluded.length})
                </summary>
                <ul className="mt-2 flex list-disc flex-col gap-2 pl-5 text-sm">
                  {variance.excluded.map((o) => (
                    <li key={o.id}>
                      {label(o.nodeId)} · {o.month}: {o.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <p className="text-xs text-muted-foreground">
              Formula {variance.formulaVersion}. Observed inputs replace only
              their measured months. Other dates and unsupported inputs retain
              their original assumptions; lag relationships may carry effects
              into later months. Substitution shows model behavior, not proof of
              cause.
            </p>
          </>
        )}
        {selected?.cash && timingRow && (
          <>
            <h3 className="font-medium">
              Collection or payment timing · {month}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="pb-2 text-left">
                  Only reviewed allocations belonging to this prediction.
                  Complete bank coverage is not implied.
                </caption>
                <tbody>
                  {[
                    ["Original expectation", timingRow.predictedMinor],
                    [
                      "Final amount difference",
                      timingRow.amountDifferenceMinor,
                    ],
                    [
                      "Allocated cash arriving from other predicted months",
                      timingRow.timingInMinor,
                    ],
                    [
                      "Allocated cash moved to other months",
                      timingRow.timingOutMinor,
                    ],
                    ["Allocated cash in this month", timingRow.allocatedMinor],
                  ].map(([name, value]) => (
                    <tr key={name}>
                      <th scope="row" className="border-b p-2">
                        {name}
                      </th>
                      <td className="border-b p-2 tabular-nums">
                        {value === null
                          ? "Not established"
                          : exactMoney(value!, selected.unit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm">
              {timingRow.reconciles
                ? "Original expectation + final amount difference + timing movements equals the allocated cash for this month."
                : "Settlement is incomplete or unavailable. Known timing movements are shown, but unpaid amounts are not classified as a final shortfall."}
            </p>
          </>
        )}
        <details>
          <summary className="cursor-pointer font-medium">
            Modeled financial consequences
          </summary>
          <div className="mt-3 flex flex-col gap-4">
            {financialEffects.status === "unavailable" ? (
              <p className="text-sm text-muted-foreground">
                {financialEffects.reason}
              </p>
            ) : (
              <>
                <p className="text-sm">{financialEffects.notice}</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <caption className="pb-2 text-left">
                      Ending cash replay ·{" "}
                      {financialEffects.replayInput.currency}. Actual history at
                      approval is preserved.
                    </caption>
                    <thead>
                      <tr>
                        {[
                          "Period",
                          "Original ending cash",
                          "Replayed ending cash",
                          "Change",
                          "Cash in change",
                          "Cash out change",
                        ].map((h) => (
                          <th scope="col" className="border-b p-2" key={h}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {financialEffects.months.map((m) => (
                        <tr key={m.month}>
                          <th scope="row" className="border-b p-2">
                            {m.month} · {m.basis}
                          </th>
                          {[
                            m.originalEndingMinor,
                            m.replayedEndingMinor,
                            m.endingDifferenceMinor,
                            m.receiptsDifferenceMinor,
                            m.spendingDifferenceMinor,
                          ].map((v, i) => (
                            <td key={i} className="border-b p-2 tabular-nums">
                              {exactMoney(
                                v,
                                financialEffects.replayInput.currency,
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <details>
                  <summary className="cursor-pointer text-sm">
                    Inspect accounting trace
                  </summary>
                  <p className="mt-2 text-sm">
                    Calculated by {financialEffects.formulaVersion}. Each cash
                    effect produces balanced forecast journal lines through the
                    existing engine. Showing up to 200 lines; the complete
                    calculation is retained in the outcome review.
                  </p>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr>
                          {["Month", "Account", "Debit", "Credit", "Basis"].map(
                            (h) => (
                              <th key={h} scope="col" className="border-b p-2">
                                {h}
                              </th>
                            ),
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {financialEffects.replayRun.projectedLines
                          .slice(0, 200)
                          .map((line) => (
                            <tr key={line.id}>
                              <td className="border-b p-2">{line.period}</td>
                              <td className="border-b p-2">
                                {line.accountName}
                              </td>
                              <td className="border-b p-2">
                                {exactMoney(line.debitMinor, line.currency)}
                              </td>
                              <td className="border-b p-2">
                                {exactMoney(line.creditMinor, line.currency)}
                              </td>
                              <td className="border-b p-2">
                                {line.basis ?? "forecast"}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            )}
          </div>
        </details>
        <Alert>
          <AlertTitle>Questions to investigate</AlertTitle>
          <AlertDescription>
            <div className="flex flex-col gap-2">
              <p>
                A remainder may reflect missing measurements, an unsupported
                assumption, an omitted relationship, or an unexpected event.
                These are hypotheses to review, not established causes.
              </p>
              <p>
                Check that sources measure the same period and scope. Review
                quantity and rate inputs separately, and inspect any delayed
                cash in Reconciliation before changing the plan.
              </p>
            </div>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
