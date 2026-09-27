import { NextResponse } from "next/server";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { inspectGoalOutlook } from "@/lib/goal-reviews";
import { goalReviewErrorResponse } from "@/lib/goal-review-http";

export async function GET(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess();
  const token = new URL(request.url).searchParams.get("preview");
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return NextResponse.json({ error: "A current preview is required." }, { status: 400 });
  try { return NextResponse.json(await inspectGoalOutlook(context.company.id, token)); }
  catch (error) { return goalReviewErrorResponse(error); }
}
