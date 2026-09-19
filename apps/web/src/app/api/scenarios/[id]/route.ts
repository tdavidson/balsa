import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { parseScenarioChanges } from "@/lib/scenario-changes";
import { scenarioErrorResponse } from "@/lib/scenario-http";
import { deactivateScenario, updateScenario } from "@/lib/scenarios";

const patchBody = z.object({ name: z.string().trim().min(1).max(120).optional(), description: z.string().max(2000).nullable().optional(), changes: z.array(z.unknown()).max(100).optional() });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect(); const context = await requireCompanyAccess(); const { id } = await params;
  const body = patchBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid scenario update" }, { status: 400 });
  const changes = body.data.changes === undefined ? undefined : parseScenarioChanges(body.data.changes);
  if (changes === null) return NextResponse.json({ error: "Invalid scenario changes" }, { status: 400 });
  try {
    const scenario = await updateScenario(context.company.id, id, { ...(body.data.name !== undefined ? { name: body.data.name } : {}), ...(body.data.description !== undefined ? { description: body.data.description } : {}), ...(changes ? { changes } : {}) }, context.user.id);
    return NextResponse.json({ scenario });
  } catch (error) { return scenarioErrorResponse(error); }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect(); const context = await requireCompanyAccess(); const { id } = await params;
  try { await deactivateScenario(context.company.id, id, context.user.id); return NextResponse.json({ deactivated: true }); }
  catch (error) { return scenarioErrorResponse(error); }
}
