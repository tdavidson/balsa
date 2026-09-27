import { auth, requireCompanyAccess } from "@/lib/auth";
import { loadFinancialReviews } from "@/lib/financial-reviews";
import { goalDecisionErrorResponse } from "@/lib/goal-decisions-http";
import { FinancialReviews } from "@/components/financial-reviews";
export const dynamic = "force-dynamic";
export default async function ReviewsPage() {
  await auth.protect({ unauthenticatedUrl: "/login" }); const context = await requireCompanyAccess();
  let data = null; let error = "";
  try { data = await loadFinancialReviews(context.company.id, context.user.id); } catch (cause) { error = (await goalDecisionErrorResponse(cause).json()).error; }
  return <FinancialReviews key={context.company.id} company={{ id: context.company.id, name: context.company.name, currency: context.company.baseCurrency }} initialData={data} initialError={error} />;
}
