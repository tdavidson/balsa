import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { executeGoalDecision, loadGoalDecisionReview, loadGoalDecisionWorkspace } from "@/lib/goal-decisions";
import { goalDecisionErrorResponse } from "@/lib/goal-decisions-http";

export async function GET(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess();
  const id = new URL(request.url).searchParams.get("id");
  if (id && !z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid review ID." }, { status: 400 });
  try { return NextResponse.json(id ? await loadGoalDecisionReview(context.company.id, id) : await loadGoalDecisionWorkspace(context.company.id)); }
  catch (error) { return goalDecisionErrorResponse(error); }
}

export async function POST(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess();
  if (request.headers.get("x-company-id") !== context.company.id) return NextResponse.json({ error: "Company selection changed. Reload before continuing." }, { status: 409 });
  const text = await request.text();
  if (text.length > 600_000) return NextResponse.json({ error: "Decision review request is too large." }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "Invalid JSON request." }, { status: 400 }); }
  try { return NextResponse.json(await executeGoalDecision(context.company.id, body, context.user.id)); }
  catch (error) { return goalDecisionErrorResponse(error); }
}
