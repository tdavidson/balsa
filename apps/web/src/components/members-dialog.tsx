"use client";

import { Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { CompanyMember, CompanyRole, PendingMember } from "@finance/auth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type MembersDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: string;
  /** The signed-in user's role in this company; members see the list read-only. */
  role: CompanyRole;
};

type MembersResponse = { members: CompanyMember[]; pending: PendingMember[]; currentUserId: string };

const roleLabels: Record<CompanyRole, string> = { owner: "Owner", member: "Member" };

/** Failure is a value here rather than a throw, so the caller can apply it in the same place it applies success. */
async function fetchMembers(): Promise<{ data: MembersResponse } | { error: string }> {
  try {
    const response = await fetch("/api/members");
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error ?? "Unable to load members");
    return { data: result as MembersResponse };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : "Unable to load members" };
  }
}

function RoleSelect({ value, onChange, disabled = false, label }: { value: CompanyRole; onChange: (role: CompanyRole) => void; disabled?: boolean; label: string }) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as CompanyRole)} disabled={disabled}>
      <SelectTrigger size="sm" className="h-7 w-[104px] border-rule bg-background text-[12px]" aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent className="border-rule">
        {(Object.keys(roleLabels) as CompanyRole[]).map((option) => <SelectItem key={option} value={option}>{roleLabels[option]}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function MembersDialog({ open, onOpenChange, company, role }: MembersDialogProps) {
  const owner = role === "owner";
  const [data, setData] = useState<MembersResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [addRole, setAddRole] = useState<CompanyRole>("member");
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const apply = useCallback((result: Awaited<ReturnType<typeof fetchMembers>>) => {
    if ("error" in result) setLoadError(result.error);
    else { setData(result.data); setLoadError(null); }
  }, []);

  const load = useCallback(async () => { apply(await fetchMembers()); }, [apply]);

  // Reload on every open rather than once: membership can change in another tab
  // or by another owner while this dialog sits closed behind the menu. The
  // messages from the previous open are cleared with the same result the fetch
  // returns, so nothing is set synchronously while the effect is running.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const result = await fetchMembers();
      if (cancelled) return;
      setActionError(null);
      setNotice(null);
      apply(result);
    })();
    return () => { cancelled = true; };
  }, [open, apply]);

  /** One place for every mutation: the list is authoritative, so each change re-reads it. */
  async function mutate(id: string, init: RequestInit, onDone?: () => void) {
    setBusyId(id);
    setActionError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/members", { headers: { "content-type": "application/json" }, ...init });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error ?? "Unable to change members");
      }
      onDone?.();
      await load();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Unable to change members");
    } finally {
      setBusyId(null);
    }
  }

  async function add() {
    const address = email.trim();
    if (!address) {
      setActionError("Enter an email address.");
      return;
    }
    setAdding(true);
    await mutate("add", { method: "POST", body: JSON.stringify({ email: address, role: addRole }) }, () => {
      setEmail("");
      // Adding someone who has never signed in cannot be an immediate
      // membership, so say what actually happened instead of a bare success.
      setNotice(`${address} was added. If they have no account yet, they join this company the first time they sign in.`);
    });
    setAdding(false);
  }

  const owners = data?.members.filter((member) => member.role === "owner") ?? [];
  /** The company must keep an owner, so the last one's role and removal are not offered at all. */
  const lastOwnerId = owners.length === 1 ? owners[0]?.userId : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-lg rounded-xl border-rule sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="display flex items-center gap-2 text-[28px]" style={{ fontVariationSettings: '"opsz" 28' }}><Users className="size-5" aria-hidden="true" /> Members</DialogTitle>
          <DialogDescription>
            {owner
              ? `People who can work in ${company}. Owners also change settings, manage members, and reset the company.`
              : `People who can work in ${company}. Only an owner can change this list.`}
          </DialogDescription>
        </DialogHeader>
        {loadError && <p className="text-[13px] text-red-ink" role="alert">{loadError}</p>}
        {!data && !loadError && <p className="py-2 text-[13px] text-ink-2" role="status">Loading members…</p>}
        {data && (
          <ScrollArea className="max-h-[46vh] pr-3">
            <ul className="grid gap-0">
              {data.members.map((member) => {
                const isLastOwner = member.userId === lastOwnerId;
                const busy = busyId === member.userId;
                return (
                  <li className="flex items-center justify-between gap-3 border-b border-rule py-2.5 last:border-b-0" key={member.userId}>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] text-ink">
                        {member.name ?? member.email}
                        {member.userId === data.currentUserId && <span className="ml-1.5 text-[12px] text-ink-2">(you)</span>}
                      </div>
                      {member.name && <div className="truncate text-[12px] text-ink-2">{member.email}</div>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {owner && !isLastOwner
                        ? <RoleSelect value={member.role} disabled={busy} label={`Role for ${member.email}`} onChange={(next) => { if (next !== member.role) void mutate(member.userId, { method: "PATCH", body: JSON.stringify({ userId: member.userId, role: next }) }); }} />
                        : <span className="text-[12px] text-ink-2">{roleLabels[member.role]}</span>}
                      {owner && !isLastOwner && (
                        <Button type="button" variant="ghost" className="h-7 cursor-pointer px-1.5 text-[12px] text-ink-2 underline underline-offset-2 hover:text-ink" disabled={busy}
                          onClick={() => void mutate(member.userId, { method: "DELETE", body: JSON.stringify({ userId: member.userId }) })}>
                          {busy ? "Working…" : "Remove"}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            {data.pending.length > 0 && (
              <div className="mt-4 border-t border-rule pt-3">
                <h3 className="text-[12px] uppercase tracking-[0.12em] text-pencil">Waiting for first sign-in</h3>
                <ul className="mt-1.5 grid gap-0">
                  {data.pending.map((pending) => (
                    <li className="flex items-center justify-between gap-3 border-b border-rule py-2 last:border-b-0" key={pending.id}>
                      <span className="min-w-0 truncate text-[13px] text-ink-2">{pending.email}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-[12px] text-ink-2">{roleLabels[pending.role]}</span>
                        {owner && (
                          <Button type="button" variant="ghost" className="h-7 cursor-pointer px-1.5 text-[12px] text-ink-2 underline underline-offset-2 hover:text-ink" disabled={busyId === pending.id}
                            onClick={() => void mutate(pending.id, { method: "DELETE", body: JSON.stringify({ pendingId: pending.id }) })}>
                            {busyId === pending.id ? "Working…" : "Remove"}
                          </Button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </ScrollArea>
        )}
        {owner && (
          <div className="grid gap-2 border-t border-rule pt-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="grid min-w-[200px] flex-1 gap-1.5 text-[13px] text-ink-2">
                Add by email
                <Input type="email" autoComplete="off" placeholder="person@example.com" value={email} onChange={(event) => setEmail(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter" && !adding) void add(); }} />
              </label>
              <RoleSelect value={addRole} onChange={setAddRole} disabled={adding} label="Role for the new member" />
              <Button type="button" disabled={adding} onClick={() => void add()}>{adding ? "Adding…" : "Add"}</Button>
            </div>
            <p className="text-[12px] text-ink-3">No mail is sent. An address without an account joins this company the first time it signs in.</p>
          </div>
        )}
        {notice && <p className="text-[12px] text-ink-2" role="status">{notice}</p>}
        {actionError && <p className="text-[13px] text-red-ink" role="alert">{actionError}</p>}
      </DialogContent>
    </Dialog>
  );
}
