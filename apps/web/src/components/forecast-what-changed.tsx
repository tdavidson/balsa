"use client";

import { useEffect, useState } from "react";
import type { ForecastConsequence } from "@nevermodel/finance-engine";
import { describeCause, describeConsequence } from "@/lib/consequence-copy";

type Row = { id: string; createdAt: string; delta: ForecastConsequence; causes: { kind: string; subjectLabel: string | null }[] };

/** The latest forecast consequences, each with what caused it. `refreshKey` changes when a new forecast revision lands. */
export function ForecastWhatChanged({ refreshKey }: { refreshKey: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/forecast/consequences?limit=5").then((response) => (response.ok ? response.json() : { consequences: [] })).then((result) => { if (!cancelled) setRows(result.consequences ?? []); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [refreshKey]);
  if (!rows.length) return null;
  return (
    <section className="border-b border-rule py-4">
      <div className="pb-2 text-[12px] uppercase tracking-[0.12em] text-ink-2">What changed</div>
      {rows.map((row) => (
        <div className="grid gap-0.5 border-t border-rule py-2.5 text-[13px]" key={row.id}>
          <span className="text-ink">{describeConsequence(row.delta, row.delta.exceptions.after)}</span>
          <span className="text-pencil">{row.causes.map(describeCause).join(" · ")} · {new Date(row.createdAt).toLocaleString()}</span>
        </div>
      ))}
    </section>
  );
}
