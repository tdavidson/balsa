"use client";

import { describeSources, visibleSources, type ConsequenceSource } from "@/lib/consequence-copy";

/**
 * Renders the documents behind a consequence or item preview. With `onOpenEvidence`, up to
 * two sources render as buttons that open the Documents dialog on that evidence, and any
 * remaining sources are counted as plain "and N more" text. Without it, sources never
 * disappear: the same list renders as the plain-text `describeSources` summary instead.
 * Returns null when there are no sources at all.
 */
export function SourceLinks({ sources, onOpenEvidence }: { sources: ConsequenceSource[]; onOpenEvidence?: ((evidenceId: string) => void) | undefined }) {
  if (!sources.length) return null;
  if (!onOpenEvidence) return <span>{describeSources(sources)}</span>;
  const { shown, overflow } = visibleSources(sources);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1">
      <span>from</span>
      {shown.map((source, index) => (
        <span className="inline-flex items-center" key={source.evidenceId}>
          <button type="button" className="underline underline-offset-2" onClick={() => onOpenEvidence(source.evidenceId)}>{source.sourceName ?? "a source"}</button>
          {index < shown.length - 1 ? <span>,</span> : null}
        </span>
      ))}
      {overflow > 0 ? <span>and {overflow} more</span> : null}
    </span>
  );
}
