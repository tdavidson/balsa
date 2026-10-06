import { auth, requireCompanyAccess } from "@/lib/auth";
import { z } from "zod";
import { operatingModelSchema } from "@/lib/operating-model-contract";
import { loadOperatingWorkspace, loadOperatingExperiment } from "@/lib/operating-models";
import { goalDecisionErrorResponse } from "@/lib/goal-decisions-http";
import { OperatingModels, type PreservedDecision } from "@/components/operating-models";
export const dynamic = "force-dynamic";
export default async function OperatingModelsPage({ searchParams }: { searchParams: Promise<{ experiment?: string; view?: string }> }) {
  const selection = await searchParams;
  await auth.protect({ unauthenticatedUrl: "/login" }); const context = await requireCompanyAccess();
  let data = null; let error = ""; let preserved: PreservedDecision | null = null;
  try {
    data = await loadOperatingWorkspace(context.company.id);
    if (selection.experiment) {
      if (!z.uuid().safeParse(selection.experiment).success) throw new Error("Invalid selection");
      const saved = await loadOperatingExperiment(context.company.id, selection.experiment);
      const snapshot = saved.snapshot as { model: unknown; path?: { caseId?: string } };
      preserved = { id: saved.id, scenarioId: saved.scenarioId, model: operatingModelSchema.parse(snapshot.model), caseId: snapshot.path?.caseId ?? "base" };
    }
  } catch (cause) { error = (await goalDecisionErrorResponse(cause).json()).error; }
  return <OperatingModels key={`${context.company.id}:${preserved?.id ?? "new"}:${selection.view ?? ""}`} company={{ id: context.company.id, name: context.company.name, currency: context.company.baseCurrency }} initialData={data} initialError={error} initialSaved={preserved} initialView={preserved && selection.view === "outcome" ? "outcome" : preserved ? "assumptions" : "overview"} />;
}
