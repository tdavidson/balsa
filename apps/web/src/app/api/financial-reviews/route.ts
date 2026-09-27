import { NextResponse } from "next/server";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { executeFinancialReview, loadFinancialReviews, loadFinancialWorkReview } from "@/lib/financial-reviews";
import { goalDecisionErrorResponse } from "@/lib/goal-decisions-http";
export async function GET(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess(); const id = new URL(request.url).searchParams.get("id");
  try { return NextResponse.json(id ? await loadFinancialWorkReview(context.company.id, context.user.id, id) : await loadFinancialReviews(context.company.id, context.user.id)); }
  catch (error) { return goalDecisionErrorResponse(error); }
}
export async function POST(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess();
  if (request.headers.get("x-company-id") !== context.company.id) return NextResponse.json({ error: "Company selection changed. Reload before saving." }, { status: 409 });
  const text = await request.text(); if (text.length > 16000) return NextResponse.json({ error: "Review request is too large." }, { status: 413 });
  let body: unknown; try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "Invalid JSON request." }, { status: 400 }); }
  try { return NextResponse.json(await executeFinancialReview(context.company.id, context.user.id, body)); }
  catch (error) { return goalDecisionErrorResponse(error); }
}
