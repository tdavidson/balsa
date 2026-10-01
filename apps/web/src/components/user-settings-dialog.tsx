"use client";

import { User } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type UserSettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: { name: string | null; email: string };
  localOnly: boolean;
};

export function UserSettingsDialog({ open, onOpenChange, user, localOnly }: UserSettingsDialogProps) {
  const [name, setName] = useState(user.name ?? "");
  const [email, setEmail] = useState(user.email);
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = new FormData();
      payload.set("name", name);
      payload.set("email", email);
      if (photo) payload.set("avatar", photo);
      const response = await fetch("/api/account", { method: "PATCH", body: payload });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to save profile.");
      onOpenChange(false);
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-md rounded-xl border-rule sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="display flex items-center gap-2 text-[28px]"><User className="size-5" /> Your settings</DialogTitle>
          <DialogDescription>
            {localOnly
              ? "This is the persisted user profile for this installation. Environment values are used only when it is first created."
              : "This changes your Balsa display profile. Authentication credentials are managed separately."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <label className="grid gap-1.5 text-[13px] text-ink-2">
            Name
            <Input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="grid gap-1.5 text-[13px] text-ink-2">
            Email
            <Input autoComplete="email" type="email" value={email} disabled={!localOnly} onChange={(event) => setEmail(event.target.value)} />
            {!localOnly && <span className="text-[12px] text-ink-3">Your sign-in provider manages this email address.</span>}
          </label>
          <label className="grid gap-1.5 text-[13px] text-ink-2">
            Profile photo
            <Input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} />
            <span className="text-[12px] text-ink-3">PNG, JPEG, or WebP up to 2 MB.</span>
          </label>
          {error && <p className="text-[13px] text-red-ink" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={saving || !name.trim() || !email.trim()} onClick={() => void save()}>{saving ? "Saving…" : "Save settings"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
