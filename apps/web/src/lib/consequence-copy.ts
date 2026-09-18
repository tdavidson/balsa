import type { ForecastConsequence } from "@nevermodel/finance-engine";

/** A driver's or item's supporting document: the evidence id it links to, and its resolved name (company-scoped). */
export type ConsequenceSource = { evidenceId: string; sourceName: string | null };

const monthName = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const signedMoney = (minor: string) => {
  const value = BigInt(minor); const dollars = Number((value < 0n ? -value : value) / 100n);
  const text = dollars >= 1000 ? `$${(dollars / 1000).toFixed(dollars >= 100_000 ? 0 : 1).replace(/\.0$/, "")}k` : `$${dollars}`;
  return `${value < 0n ? "−" : "+"}${text}`;
};
const runway = (months: number | null) => (months === null ? "beyond horizon" : `${months} mo`);

const magnitude = (minor: string) => { const value = BigInt(minor); return value < 0n ? -value : value; };

/**
 * One line a CFO can read before approving: the horizon-end cash change, runway, and cash-out month.
 * A roll of the as-of month leads the line and contributes no cash change of its own.
 */
export function describeConsequence(consequence: ForecastConsequence | null, exceptionsAfter = 0): string {
  const parts: string[] = [];
  if (consequence) {
    if (consequence.horizonEndCash.deltaMinor !== "0") parts.push(`${monthName(consequence.horizonEndCash.month)} ending cash ${signedMoney(consequence.horizonEndCash.deltaMinor)}`);
    if (consequence.runwayMonths.before !== consequence.runwayMonths.after) parts.push(`runway ${runway(consequence.runwayMonths.before)} → ${runway(consequence.runwayMonths.after)}`);
    if (consequence.cashOutMonth.before !== consequence.cashOutMonth.after) parts.push(`cash-out ${consequence.cashOutMonth.before ? monthName(consequence.cashOutMonth.before) : "none"} → ${consequence.cashOutMonth.after ? monthName(consequence.cashOutMonth.after) : "none"}`);
    if (!parts.length) {
      // Cash moved inside the horizon but netted out by its end: name the month that moved most.
      const largest = consequence.cash.filter((row) => row.deltaMinor !== "0").reduce<ForecastConsequence["cash"][number] | null>((best, row) => (!best || magnitude(row.deltaMinor) > magnitude(best.deltaMinor) ? row : best), null);
      if (largest) parts.push(`${monthName(largest.month)} ending cash ${signedMoney(largest.deltaMinor)}`);
    }
    if (consequence.rolledForward) parts.unshift(`Forecast rolled forward to ${monthName(consequence.asOfMonth.after)}`);
    // Missing on older stored rows; readers treat that as false.
    if (consequence.methodChanged) parts.unshift("Forecast method updated");
  }
  const head = parts.length ? parts.join(" · ") : "No forecast effect";
  return exceptionsAfter > 0 ? `${head} · ${exceptionsAfter} driver${exceptionsAfter === 1 ? "" : "s"} excluded` : head;
}

const verbs: Record<string, [string, string]> = {
  evidence_published: ["Published", "evidence"], evidence_revoked: ["Revoked", "evidence"], evidence_reprocessed: ["Reprocessed", "evidence"],
  item_confirmed: ["Confirmed", "an item"], item_rejected: ["Rejected", "an item"], item_edited: ["Edited", "an item"], item_created: ["Added", "an item"],
  decision_applied: ["Applied", "a decision"], journal_posted: ["Posted", "a journal entry"], journal_reversed: ["Reversed", "a journal entry"],
  period_closed: ["Closed", "a period"], period_reopened: ["Reopened", "a period"], fx_changed: ["Changed", "FX rates"], entity_changed: ["Changed", "an entity"],
  allocation_changed: ["Changed", "an allocation"], mapping_approved: ["Approved", "a mapping"], plan_pinned: ["Pinned", "a plan"], settings_changed: ["Changed", "forecast settings"],
};

/** A revision caused by the calendar moving forward, not by a CFO action. */
const rolloverLabel = "Month rolled forward";

/**
 * A bulk cause is counted by its subject ids when it has them: a label resolves
 * only for a subject that still exists, so labels can be fewer than ids. Up to
 * three resolved labels are listed, then "and N more" for the rest of the count.
 */
export function describeCause(cause: { kind: string; subjectLabel: string | null; subjectIds?: string[]; subjectLabels?: string[] }): string {
  if (cause.kind === "period_rolled") return rolloverLabel;
  const [verb, noun] = verbs[cause.kind] ?? ["Changed", "the books"];
  const labels = cause.subjectLabels ?? [];
  const count = cause.subjectIds?.length ?? labels.length;
  if (count > 1) {
    const plural = `${noun.replace(/^(a|an)\s+/, "")}s`;
    const shown = labels.slice(0, 3);
    const remainder = count - shown.length;
    return `${verb} ${count} ${plural}${shown.length ? `: ${shown.join(", ")}${remainder > 0 ? ` and ${remainder} more` : ""}` : ""}`;
  }
  const subjectLabel = cause.subjectLabel ?? (labels.length === 1 ? (labels[0] ?? null) : null);
  return `${verb} ${subjectLabel ?? noun}`;
}

/**
 * Plain-text summary of the documents behind a consequence or item, named by the first
 * source with the rest counted: "from Acme MSA.pdf", or "from Acme MSA.pdf and 2 more".
 * Returns null when there are no sources. Rendered separately from any link — see design doc.
 */
export function describeSources(sources: ConsequenceSource[]): string | null {
  if (!sources.length) return null;
  const [first, ...rest] = sources;
  const name = first!.sourceName ?? "a source";
  return rest.length ? `from ${name} and ${rest.length} more` : `from ${name}`;
}

/**
 * Splits sources into what a caller should render as individual links (`shown`, capped at
 * `max`) and how many more there are (`overflow`), so a UI can render up to `max` buttons
 * and a trailing "and N more" for the rest without truncating the underlying list itself.
 */
export function visibleSources(sources: ConsequenceSource[], max = 2): { shown: ConsequenceSource[]; overflow: number } {
  return { shown: sources.slice(0, max), overflow: Math.max(0, sources.length - max) };
}
