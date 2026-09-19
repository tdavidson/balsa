import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { scenarioErrorResponse } from "@/lib/scenario-http";
import { scenarioFromDecision } from "@/lib/scenarios";

const body = z.object({ decisionId: z.string().uuid() });

export async function POST(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess();
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "decisionId is required" }, { status: 400 });
  try { return NextResponse.json({ scenario: await scenarioFromDecision(context.company.id, parsed.data.decisionId, context.user.id) }, { status: 201 }); }
  catch (error) { return scenarioErrorResponse(error); }
}
