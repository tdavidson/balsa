"use client";

import { Building2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function CompanySettingsDialog({ open, onOpenChange, company, baseCurrency }: { open: boolean; onOpenChange: (open: boolean) => void; company: string; baseCurrency: string }) {
  const [name, setName] = useState(company);
  const [currency, setCurrency] = useState(baseCurrency);
  const [favicon, setFavicon] = useState<File | null>(null);
  const [minimumCash, setMinimumCash] = useState("");
  // The stored value, or null until the GET succeeds. Without it, saving must not touch minimum cash.
  const [loadedMinimumCash, setLoadedMinimumCash] = useState<string | null>(null);
  const [minimumCashUnavailable, setMinimumCashUnavailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const unavailable = () => { if (!cancelled) { setLoadedMinimumCash(null); setMinimumCashUnavailable(true); } };
    fetch("/api/forecast/settings")
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => {
        if (cancelled) return;
        if (result && typeof result.minimumCash === "number") {
          setMinimumCash(String(result.minimumCash));
          setLoadedMinimumCash(String(result.minimumCash));
          setMinimumCashUnavailable(false);
        } else unavailable();
      })
      .catch(unavailable);
    return () => { cancelled = true; };
  }, [open]);

  async function save() {
    if (!name.trim() || !/^[A-Za-z]{3}$/.test(currency.trim())) {
      setError("Enter a company name and a three-letter currency code.");
      return;
    }
    const floor = Number(minimumCash);
    const minimumCashChanged = loadedMinimumCash !== null && floor !== Number(loadedMinimumCash);
    if (minimumCashChanged && (!minimumCash.trim() || !Number.isFinite(floor) || floor < 0)) {
      setError("Minimum cash must be zero or a positive amount");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = new FormData();
      payload.set("name", name.trim());
      payload.set("baseCurrency", currency.trim().toUpperCase());
      if (favicon) payload.set("favicon", favicon);
      const response = await fetch("/api/company", { method: "PATCH", body: payload });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to save company settings");
      if (minimumCashChanged) {
        const settings = await fetch("/api/forecast/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ minimumCash: floor }) });
        if (!settings.ok) throw new Error((await settings.json().catch(() => ({}))).error ?? "Unable to save the minimum cash setting");
      }
      onOpenChange(false);
      window.location.reload();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save company settings");
    } finally {
      setSaving(false);
    }
  }

  async function deleteCompany() {
    if (deleteConfirmation !== company) {
      setError(`Type exactly “${company}” to delete this company.`);
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch("/api/company", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: deleteConfirmation }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Unable to delete the company");
      window.location.reload();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete the company");
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-md rounded-xl border-rule sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="display flex items-center gap-2 text-[28px]" style={{ fontVariationSettings: '"opsz" 28' }}><Building2 className="size-5" aria-hidden="true" /> Company settings</DialogTitle>
          <DialogDescription>These settings describe the company being modeled.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <label className="grid gap-1.5 text-[13px] text-ink-2">
            Company name
            <Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="organization" />
          </label>
          <label className="grid gap-1.5 text-[13px] text-ink-2">
            Base currency
            <Input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} maxLength={3} className="max-w-[120px] uppercase" />
          </label>
          <label className="grid gap-1.5 text-[13px] text-ink-2">
            Minimum cash for runway
            <Input value={minimumCash} onChange={(event) => setMinimumCash(event.target.value)} inputMode="decimal" className="max-w-[160px]" disabled={loadedMinimumCash === null} placeholder={minimumCashUnavailable ? "Unavailable" : "Loading…"} />
            {minimumCashUnavailable && <span className="text-[12px] text-ink-3">Couldn’t load the current minimum cash, so saving leaves it unchanged.</span>}
          </label>
          <label className="grid gap-1.5 text-[13px] text-ink-2">
            Browser icon
            <Input type="file" accept="image/x-icon,image/vnd.microsoft.icon,image/png" onChange={(event) => setFavicon(event.target.files?.[0] ?? null)} />
            <span className="text-[12px] text-ink-3">Upload an ICO or PNG favicon up to 512 KB.</span>
          </label>
          <div className="mt-2 border-t border-rule pt-4">
            {!confirmingDelete ? (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[13px] text-ink">Delete company</p>
                  <p className="text-[12px] text-ink-3">Permanently removes its books, conversations, evidence, and uploaded files.</p>
                </div>
                <Button type="button" variant="outline" className="shrink-0 text-red-ink" onClick={() => { setConfirmingDelete(true); setError(null); }}>
                  <Trash2 className="size-4" aria-hidden="true" /> Delete
                </Button>
              </div>
            ) : (
              <div className="grid gap-3">
                <div>
                  <p className="text-[13px] text-red-ink">This cannot be undone.</p>
                  <p className="text-[12px] text-ink-3">Type <span className="font-medium text-ink">{company}</span> to confirm.</p>
                </div>
                <Input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} aria-label="Company name confirmation" autoComplete="off" />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => { setConfirmingDelete(false); setDeleteConfirmation(""); setError(null); }} disabled={deleting}>Cancel</Button>
                  <Button type="button" className="bg-red-ink text-white hover:bg-red-ink/90" onClick={deleteCompany} disabled={deleting || deleteConfirmation !== company}>
                    {deleting ? "Deleting…" : "Delete permanently"}
                  </Button>
                </div>
              </div>
            )}
          </div>
          {error && <p className="text-[13px] text-red-ink" role="alert">{error}</p>}
        </div>
        <DialogFooter className={confirmingDelete ? "hidden" : undefined}>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save settings"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
