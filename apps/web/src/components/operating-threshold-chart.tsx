"use client";
import { useId } from "react";
import type { OperatingDecisionAnalysis } from "@/lib/operating-decision-analysis";
import { exactMoney as money } from "./opening-cash-review";
type Range = OperatingDecisionAnalysis["sensitivities"][number];
export function OperatingThresholdChart({
  range,
  leftName,
  rightName,
  currency,
}: {
  range: Range;
  leftName: string;
  rightName: string;
  currency: string;
}) {
  const id = useId();
  const values = range.points.flatMap((p) =>
    [p.leftMinor, p.rightMinor].flatMap((n) => (n === null ? [] : [BigInt(n)])),
  );
  if (!values.length) return null;
  const min = values.reduce((a, b) => (a < b ? a : b));
  const max = values.reduce((a, b) => (a > b ? a : b));
  const span = max - min || 1n;
  const x = (i: number) =>
    120 + (i * 520) / Math.max(1, range.points.length - 1);
  // Coordinates are approximate presentation only; labels and results retain exact minor-unit values.
  const y = (value: string) =>
    180 - Number(((BigInt(value) - min) * 14000n) / span) / 100;
  return (
    <figure className="rounded-lg border p-3">
      <figcaption className="mb-2 text-sm">
        Cash sensitivity to {range.label} · solid: {leftName}; dashed:{" "}
        {rightName}
      </figcaption>
      <svg
        viewBox="0 0 680 230"
        className="w-full"
        role="img"
        aria-labelledby={`${id}-title ${id}-description`}
      >
        <title id={`${id}-title`}>
          Tested cash values across the {range.label} range
        </title>
        <desc id={`${id}-description`}>
          Solid and dashed lines compare the selected alternatives. Missing
          calculations leave gaps. Exact values and tested crossing intervals
          are listed below.
        </desc>
        <line x1="120" x2="640" y1="180" y2="180" className="stroke-border" />
        <text x="8" y="44" className="fill-muted-foreground text-[11px]">
          {money(String(max), currency)}
        </text>
        <text x="8" y="184" className="fill-muted-foreground text-[11px]">
          {money(String(min), currency)}
        </text>
        {(["leftMinor", "rightMinor"] as const).map((key) => (
          <g
            key={key}
            className={
              key === "leftMinor"
                ? "stroke-primary fill-primary"
                : "stroke-muted-foreground fill-muted-foreground"
            }
          >
            {range.points.map((p, i) => {
              const value = p[key];
              const previous = range.points[i - 1]?.[key];
              return value === null ? null : (
                <g key={p.value}>
                  {i > 0 && previous !== null && previous !== undefined && (
                    <line
                      x1={x(i - 1)}
                      x2={x(i)}
                      y1={y(previous)}
                      y2={y(value)}
                      strokeWidth="2"
                      strokeDasharray={key === "rightMinor" ? "6 4" : undefined}
                    />
                  )}
                  <circle
                    cx={x(i)}
                    cy={y(value)}
                    r="3"
                    tabIndex={0}
                    aria-label={`${p.value} ${range.unit}: ${key === "leftMinor" ? leftName : rightName} ${money(value, currency)}`}
                  >
                    <title>
                      {p.value} {range.unit}: {money(value, currency)}
                    </title>
                  </circle>
                </g>
              );
            })}
          </g>
        ))}
        {range.points.map(
          (p, i) =>
            (i === 0 ||
              i === range.points.length - 1 ||
              i === Math.floor(range.points.length / 2)) && (
              <text
                key={p.value}
                x={x(i)}
                y="208"
                textAnchor="middle"
                className="fill-muted-foreground text-[11px]"
              >
                {p.value}
              </text>
            ),
        )}
      </svg>
    </figure>
  );
}
