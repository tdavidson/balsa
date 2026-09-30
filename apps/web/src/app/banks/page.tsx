import { auth, requireOwner } from "@/lib/auth";
import { BankConnectionsPanel } from "@/components/bank-connections-panel";
export const dynamic = "force-dynamic";
export default async function BanksPage() {
  await auth.protect({ unauthenticatedUrl: "/login" });
  try { const context = await requireOwner(); return <BankConnectionsPanel key={context.company.id} companyId={context.company.id} companyName={context.company.name} />; }
  catch { return <p className="p-8">Company owner access is required to manage bank connections.</p>; }
}
