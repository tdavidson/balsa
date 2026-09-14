"use client";

import { Building2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function CompanySettingsDialog({ open, onOpenChange, company, baseCurrency }: { open: boolean; onOpenChange: (open: boolean) => void; company: string; baseCurrency: string }) {
  const [name, setName] = useState(company);
  const [currency, setCurrency] = useState(baseCurrency);
  const [favicon, setFavicon] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim() || !/^[A-Za-z]{3}$/.test(currency.trim())) {
      setError("Enter a company name and a three-letter currency code.");
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
      onOpenChange(false);
      window.location.reload();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save company settings");
    } finally {
      setSaving(false);
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
            Browser icon
            <Input type="file" accept="image/x-icon,image/vnd.microsoft.icon,image/png" onChange={(event) => setFavicon(event.target.files?.[0] ?? null)} />
            <span className="text-[12px] text-ink-3">Upload an ICO or PNG favicon up to 512 KB.</span>
          </label>
          {error && <p className="text-[13px] text-red-ink" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save settings"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
