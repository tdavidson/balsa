import { NextResponse } from "next/server";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { inspectGoalComparison } from "@/lib/goal-reviews";
import { goalReviewErrorResponse } from "@/lib/goal-review-http";
import { z } from "zod";

export async function GET(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess();
  const params = new URL(request.url).searchParams;
  const baseline = z.uuid().safeParse(params.get("baseline")); const preview = params.get("preview");
  if (!baseline.success || !preview || !/^[a-f0-9]{64}$/.test(preview)) return NextResponse.json({ error: "Choose a saved baseline and a current outlook preview." }, { status: 400 });
  try { return NextResponse.json(await inspectGoalComparison(context.company.id, baseline.data, preview)); }
  catch (error) { return goalReviewErrorResponse(error); }
}
