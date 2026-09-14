import { auth, authMode, listCompanies, requireCompanyAccess } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { getModelOptions } from "@/lib/models";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await auth.protect({ unauthenticatedUrl: "/login" });
  const context = await requireCompanyAccess();
  const companies = await listCompanies();
  return (
    <AppShell
      key={context.company.id}
      company={{ id: context.company.id, name: context.company.name, currency: context.company.baseCurrency }}
      companies={companies.map(({ id, name, baseCurrency, role }) => ({ id, name, baseCurrency, role }))}
      role={context.company.role}
      staleSelection={context.selection.staleSelection}
      user={{ email: context.user.email, name: context.user.name, hasAvatar: context.user.hasAvatar }}
      modelOptions={getModelOptions()}
      loginEnabled={authMode === "better-auth"}
    />
  );
}
