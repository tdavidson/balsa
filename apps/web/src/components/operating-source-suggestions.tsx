"use client";
import { useState } from "react";
import type { OperatingSourceSuggestions as Suggestions } from "@/lib/operating-source-suggestions";
import type { OperatingBinding } from "@/lib/operating-connections-contract";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
export function OperatingSourceSuggestions({
  companyId,
  experimentId,
  connectionId,
  onUse,
}: {
  companyId: string;
  experimentId: string | null;
  connectionId: string | null;
  onUse: (binding: OperatingBinding) => Promise<void> | void;
}) {
  const [data, setData] = useState<Suggestions | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dates, setDates] = useState<Record<string, string>>({});
  return (
    <section className="flex flex-col gap-3">
      <Button
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          setData(null);
          try {
            const response = await fetch("/api/operating-connections", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-company-id": companyId,
              },
              body: JSON.stringify({
                action: "suggest_sources",
                experimentId,
                connectionId,
              }),
            });
            const result = await response.json();
            if (!response.ok)
              throw new Error(result.error ?? "Could not suggest sources.");
            if (result.companyId !== companyId)
              throw new Error("Company selection changed. Reload this page.");
            setData(result);
            setDates({});
          } catch (cause) {
            setError(
              cause instanceof Error
                ? cause.message
                : "Could not suggest sources.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy
          ? "Checking recent evidence…"
          : "Suggest connections from recent evidence"}
      </Button>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Source suggestions need attention</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {data && (
        <>
          {connectionId && (
            <p className="text-sm text-muted-foreground">
              Using a mapping replaces this input’s source connections in a
              proposed revision. Other inputs and saved dated assumptions remain
              in place. Review the resulting cash schedule before saving.
            </p>
          )}
          <p className="text-sm text-muted-foreground">{data.notice}</p>
          {!data.suggestions.length && (
            <p className="text-sm">No relevant mapping was proposed.</p>
          )}
          {data.suggestions.map((s) => (
            <FieldGroup key={s.nodeId} className="rounded-md border p-4">
              <p className="font-medium">
                {s.nodeLabel} ← {s.fact.label}: {s.fact.value} {s.unit}
              </p>
              <p className="text-xs text-muted-foreground">
                Mapping: AI suggestion · Source fact: {s.fact.status} ·
                Document: {s.fact.documentStatus}
              </p>
              <a
                className="text-sm underline"
                href={`/api/evidence/${s.fact.evidenceId}/file`}
                target="_blank"
                rel="noreferrer"
              >
                {s.fact.sourceName} {s.fact.sourceLocation}
              </a>
              <p className="text-sm">{s.reason}</p>
              <p className="text-sm text-muted-foreground">
                Uncertainty: {s.uncertainty}
              </p>
              <Field>
                <FieldLabel
                  htmlFor={`suggestion-date-${connectionId ?? experimentId}-${s.nodeId}`}
                >
                  Review effective month
                </FieldLabel>
                <Input
                  id={`suggestion-date-${connectionId ?? experimentId}-${s.nodeId}`}
                  type="month"
                  value={dates[s.nodeId] ?? s.from}
                  onChange={(e) =>
                    setDates({ ...dates, [s.nodeId]: e.target.value })
                  }
                />
              </Field>
              <Button
                disabled={busy || !s.canConnect}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await onUse({
                      nodeId: s.nodeId,
                      factId: s.factId,
                      from: dates[s.nodeId] ?? s.from,
                      unit: s.unit,
                      reason:
                        `Reviewed AI mapping: ${s.reason} Remaining uncertainty: ${s.uncertainty}`.slice(
                          0,
                          1000,
                        ),
                    });
                  } catch (cause) {
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "Could not prepare this mapping.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {connectionId
                  ? "Use mapping in an update preview"
                  : "Use mapping in connection form"}
              </Button>
              {!s.canConnect && (
                <p className="text-sm">
                  Review and approve the source document and fact before
                  connecting it.
                </p>
              )}
            </FieldGroup>
          ))}
        </>
      )}
    </section>
  );
}
