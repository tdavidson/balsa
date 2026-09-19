"use client";

import { useEffect, useState } from "react";
import { SourceLinks } from "@/components/source-links";
import { describeConsequence, type ConsequenceSource } from "@/lib/consequence-copy";

type PreviewRequest = { kind: "confirm_item"; itemId: string; edits?: { amountFormula?: string | null } } | { kind: "confirm_items"; itemIds: string[] } | { kind: "apply_decision"; decisionId: string };

/**
 * "Forecast: …" under a pending approval, computed by the read-only preview endpoint.
 * `revision` is the current forecast revision: when another approval lands, the preview is recomputed.
 * Any sources render via `SourceLinks`: as buttons when `onOpenEvidence` is given, as plain text otherwise.
 */
export function ForecastConsequenceLine({ request, revision, onOpenEvidence }: { request: PreviewRequest; revision?: string | undefined; onOpenEvidence?: ((evidenceId: string) => void) | undefined }) {
  const [text, setText] = useState<string | null>(null);
  const [sources, setSources] = useState<ConsequenceSource[]>([]);
  const body = JSON.stringify(request);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/forecast/preview", { method: "POST", headers: { "content-type": "application/json" }, body })
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => {
        if (cancelled) return;
        // A batch preview can carry both a consequence and a note (e.g. some items were scenario-only
        // and skipped): show the headline with the note appended, not one or the other.
        const headline = result ? (result.consequence ? describeConsequence(result.consequence, result.exceptionsAfter) : result.note ?? null) : null;
        setText(headline && result?.consequence && result.note ? `${headline} · ${result.note}` : headline);
        setSources(result?.sources ?? []);
      })
      .catch(() => { if (!cancelled) { setText(null); setSources([]); } });
    return () => { cancelled = true; };
  }, [body, revision]);
  if (!text) return null;
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-pencil">
      <span>{request.kind === "confirm_item" && request.edits?.amountFormula ? "Formula-driven forecast" : "Forecast"}: {text}</span>
      <SourceLinks sources={sources} onOpenEvidence={onOpenEvidence} />
    </div>
  );
}
