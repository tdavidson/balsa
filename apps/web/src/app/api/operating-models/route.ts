import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { executeOperatingCommand, loadOperatingExperiment, loadOperatingWorkspace } from "@/lib/operating-models";
import { goalDecisionErrorResponse } from "@/lib/goal-decisions-http";
import { takeRateLimit } from "@/lib/request-rate-limit";
export async function GET(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess();
  const id = new URL(request.url).searchParams.get("id");
  if (id && !z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid experiment ID." }, { status: 400 });
  try { return NextResponse.json(id ? await loadOperatingExperiment(context.company.id, id) : await loadOperatingWorkspace(context.company.id)); }
  catch (error) { return goalDecisionErrorResponse(error); }
}
export async function POST(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess();
  if (request.headers.get("x-company-id") !== context.company.id) return NextResponse.json({ error: "Company selection changed. Reload before continuing." }, { status: 409 });
  const text = await request.text();
  if (text.length > 100_000) return NextResponse.json({ error: "Operating-model request is too large." }, { status: 413 });
  let body: unknown; try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  if ((body as { action?: string } | null)?.action === "draft" && !takeRateLimit(`operating:${context.company.id}:${context.user.id}`, 10, 60_000).allowed) return NextResponse.json({ error: "Too many draft requests. Retry in a minute." }, { status: 429 });
  try { return NextResponse.json(await executeOperatingCommand(context.company.id, body, context.user.id)); }
  catch (error) { return goalDecisionErrorResponse(error); }
}
