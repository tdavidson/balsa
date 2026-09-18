"use client";

import { useEffect, useState } from "react";
import { describeConsequence } from "@/lib/consequence-copy";

type PreviewRequest = { kind: "confirm_item"; itemId: string } | { kind: "apply_decision"; decisionId: string };

/**
 * "Forecast: …" under a pending approval, computed by the read-only preview endpoint.
 * `revision` is the current forecast revision: when another approval lands, the preview is recomputed.
 */
export function ForecastConsequenceLine({ request, revision }: { request: PreviewRequest; revision?: string | undefined }) {
  const [text, setText] = useState<string | null>(null);
  const body = JSON.stringify(request);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/forecast/preview", { method: "POST", headers: { "content-type": "application/json" }, body })
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => { if (!cancelled) setText(result ? result.note ?? describeConsequence(result.consequence, result.exceptionsAfter) : null); })
      .catch(() => { if (!cancelled) setText(null); });
    return () => { cancelled = true; };
  }, [body, revision]);
  if (!text) return null;
  return <div className="mt-0.5 text-[13px] text-pencil">Forecast: {text}</div>;
}
