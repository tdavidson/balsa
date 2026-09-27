import { auth, requireCompanyAccess } from "@/lib/auth";
import { loadFinancialProgress } from "@/lib/financial-progress";
import { goalDecisionErrorResponse } from "@/lib/goal-decisions-http";
import { FinancialProgress } from "@/components/financial-progress";
export const dynamic = "force-dynamic";
export default async function ProgressPage() {
  await auth.protect({ unauthenticatedUrl: "/login" }); const context = await requireCompanyAccess();
  let data = null; let error = "";
  try { data = await loadFinancialProgress(context.company.id); } catch (cause) { error = (await goalDecisionErrorResponse(cause).json()).error; }
  return <FinancialProgress key={context.company.id} company={{ id: context.company.id, name: context.company.name, currency: context.company.baseCurrency }} initialData={data} initialError={error} />;
}
