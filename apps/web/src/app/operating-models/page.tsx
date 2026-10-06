import { auth, requireCompanyAccess } from "@/lib/auth";
import { loadOperatingWorkspace } from "@/lib/operating-models";
import { goalDecisionErrorResponse } from "@/lib/goal-decisions-http";
import { OperatingModels } from "@/components/operating-models";
export const dynamic = "force-dynamic";
export default async function OperatingModelsPage() {
  await auth.protect({ unauthenticatedUrl: "/login" }); const context = await requireCompanyAccess();
  let data = null; let error = "";
  try { data = await loadOperatingWorkspace(context.company.id); } catch (cause) { error = (await goalDecisionErrorResponse(cause).json()).error; }
  return <OperatingModels key={context.company.id} company={{ id: context.company.id, name: context.company.name, currency: context.company.baseCurrency }} initialData={data} initialError={error} />;
}
