"use client";

import { describeConsequence } from "@/lib/consequence-copy";
import type { ScenarioForecastView } from "@/lib/scenario-changes";

/**
 * "Scenario vs base: …": the selected scenario's consequence against the base forecast, computed now, with
 * the documents behind the drivers it changes (C1 source links when `onOpenEvidence` is given).
 */
export function ScenarioVsBaseLine({ forecast, onOpenEvidence }: { forecast: ScenarioForecastView; onOpenEvidence?: ((evidenceId: string) => void) | undefined }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 border-b border-rule py-3 text-[13px] text-pencil">
      <span className="text-ink-2">{forecast.scenario.name} vs base:</span>
      <span>{describeConsequence(forecast.consequence, forecast.exceptions.length)}</span>
      {onOpenEvidence && forecast.sources.map((source) => (
        <button key={source.evidenceId} type="button" className="underline underline-offset-2" onClick={() => onOpenEvidence(source.evidenceId)}>
          {source.sourceName ?? "Open source"}
        </button>
      ))}
    </div>
  );
}
