"use client";

import { Building2, Check, History, LogOut, Plus, User, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeControl } from "@/components/theme-control";
import { ActivityDialog } from "@/components/activity-dialog";
import { CompanySettingsDialog } from "@/components/company-settings-dialog";
import { MembersDialog } from "@/components/members-dialog";
import { NewCompanyDialog } from "@/components/new-company-dialog";
import { UserSettingsDialog } from "@/components/user-settings-dialog";
import { authClient } from "@/lib/auth-client";
import type { CompanyRole } from "@finance/auth";

type CompanyOption = { id: string; name: string; baseCurrency: string; role: CompanyRole };
type AccountMenuProps = {
  company: { id: string; name: string; baseCurrency: string };
  companies: CompanyOption[];
  user: { email: string; name: string | null; hasAvatar?: boolean };
  /** The signed-in user's role in the active company; owner-only entries are hidden from members. */
  role: CompanyRole;
  loginEnabled?: boolean;
  staleSelection?: boolean;
};

function putActiveCompany(companyId: string) {
  return fetch("/api/companies/active", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyId }) });
}

export function AccountMenu({ company, companies, user, role, loginEnabled = true, staleSelection = false }: AccountMenuProps) {
  const router = useRouter();
  const [companySettingsOpen, setCompanySettingsOpen] = useState(false);
  const [newCompanyOpen, setNewCompanyOpen] = useState(false);
  const [userSettingsOpen, setUserSettingsOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [avatarUnavailable, setAvatarUnavailable] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const repairedSelection = useRef(false);
  // The stored preference did not name an authorized company, so the server picked one; persist it once so the next
  // request (and any other tab) agrees with what is on screen. Fire-and-forget: a failure only leaves the cookie stale.
  useEffect(() => {
    if (!staleSelection || repairedSelection.current) return;
    repairedSelection.current = true;
    void putActiveCompany(company.id).catch(() => {});
  }, [staleSelection, company.id]);
  async function selectCompany(companyId: string) {
    if (companyId === company.id || switchingTo) return;
    setSwitchingTo(companyId);
    setSwitchError(null);
    try {
      const response = await putActiveCompany(companyId);
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error ?? "Unable to switch companies");
      }
      // Full reload: closes company-scoped dialogs, drops cached requests and refreshes the favicon.
      window.location.reload();
    } catch (switchFailure) {
      setSwitchError(switchFailure instanceof Error ? switchFailure.message : "Unable to switch companies");
      setSwitchingTo(null);
    }
  }
  async function signOut() {
    // Drop the company preference first: the next sign-in must not inherit this user's active company.
    await fetch("/api/companies/active", { method: "DELETE" }).catch(() => {});
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }
  return (
    <>
      <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-3 rounded-full text-[13px] text-ink-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label="Account menu"
      >
        <span>{company.name}</span>
        <span className="grid size-[26px] place-items-center overflow-hidden rounded-full bg-ink text-paper">
          <User className="size-3.5" aria-hidden="true" />
          {user.hasAvatar && !avatarUnavailable && <img src="/api/account" alt="" className="absolute size-full object-cover" onError={() => setAvatarUnavailable(true)} />}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 rounded-lg border-rule p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
        <div className="px-2.5 pt-1.5 pb-2 text-[13px]">
          <div className="text-ink">{user.name ?? user.email}</div>
          {user.name && <div className="text-ink-2">{user.email}</div>}
        </div>
        <DropdownMenuSeparator className="bg-rule" />
        <DropdownMenuLabel className="px-2.5 py-1 text-[12px] font-normal text-ink-2">Companies</DropdownMenuLabel>
        {companies.map((option) => {
          const active = option.id === company.id;
          return (
            <DropdownMenuItem
              key={option.id}
              className="cursor-pointer gap-2 px-2.5 text-[13px]"
              aria-current={active ? "true" : undefined}
              data-active={active ? "true" : undefined}
              // Keep the menu open on select: the switch is asynchronous and any failure is reported inline below.
              onSelect={(event) => { event.preventDefault(); void selectCompany(option.id); }}
            >
              <Check className={active ? "size-3.5" : "size-3.5 opacity-0"} aria-hidden="true" />
              <span className="truncate">{option.name}</span>
              {switchingTo === option.id && <span className="ml-auto text-[12px] text-ink-2">Switching…</span>}
            </DropdownMenuItem>
          );
        })}
        {switchError && <p className="px-2.5 py-1 text-[12px] text-red-ink" role="alert">{switchError}</p>}
        <DropdownMenuItem className="cursor-pointer gap-2 px-2.5 text-[13px]" onSelect={() => setNewCompanyOpen(true)}>
          <Plus className="size-3.5" aria-hidden="true" /> New company
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-rule" />
        <DropdownMenuItem className="cursor-pointer gap-2 px-2.5 text-[13px]" onSelect={() => setUserSettingsOpen(true)}>
          <User aria-hidden="true" /> Your settings
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer gap-2 px-2.5 text-[13px]" onSelect={() => setCompanySettingsOpen(true)}>
          <Building2 aria-hidden="true" /> Company settings
        </DropdownMenuItem>
        {/* Only an owner may change membership, so only an owner is offered the screen that does it. */}
        {role === "owner" && <DropdownMenuItem className="cursor-pointer gap-2 px-2.5 text-[13px]" onSelect={() => setMembersOpen(true)}>
          <Users aria-hidden="true" /> Members
        </DropdownMenuItem>}
        <DropdownMenuItem className="cursor-pointer gap-2 px-2.5 text-[13px]" onSelect={() => setActivityOpen(true)}>
          <History aria-hidden="true" /> Activity
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-rule" />
        <div className="flex items-center justify-between px-2.5 py-1.5 text-[13px] text-ink-2">
          Theme
          <ThemeControl />
        </div>
        {loginEnabled && <>
          <DropdownMenuSeparator className="bg-rule" />
          <DropdownMenuItem className="gap-2 px-2.5 text-[13px]" onSelect={() => void signOut()}>
            <LogOut aria-hidden="true" /> Sign out
          </DropdownMenuItem>
        </>}
      </DropdownMenuContent>
      </DropdownMenu>
      <CompanySettingsDialog open={companySettingsOpen} onOpenChange={setCompanySettingsOpen} company={company.name} baseCurrency={company.baseCurrency} />
      <NewCompanyDialog open={newCompanyOpen} onOpenChange={setNewCompanyOpen} />
      <MembersDialog open={membersOpen} onOpenChange={setMembersOpen} company={company.name} role={role} />
      <ActivityDialog open={activityOpen} onOpenChange={setActivityOpen} company={company.name} />
      <UserSettingsDialog open={userSettingsOpen} onOpenChange={setUserSettingsOpen} user={user} localOnly={!loginEnabled} />
    </>
  );
}
