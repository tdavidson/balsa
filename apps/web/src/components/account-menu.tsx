"use client";

import { useClerk } from "@clerk/nextjs";
import { Building2, LogOut, Settings, User } from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeControl } from "@/components/theme-control";
import { CompanySettingsDialog } from "@/components/company-settings-dialog";

type AccountMenuProps = {
  company: string;
  baseCurrency?: string;
  user: { email: string; name: string | null };
};

export function AccountMenu({ company, baseCurrency = "USD", user }: AccountMenuProps) {
  const { openUserProfile, signOut } = useClerk();
  const [companySettingsOpen, setCompanySettingsOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-3 rounded-full text-[13px] text-ink-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label="Account menu"
      >
        <span>{company}</span>
        <span className="grid size-[26px] place-items-center rounded-full bg-ink text-paper">
          <User className="size-3.5" aria-hidden="true" />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 rounded-lg border-rule p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
        <div className="px-2.5 pt-1.5 pb-2 text-[13px]">
          <div className="text-ink">{user.name ?? user.email}</div>
          {user.name && <div className="text-ink-2">{user.email}</div>}
        </div>
        <DropdownMenuSeparator className="bg-rule" />
        <div className="flex items-center justify-between px-2.5 py-1.5 text-[13px] text-ink-2">
          Theme
          <ThemeControl />
        </div>
        <DropdownMenuSeparator className="bg-rule" />
        <DropdownMenuItem className="gap-2 px-2.5 text-[13px]" onSelect={() => openUserProfile()}>
          <Settings aria-hidden="true" /> Account settings
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2 px-2.5 text-[13px]" onSelect={() => setCompanySettingsOpen(true)}>
          <Building2 aria-hidden="true" /> Company settings
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2 px-2.5 text-[13px]" onSelect={() => signOut({ redirectUrl: "/login" })}>
          <LogOut aria-hidden="true" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
      </DropdownMenu>
      <CompanySettingsDialog open={companySettingsOpen} onOpenChange={setCompanySettingsOpen} company={company} baseCurrency={baseCurrency} />
    </>
  );
}
