import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { loadGoalSnapshot } from "@/lib/goal-reviews";
import { goalReviewErrorResponse } from "@/lib/goal-review-http";

export async function GET(_request: Request, route: { params: Promise<{ id: string }> }) {
  await auth.protect(); const context = await requireCompanyAccess();
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Saved review or plan not found." }, { status: 404 });
  try { return NextResponse.json(await loadGoalSnapshot(context.company.id, id)); }
  catch (error) { return goalReviewErrorResponse(error); }
}
