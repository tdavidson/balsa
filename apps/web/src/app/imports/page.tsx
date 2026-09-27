import { auth, requireCompanyAccess } from "@/lib/auth";
import { loadImportReviewWorkspace } from "@/lib/import-review";
import { goalDecisionErrorResponse } from "@/lib/goal-decisions-http";
import { ImportReview } from "@/components/import-review";
export const dynamic = "force-dynamic";
export default async function ImportsPage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const selected = (await searchParams).source ?? "";
  await auth.protect({ unauthenticatedUrl: "/login" }); const context = await requireCompanyAccess();
  let data = null; let error = "";
  try { data = await loadImportReviewWorkspace(context.company.id); } catch (cause) { error = (await goalDecisionErrorResponse(cause).json()).error; }
  return <ImportReview key={context.company.id} company={{ id: context.company.id, name: context.company.name, currency: context.company.baseCurrency }} initialSourceId={data?.sources.some((source) => source.id === selected) ? selected : ""} initialData={data} initialError={error} />;
}
