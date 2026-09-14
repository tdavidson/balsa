"use client";

import { History } from "lucide-react";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { actorLabel, formatRelativeTime, humanizeAuditAction } from "@/lib/activity-format";
import type { ActivityEntry } from "@/app/api/activity/route";

const absoluteFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export function ActivityDialog({ open, onOpenChange, company }: { open: boolean; onOpenChange: (open: boolean) => void; company: string }) {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The clock is captured per load rather than per render so every relative
  // label on screen is measured from the same instant.
  const [loadedAt, setLoadedAt] = useState(() => new Date());

  // Reload on every open: the log has almost certainly grown since the last one.
  // Every state change happens after the fetch has resolved, so opening the
  // dialog does not cascade a second render before it has anything new to show.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/activity?limit=100");
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.error ?? "Unable to load activity");
        if (cancelled) return;
        setEntries((result as { entries: ActivityEntry[] }).entries);
        setLoadedAt(new Date());
        setError(null);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load activity");
      }
    })();
    // A dialog closed mid-request must not write its result into a later open.
    return () => { cancelled = true; };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-lg rounded-xl border-rule sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="display flex items-center gap-2 text-[28px]" style={{ fontVariationSettings: '"opsz" 28' }}><History className="size-5" aria-hidden="true" /> Activity</DialogTitle>
          <DialogDescription>Recent changes in {company}, newest first. Entries are written with the change they describe and are never edited.</DialogDescription>
        </DialogHeader>
        {error && <p className="text-[13px] text-red-ink" role="alert">{error}</p>}
        {!entries && !error && <p className="py-2 text-[13px] text-ink-2" role="status">Loading activity…</p>}
        {entries && entries.length === 0 && <p className="py-2 text-[13px] text-ink-2">Nothing has been recorded for this company yet.</p>}
        {entries && entries.length > 0 && (
          <ScrollArea className="max-h-[56vh] pr-3">
            <ol className="grid gap-0">
              {entries.map((entry) => (
                <li className="grid gap-0.5 border-b border-rule py-2.5 last:border-b-0" key={entry.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] text-ink">{humanizeAuditAction(entry.action)}</span>
                    {/* The exact instant stays available on hover; the list itself reads in relative time. */}
                    <time className="shrink-0 text-[12px] text-ink-2" dateTime={entry.createdAt} title={absoluteFormatter.format(new Date(entry.createdAt))}>
                      {formatRelativeTime(entry.createdAt, loadedAt)}
                    </time>
                  </div>
                  <p className="text-[13px] text-ink-2">{entry.summary}</p>
                  <p className="text-[12px] text-pencil">
                    {actorLabel(entry.actor)}
                    {entry.via !== "ui" && <span> · via {entry.via}</span>}
                  </p>
                </li>
              ))}
            </ol>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
