import { NextResponse } from "next/server";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { executeGoalReviewCommand, loadGoalReview } from "@/lib/goal-reviews";
import { goalReviewErrorResponse } from "@/lib/goal-review-http";

export async function GET() {
  await auth.protect(); const context = await requireCompanyAccess();
  try { return NextResponse.json(await loadGoalReview(context.company.id)); }
  catch (error) { return goalReviewErrorResponse(error); }
}

export async function POST(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess();
  if (request.headers.get("x-company-id") !== context.company.id) return NextResponse.json({ error: "Company selection changed. Reload this page before saving." }, { status: 409 });
  const text = await request.text();
  if (text.length > 16_000) return NextResponse.json({ error: "Review request is too large." }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "Invalid JSON request." }, { status: 400 }); }
  try { return NextResponse.json(await executeGoalReviewCommand(context.company.id, body, context.user.id)); }
  catch (error) { return goalReviewErrorResponse(error); }
}
