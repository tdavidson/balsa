"use client";

import { Building2, LogOut, User } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeControl } from "@/components/theme-control";
import { CompanySettingsDialog } from "@/components/company-settings-dialog";
import { UserSettingsDialog } from "@/components/user-settings-dialog";
import { authClient } from "@/lib/auth-client";

type AccountMenuProps = {
  company: string;
  baseCurrency?: string;
  user: { email: string; name: string | null; hasAvatar?: boolean };
  loginEnabled?: boolean;
};

export function AccountMenu({ company, baseCurrency = "USD", user, loginEnabled = true }: AccountMenuProps) {
  const router = useRouter();
  const [companySettingsOpen, setCompanySettingsOpen] = useState(false);
  const [userSettingsOpen, setUserSettingsOpen] = useState(false);
  const [avatarUnavailable, setAvatarUnavailable] = useState(false);
  async function signOut() {
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
        <span>{company}</span>
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
        <DropdownMenuItem className="cursor-pointer gap-2 px-2.5 text-[13px]" onSelect={() => setUserSettingsOpen(true)}>
          <User aria-hidden="true" /> Your settings
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer gap-2 px-2.5 text-[13px]" onSelect={() => setCompanySettingsOpen(true)}>
          <Building2 aria-hidden="true" /> Company settings
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
      <CompanySettingsDialog open={companySettingsOpen} onOpenChange={setCompanySettingsOpen} company={company} baseCurrency={baseCurrency} />
      <UserSettingsDialog open={userSettingsOpen} onOpenChange={setUserSettingsOpen} user={user} localOnly={!loginEnabled} />
    </>
  );
}
