"use client";

import { Building2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function NewCompanyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim() || !/^[A-Za-z]{3}$/.test(currency.trim())) {
      setError("Enter a company name and a three-letter currency code.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/companies", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.trim(), baseCurrency: currency.trim().toUpperCase() }) });
      const result = await response.json().catch(() => null);
      if (response.status !== 201) throw new Error(result?.error ?? "Unable to create the company");
      // The server switched the active-company cookie to the new company; reload so every view re-renders against it.
      window.location.reload();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create the company");
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-md rounded-xl border-rule sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="display flex items-center gap-2 text-[28px]" style={{ fontVariationSettings: '"opsz" 28' }}><Building2 className="size-5" aria-hidden="true" /> New company</DialogTitle>
          <DialogDescription>A new company starts empty. Its books, sources and conversations stay separate from your other companies.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <label className="grid gap-1.5 text-[13px] text-ink-2">
            Company name
            <Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="organization" autoFocus />
          </label>
          <label className="grid gap-1.5 text-[13px] text-ink-2">
            Base currency
            <Input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} maxLength={3} className="max-w-[120px] uppercase" />
          </label>
          {error && <p className="text-[13px] text-red-ink" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={create} disabled={creating}>{creating ? "Creating…" : "Create company"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
