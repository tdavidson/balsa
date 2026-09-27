import { auth, requireCompanyAccess } from "@/lib/auth";
import { ForecastReconciliation } from "@/components/forecast-reconciliation";
import { loadForecastReconciliation } from "@/lib/forecast-reconciliation";
import { reconciliationErrorResponse } from "@/lib/forecast-reconciliation-http";

export const dynamic = "force-dynamic";
export default async function ReconciliationPage() {
  await auth.protect({ unauthenticatedUrl: "/login" }); const context = await requireCompanyAccess();
  let data = null; let error = "";
  try { data = await loadForecastReconciliation(context.company.id); }
  catch (cause) { error = (await reconciliationErrorResponse(cause).json()).error; }
  return <ForecastReconciliation key={context.company.id} companyId={context.company.id} companyName={context.company.name} initialData={data} initialError={error} />;
}
