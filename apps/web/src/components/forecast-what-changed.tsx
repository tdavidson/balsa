"use client";

import { useEffect, useState } from "react";
import type { ForecastConsequence } from "@nevermodel/finance-engine";
import { describeCause, describeConsequence, type ConsequenceSource } from "@/lib/consequence-copy";

type Cause = { kind: string; subjectType: string; subjectId: string | null; subjectLabel: string | null; subjectLabels?: string[] };
type Row = { id: string; createdAt: string; delta: ForecastConsequence; sources: ConsequenceSource[]; causes: Cause[] };

/**
 * The latest forecast consequences, each with what caused it. `refreshKey` changes when a new forecast revision lands.
 * `onOpenEvidence`, when given, makes each row's sources and any evidence-subject cause a button into the Documents dialog.
 */
export function ForecastWhatChanged({ refreshKey, onOpenEvidence }: { refreshKey: string; onOpenEvidence?: ((evidenceId: string) => void) | undefined }) {
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
          <span className="flex flex-wrap items-center gap-x-1 text-pencil">
            {row.causes.map((cause, index) => (
              <span className="inline-flex items-center gap-1" key={index}>
                {index > 0 && <span>·</span>}
                {onOpenEvidence && cause.subjectType === "evidence" && cause.subjectId ? (
                  <button type="button" className="underline underline-offset-2" onClick={() => onOpenEvidence(cause.subjectId!)}>{describeCause(cause)}</button>
                ) : (
                  <span>{describeCause(cause)}</span>
                )}
              </span>
            ))}
            <span>· {new Date(row.createdAt).toLocaleString()}</span>
          </span>
          {onOpenEvidence && row.sources.length > 0 && (
            <span className="flex flex-wrap items-center gap-1.5 text-pencil">
              <span>Sources:</span>
              {row.sources.map((source) => (
                <button key={source.evidenceId} type="button" className="underline underline-offset-2" onClick={() => onOpenEvidence(source.evidenceId)}>
                  {source.sourceName ?? "Open source"}
                </button>
              ))}
            </span>
          )}
        </div>
      ))}
    </section>
  );
}
