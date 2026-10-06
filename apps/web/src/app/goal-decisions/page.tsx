import { auth, requireCompanyAccess } from "@/lib/auth";
import { loadGoalDecisionWorkspace } from "@/lib/goal-decisions";
import { goalDecisionErrorResponse } from "@/lib/goal-decisions-http";
import { GoalDecisions } from "@/components/goal-decisions";

export const dynamic = "force-dynamic";
export default async function GoalDecisionsPage({searchParams}: {searchParams: Promise<{scenario?:string|string[]}>}) {
  const selection=await searchParams;
  await auth.protect({ unauthenticatedUrl: "/login" });
  const context = await requireCompanyAccess();
  let initialData = null; let initialError = "";
  try { initialData = await loadGoalDecisionWorkspace(context.company.id); }
  catch (error) { initialError = (await goalDecisionErrorResponse(error).json()).error; }
  return <GoalDecisions key={context.company.id} company={{ id: context.company.id, name: context.company.name, currency: context.company.baseCurrency }} initialData={initialData} initialError={initialError} initialScenarioId={typeof selection.scenario === "string" && initialData?.scenarios.some(s=>s.id===selection.scenario) ? selection.scenario : ""} />;
}
