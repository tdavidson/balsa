import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, requireCompanyAccess } from "@/lib/auth";
import {
  executeOperatingPlan,
  loadOperatingPlanWorkspace,
} from "@/lib/operating-plan-revisions";
import { goalDecisionErrorResponse } from "@/lib/goal-decisions-http";
export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const params = new URL(request.url).searchParams;
  const id = params.get("reviewId");
  if (!z.uuid().safeParse(id).success)
    return NextResponse.json(
      { error: "Choose a trigger review." },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      await loadOperatingPlanWorkspace(context.company.id, id!),
    );
  } catch (error) {
    return goalDecisionErrorResponse(error);
  }
}
export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  if (request.headers.get("x-company-id") !== context.company.id)
    return NextResponse.json(
      { error: "Company selection changed. Reload before continuing." },
      { status: 409 },
    );
  const text = await request.text();
  if (text.length > 12_000)
    return NextResponse.json(
      { error: "Plan revision request is too large." },
      { status: 413 },
    );
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  try {
    return NextResponse.json(
      await executeOperatingPlan(context.company.id, body, context.user.id),
    );
  } catch (error) {
    return goalDecisionErrorResponse(error);
  }
}
