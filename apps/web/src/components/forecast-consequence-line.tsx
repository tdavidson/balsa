"use client";

import { useEffect, useState } from "react";
import { SourceLinks } from "@/components/source-links";
import { describeConsequence, type ConsequenceSource } from "@/lib/consequence-copy";

type PreviewRequest = { kind: "confirm_item"; itemId: string } | { kind: "apply_decision"; decisionId: string };

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
        setText(result ? result.note ?? describeConsequence(result.consequence, result.exceptionsAfter) : null);
        setSources(result?.sources ?? []);
      })
      .catch(() => { if (!cancelled) { setText(null); setSources([]); } });
    return () => { cancelled = true; };
  }, [body, revision]);
  if (!text) return null;
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-pencil">
      <span>Forecast: {text}</span>
      <SourceLinks sources={sources} onOpenEvidence={onOpenEvidence} />
    </div>
  );
}
