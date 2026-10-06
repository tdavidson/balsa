"use client";
import type { OperatingPreview } from "@/lib/operating-models";
import { exactMoney } from "./opening-cash-review";
export function DecisionCashChart({ preview, caseId, onInspect }: { preview: OperatingPreview; caseId: string; onInspect: (month: string) => void }) {
  const path = preview.paths.find(item => item.caseId === caseId) ?? preview.paths[0];
  if (!path) return null;
  const points = path.operating.months.flatMap(month => {
    const proposed = path.forecast.months.find(item => item.month === month);
    const base = preview.baseMonths.find(item => item.month === month);
    return proposed && base ? [{ month, proposed: proposed.endingCashMinor, base: base.endingCashMinor }] : [];
  });
  if (!points.length) return null;
  const values = points.flatMap(point => [BigInt(point.proposed), BigInt(point.base)]);
  const min = values.reduce((a, b) => a < b ? a : b); const max = values.reduce((a, b) => a > b ? a : b); const span = max - min || 1n;
  const width = Math.max(700, points.length * 130);
  const x = (index: number) => 80 + index * (width - 150) / Math.max(1, points.length - 1);
  const y = (value: string) => 210 - Number((BigInt(value) - min) * 15000n / span) / 100;
  return <figure className="overflow-x-auto"><figcaption className="mb-3 text-sm">Ending cash · solid: {path.name} · dashed: current forecast. Select a month to inspect its calculations.</figcaption>
    <svg viewBox={`0 0 ${width} 290`} style={{ minWidth: width }} className="w-full" role="group" aria-label="Monthly ending cash comparison">
      {(["base", "proposed"] as const).map(series => <g key={series} className={series === "base" ? "text-muted-foreground" : "text-primary"}>
        {points.map((point, index) => <g key={point.month}>
          {index > 0 && <line x1={x(index - 1)} y1={y(points[index - 1]![series])} x2={x(index)} y2={y(point[series])} stroke="currentColor" strokeWidth="2" strokeDasharray={series === "base" ? "6 4" : undefined} />}
          <circle cx={x(index)} cy={y(point[series])} r="5" fill="currentColor" />
        </g>)}
      </g>)}
      {points.map((point, index) => <g key={point.month} role="button" tabIndex={0} aria-label={`Inspect ${point.month}: proposed ${exactMoney(point.proposed, preview.currency)}, current forecast ${exactMoney(point.base, preview.currency)}`} onClick={() => onInspect(point.month)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onInspect(point.month); } }} className="cursor-pointer">
        <rect x={x(index) - 58} y="20" width="116" height="260" fill="transparent" />
        <text x={x(index)} y="240" textAnchor="middle" className="fill-foreground text-xs">{point.month}</text>
        <text x={x(index)} y="258" textAnchor="middle" className="fill-primary text-xs">{exactMoney(point.proposed, preview.currency)}</text>
        <text x={x(index)} y="276" textAnchor="middle" className="fill-muted-foreground text-xs">{exactMoney(point.base, preview.currency)}</text>
      </g>)}
    </svg>
  </figure>;
}
