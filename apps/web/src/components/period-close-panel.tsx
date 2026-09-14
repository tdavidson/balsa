"use client";

import { Button } from "@/components/ui/button";

type PreviewLine = { accountName: string; debitMinor: string; creditMinor: string; upstreamLineIds: string[] };
type CloseState = {
  eligible: boolean;
  closed: boolean;
  blockers: string[];
  closeEntry: { journalEntryId: string } | null;
  closeEntryPreview: { status: "ready" | "nothing_to_close" | "blocked"; blockers: string[]; entries: { key: string; currency: string; debitMinor: string; creditMinor: string; lines: PreviewLine[] }[] };
};

const money = (value: string, currency = "USD") => {
  try { const amount = BigInt(value); const negative = amount < 0n; const absolute = negative ? -amount : amount; return `${negative ? "−" : ""}${currency === "USD" ? "$" : `${currency} `}${(absolute / 100n).toLocaleString()}.${String(absolute % 100n).padStart(2, "0")}`; } catch { return "—"; }
};

/** CFO-facing view of the deterministic period-close entry before it is posted. */
export function PeriodClosePanel({ state, posting, closing, onPost, onClose }: { state: CloseState | null; posting: boolean; closing: boolean; onPost: () => void; onClose: () => void }) {
  if (!state) return <p className="text-[13px] text-muted-foreground">Loading close controls…</p>;
  const preview = state.closeEntryPreview;
  return <div className="flex flex-col gap-6">
    <section className="flex flex-col gap-2 border-b border-border pb-5">
      <h3 className="text-sm font-medium">Period close</h3>
      <p className="text-[13px] text-muted-foreground">Close only moves remaining income and expense balances into the designated Retained Earnings account. It never changes the underlying operating entries.</p>
      {state.closed ? <p className="text-[13px]">This period is closed.</p> : state.closeEntry ? <p className="text-[13px]">The retained-earnings close entry is posted. You can now close the period once all controls remain eligible.</p> : preview.status === "nothing_to_close" ? <p className="text-[13px] text-muted-foreground">No remaining P&amp;L balance requires a close entry.</p> : null}
    </section>

    {preview.status === "ready" && !state.closeEntry && <section className="flex flex-col gap-3">
      <div><h4 className="text-[11px] uppercase tracking-[.12em] text-muted-foreground">Prepared close entry</h4><p className="mt-1 text-[12px] text-muted-foreground">Every proposed line lists the immutable posted lines it clears. Posting is idempotent and requires the existing CFO promotion.</p></div>
      {preview.entries.map((entry) => <details className="border-b border-border pb-3 text-[13px]" key={entry.key} open><summary className="cursor-pointer font-medium">{entry.currency} · {money(entry.debitMinor, entry.currency)} balanced entry</summary><div className="mt-3 flex flex-col gap-1.5">{entry.lines.map((line) => <div className="flex items-start justify-between gap-4" key={`${entry.key}-${line.accountName}-${line.debitMinor}-${line.creditMinor}`}><span>{line.accountName}<span className="block text-[11px] text-muted-foreground">{line.upstreamLineIds.length} source journal line{line.upstreamLineIds.length === 1 ? "" : "s"}</span></span><span className="shrink-0 tabular-nums">{line.debitMinor !== "0" ? `Dr ${money(line.debitMinor, entry.currency)}` : `Cr ${money(line.creditMinor, entry.currency)}`}</span></div>)}</div></details>)}
      <Button className="self-start" disabled={posting} onClick={onPost} type="button">{posting ? "Posting close entry…" : "Post retained-earnings close entry"}</Button>
    </section>}

    {preview.status === "blocked" && <section className="flex flex-col gap-2"><h4 className="text-[11px] uppercase tracking-[.12em] text-muted-foreground">Close-entry blocker</h4><ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] text-destructive">{preview.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></section>}
    {state.blockers.length > 0 && <section className="flex flex-col gap-2"><h4 className="text-[11px] uppercase tracking-[.12em] text-muted-foreground">Period-close blockers</h4><ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] text-destructive">{state.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></section>}
    {!state.closed && state.closeEntry && state.eligible && <Button className="self-start" disabled={closing} onClick={onClose} type="button">{closing ? "Closing period…" : "Close period"}</Button>}
  </div>;
}
