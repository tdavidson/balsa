import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { loadOperatingDraft, loadOperatingDrafts, saveOperatingDraft } from "@/lib/operating-drafts";
import { goalDecisionErrorResponse } from "@/lib/goal-decisions-http";
export async function GET(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess();
  const id = new URL(request.url).searchParams.get("id");
  if (id && !z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid draft ID." }, { status: 400 });
  try { return NextResponse.json(id ? await loadOperatingDraft(context.company.id, id) : await loadOperatingDrafts(context.company.id)); }
  catch (error) { return goalDecisionErrorResponse(error); }
}
export async function POST(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess();
  if (request.headers.get("x-company-id") !== context.company.id) return NextResponse.json({ error: "Company selection changed. Reload before continuing." }, { status: 409 });
  const text = await request.text();
  if (text.length > 100_000) return NextResponse.json({ error: "Decision draft is too large." }, { status: 413 });
  let body: unknown; try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  try { return NextResponse.json(await saveOperatingDraft(context.company.id, context.user.id, body)); }
  catch (error) { return goalDecisionErrorResponse(error); }
}
