import { auth, authMode, requireCompanyAccess } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { getModelOptions } from "@/lib/models";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await auth.protect({ unauthenticatedUrl: "/login" });
  const context = await requireCompanyAccess();
  return (
    <AppShell
      company={{ name: context.company.name, currency: context.company.baseCurrency }}
      user={{ email: context.user.email, name: context.user.name, hasAvatar: context.user.hasAvatar }}
      modelOptions={getModelOptions()}
      loginEnabled={authMode === "better-auth"}
    />
  );
}
