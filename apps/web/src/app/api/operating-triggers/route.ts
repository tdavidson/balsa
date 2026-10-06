import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, requireCompanyAccess } from "@/lib/auth";
import {
  executeOperatingTrigger,
  loadOperatingTriggers,
  loadOperatingTriggerReview,
} from "@/lib/operating-triggers";
import { goalDecisionErrorResponse } from "@/lib/goal-decisions-http";
export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const params = new URL(request.url).searchParams;
  const id = params.get("predictionId");
  if (!z.uuid().safeParse(id).success)
    return NextResponse.json(
      { error: "Choose a preserved prediction." },
      { status: 400 },
    );
  const reviewId = params.get("reviewId");
  if (reviewId && !z.uuid().safeParse(reviewId).success)
    return NextResponse.json(
      { error: "Invalid review selection." },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      reviewId
        ? await loadOperatingTriggerReview(context.company.id, id!, reviewId)
        : await loadOperatingTriggers(context.company.id, id!),
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
      { error: "Trigger request is too large." },
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
      await executeOperatingTrigger(context.company.id, body, context.user.id),
    );
  } catch (error) {
    return goalDecisionErrorResponse(error);
  }
}
