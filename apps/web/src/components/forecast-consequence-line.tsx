"use client";

import { useEffect, useState } from "react";
import { describeConsequence } from "@/lib/consequence-copy";

type PreviewRequest = { kind: "confirm_item"; itemId: string } | { kind: "apply_decision"; decisionId: string };

/** "Forecast: …" under a pending approval, computed by the read-only preview endpoint. */
export function ForecastConsequenceLine({ request }: { request: PreviewRequest }) {
  const [text, setText] = useState<string | null>(null);
  const key = JSON.stringify(request);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/forecast/preview", { method: "POST", headers: { "content-type": "application/json" }, body: key })
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => { if (!cancelled) setText(result ? result.note ?? describeConsequence(result.consequence, result.exceptionsAfter) : null); })
      .catch(() => { if (!cancelled) setText(null); });
    return () => { cancelled = true; };
  }, [key]);
  if (!text) return null;
  return <div className="mt-0.5 text-[13px] text-pencil">Forecast: {text}</div>;
}
