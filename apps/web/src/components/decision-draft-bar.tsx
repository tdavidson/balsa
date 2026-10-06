"use client";
import { useEffect, useRef, useState } from "react";
import type { OperatingDraftDefinition } from "@/lib/operating-drafts-contract";
import type { loadOperatingDraft, loadOperatingDrafts } from "@/lib/operating-drafts";
import { Button } from "./ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from "./ui/select";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
type Draft = Awaited<ReturnType<typeof loadOperatingDraft>>["draft"];
type Listing = Awaited<ReturnType<typeof loadOperatingDrafts>>;
export function DecisionDraftBar({ companyId, definition, experimentId, disabled, onBusyChange, onOpen }: { companyId: string; definition: OperatingDraftDefinition; experimentId: string | null; disabled: boolean; onBusyChange: (busy: boolean) => void; onOpen: (draft: Draft) => Promise<void> }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [listing, setListing] = useState<Listing["drafts"]>([]);
  const [savedContent, setSavedContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const retryId = useRef<string | null>(null);
  const content = JSON.stringify({ definition, experimentId });
  const dirty = content !== savedContent && Boolean(definition.model || definition.prompt.trim());
  async function read<T>(query = "", body?: object): Promise<T> {
    const response = await fetch(`/api/operating-drafts${query}`, body ? { method: "POST", headers: { "content-type": "application/json", "x-company-id": companyId }, body: JSON.stringify(body) } : { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Unable to save the decision draft.");
    if (data.companyId !== companyId) throw new Error("Company selection changed. Reload this page.");
    return data;
  }
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  useEffect(() => { let active = true; void read<Listing>().then(data => { if (active) setListing(data.drafts); }).catch(() => { if (active) setError("Saved drafts could not be loaded. Retry by refreshing this page."); }); return () => { active = false; }; }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => event.preventDefault(); window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  async function save(asNew = false) {
    setBusy(true); setError(""); setNotice("");
    try {
      if (!retryId.current || asNew) retryId.current = crypto.randomUUID();
      const result = await read<{ companyId: string; draft: Draft }>("", { id: !asNew && draft ? draft.id : retryId.current, revision: !asNew && draft ? draft.revision : 0, definition, experimentId });
      setDraft(result.draft); setSavedContent(content); retryId.current = null;
      setListing((await read<Listing>()).drafts); setNotice("Progress saved. Reopen this draft from any session in this company.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save draft."); }
    finally { setBusy(false); }
  }
  return <section className="flex flex-col gap-3" aria-label="Saved decision progress">
    <div className="flex flex-wrap items-center gap-3">
      <Select value={draft?.id ?? ""} disabled={busy || disabled} onValueChange={id => { if (dirty && !window.confirm("Open another draft and discard unsaved changes?")) return; setBusy(true); setError(""); void read<{ companyId: string; draft: Draft }>(`?id=${id}`).then(async result => { await onOpen(result.draft); setDraft(result.draft); setSavedContent(JSON.stringify({ definition: result.draft.definition, experimentId: result.draft.experimentId })); setNotice("Saved assumptions reopened. Recalculate against the current forecast before approval."); }).catch(cause => setError(cause instanceof Error ? cause.message : "Unable to open draft.")).finally(() => setBusy(false)); }}>
        <SelectTrigger aria-label="Open saved decision draft" className="w-full md:w-80"><SelectValue placeholder="Open saved decision draft" /></SelectTrigger><SelectContent><SelectGroup>{listing.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
      <Button variant="outline" disabled={disabled || busy || !dirty} onClick={() => void save()}>Save progress</Button>
      {(draft || error) && <Button variant="ghost" disabled={disabled || busy || !definition.model && !definition.prompt.trim()} onClick={() => void save(true)}>Save as new draft</Button>}
      <p role="status" className="text-sm text-muted-foreground">{busy ? "Saving or opening…" : dirty ? "Unsaved changes" : draft ? `Saved · revision ${draft.revision}` : "Not saved yet"}</p>
    </div>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {error && <Alert variant="destructive"><AlertTitle>Draft needs attention</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
  </section>;
}
