import { auth, authMode, listCompanies, requireCompanyAccess } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { getModelOptions } from "@/lib/models";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await auth.protect({ unauthenticatedUrl: "/login" });
  const context = await requireCompanyAccess();
  const companies = await listCompanies();
  const query = await searchParams;
  const cashMonth = typeof query.cashMonth === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(query.cashMonth) ? query.cashMonth : null;
  const initialMessage = cashMonth ? `Explain cash in, cash out and ending cash for ${cashMonth}, and how this affects the following months. Use the current calculated forecast, cite the supporting sources, and distinguish approved inputs from proposals that are still excluded. Flag missing evidence or stale calculations.` : "";
  return (
    <AppShell
      key={context.company.id}
      initialMessage={initialMessage}
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
