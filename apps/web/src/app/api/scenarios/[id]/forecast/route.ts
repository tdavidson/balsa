import { NextResponse } from "next/server";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { loadScenarioForecast } from "@/lib/forecast-scenarios";
import { scenarioErrorResponse } from "@/lib/scenario-http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect(); const context = await requireCompanyAccess(); const { id } = await params;
  try { return NextResponse.json(await loadScenarioForecast(context.company.id, id)); }
  catch (error) { return scenarioErrorResponse(error); }
}
