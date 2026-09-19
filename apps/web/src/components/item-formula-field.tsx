"use client";

import { useEffect, useId, useRef, useState } from "react";

export type ModelValidationIssue = { message: string; position?: number; variable?: string; driverId?: string };
export type ModelDryRunResult = { errors: ModelValidationIssue[]; warnings: ModelValidationIssue[]; sample?: Record<string, unknown>; itemSample?: Record<string, string> };

export function normalizeItemFormula(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function useModelDryRun(draft: Record<string, unknown> | null, delayMs = 300) {
  const [result, setResult] = useState<ModelDryRunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const serialized = draft ? JSON.stringify(draft) : "";
  useEffect(() => {
    const request = ++sequence.current;
    if (!serialized) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true); setError(null);
      try {
        const response = await fetch("/api/forecast/model/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: serialized, signal: controller.signal });
        const payload = await response.json().catch(() => ({}));
        if (request !== sequence.current) return;
        if (!response.ok) throw new Error(payload.error ?? "Unable to validate the formula");
        setResult(payload);
      } catch (caught) {
        if (controller.signal.aborted || request !== sequence.current) return;
        setResult(null); setError(caught instanceof Error ? caught.message : "Unable to validate the formula");
      } finally { if (request === sequence.current) setLoading(false); }
    }, delayMs);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [serialized, delayMs]);
  return { result: serialized ? result : null, loading: serialized ? loading : false, error: serialized ? error : null };
}

export function ItemFormulaField({ value, savedValue = null, onChange, label = "Formula", help = "Formula overrides the amount; the amount remains the display fallback.", disabled = false }: { value: string | null; savedValue?: string | null; onChange: (value: string | null) => void; label?: string; help?: string; disabled?: boolean }) {
  const id = useId();
  const text = value ?? "";
  const normalized = normalizeItemFormula(text);
  const changed = normalized !== normalizeItemFormula(savedValue ?? "");
  const validation = useModelDryRun(changed && normalized ? { itemFormula: normalized } : null);
  const messages = [...(validation.result?.errors ?? []), ...(validation.result?.warnings ?? [])];
  const describedBy = `${id}-help${messages.length || validation.error ? ` ${id}-status` : ""}`;
  return <label className="grid gap-1.5 text-[13px] text-muted-foreground" htmlFor={id}>
    <span>{label}</span>
    <textarea id={id} rows={2} disabled={disabled} aria-describedby={describedBy} aria-invalid={Boolean(validation.error || validation.result?.errors.length)} className="min-h-16 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-[13px] text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" value={text} onChange={(event) => onChange(normalizeItemFormula(event.target.value))} />
    <span id={`${id}-help`} className="text-[12px]">{help}</span>
    {(validation.loading || validation.error || messages.length > 0 || validation.result?.itemSample) && <div id={`${id}-status`} aria-live="polite" className="grid gap-1 text-[12px]">
      {validation.loading && <span>Checking formula…</span>}
      {validation.error && <span className="text-destructive">{validation.error}</span>}
      {messages.map((issue, index) => <span className={index < (validation.result?.errors.length ?? 0) ? "text-destructive" : "text-muted-foreground"} key={`${issue.message}-${index}`}>{issue.position !== undefined ? `At ${issue.position + 1}: ` : ""}{issue.message}</span>)}
      {validation.result?.itemSample && <span>Sample: {Object.entries(validation.result.itemSample).map(([month, amount]) => `${month} ${amount}`).join(" · ")}</span>}
    </div>}
  </label>;
}
