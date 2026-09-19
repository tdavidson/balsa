import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { parseScenarioChanges } from "@/lib/scenario-changes";
import { scenarioErrorResponse } from "@/lib/scenario-http";
import { createScenario, listScenarios } from "@/lib/scenarios";

const createBody = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(2000).nullable().optional(), changes: z.array(z.unknown()).max(100).optional() });

export async function GET() {
  await auth.protect(); const context = await requireCompanyAccess();
  return NextResponse.json({ scenarios: await listScenarios(context.company.id) });
}

export async function POST(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess();
  const body = createBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "A scenario needs a name" }, { status: 400 });
  const changes = parseScenarioChanges(body.data.changes ?? []);
  if (!changes) return NextResponse.json({ error: "Invalid scenario changes" }, { status: 400 });
  try {
    const scenario = await createScenario(context.company.id, { name: body.data.name, changes, ...(body.data.description !== undefined ? { description: body.data.description } : {}) }, context.user.id);
    return NextResponse.json({ scenario }, { status: 201 });
  } catch (error) { return scenarioErrorResponse(error); }
}
