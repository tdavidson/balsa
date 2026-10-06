import { z } from "zod";
import { loadOperatingExperiment } from "@/lib/operating-models";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { loadGoalDecisionWorkspace } from "@/lib/goal-decisions";
import { goalDecisionErrorResponse } from "@/lib/goal-decisions-http";
import { GoalDecisions } from "@/components/goal-decisions";

export const dynamic = "force-dynamic";
export default async function GoalDecisionsPage({searchParams}: {searchParams: Promise<{scenario?:string|string[]; experiment?:string|string[]}>}) {
  const selection=await searchParams;
  await auth.protect({ unauthenticatedUrl: "/login" });
  const context = await requireCompanyAccess();
  let initialData = null; let initialError = "";
  try { initialData = await loadGoalDecisionWorkspace(context.company.id); }
  catch (error) { initialError = (await goalDecisionErrorResponse(error).json()).error; }
  let decisionReturnHref = "";
  if (typeof selection.experiment === "string" && z.uuid().safeParse(selection.experiment).success) {
    try { const saved = await loadOperatingExperiment(context.company.id, selection.experiment); if (saved.scenarioId === selection.scenario) decisionReturnHref = `/operating-models?experiment=${saved.id}&view=outcome`; } catch { /* A missing or foreign experiment provides no navigation context. */ }
  }
  return <GoalDecisions decisionReturnHref={decisionReturnHref} key={`${context.company.id}:${typeof selection.scenario === "string" ? selection.scenario : ""}:${decisionReturnHref}`} company={{ id: context.company.id, name: context.company.name, currency: context.company.baseCurrency }} initialData={initialData} initialError={initialError} initialScenarioId={typeof selection.scenario === "string" && initialData?.scenarios.some(s=>s.id===selection.scenario) ? selection.scenario : ""} />;
}
