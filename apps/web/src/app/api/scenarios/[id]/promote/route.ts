import { NextResponse } from "next/server";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { scenarioErrorResponse } from "@/lib/scenario-http";
import { promoteScenario } from "@/lib/scenarios";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect(); const context = await requireCompanyAccess(); const { id } = await params;
  try { return NextResponse.json(await promoteScenario(context.company.id, id, context.user.id)); }
  catch (error) { return scenarioErrorResponse(error); }
}
