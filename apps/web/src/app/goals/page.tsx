import { auth, requireCompanyAccess } from "@/lib/auth";
import { GoalReview } from "@/components/goal-review";
import { loadGoalReview } from "@/lib/goal-reviews";
import { goalReviewErrorResponse } from "@/lib/goal-review-http";

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  await auth.protect({ unauthenticatedUrl: "/login" });
  const context = await requireCompanyAccess();
  let initialData = null; let initialError: string | undefined;
  try { initialData = await loadGoalReview(context.company.id); }
  catch (error) { initialError = (await goalReviewErrorResponse(error).json()).error; }
  return <GoalReview key={context.company.id} company={{ id: context.company.id, name: context.company.name, currency: context.company.baseCurrency }} initialData={initialData} initialError={initialError} />;
}
