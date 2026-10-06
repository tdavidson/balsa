import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, requireCompanyAccess } from "@/lib/auth";
import {
  executeOperatingOutcome,
  loadOperatingOutcome,
  loadOperatingOutcomeReview,
  loadOperatingOutcomeWorkspace,
} from "@/lib/operating-outcomes";
import { goalDecisionErrorResponse } from "@/lib/goal-decisions-http";
export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const review = params.get("review");
  if (
    (id && !z.uuid().safeParse(id).success) ||
    (review && !z.uuid().safeParse(review).success)
  )
    return NextResponse.json(
      { error: "Invalid outcome selection." },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      review
        ? await loadOperatingOutcomeReview(context.company.id, review)
        : id
          ? await loadOperatingOutcome(context.company.id, id)
          : await loadOperatingOutcomeWorkspace(context.company.id),
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
      { error: "Outcome request is too large." },
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
      await executeOperatingOutcome(context.company.id, body, context.user.id),
    );
  } catch (error) {
    return goalDecisionErrorResponse(error);
  }
}
