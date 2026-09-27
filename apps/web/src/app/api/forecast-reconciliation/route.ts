import { NextResponse } from "next/server";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { executeForecastReconciliation, loadForecastReconciliation } from "@/lib/forecast-reconciliation";
import { reconciliationErrorResponse } from "@/lib/forecast-reconciliation-http";

export async function GET() {
  await auth.protect(); const context = await requireCompanyAccess();
  try { return NextResponse.json(await loadForecastReconciliation(context.company.id)); }
  catch (error) { return reconciliationErrorResponse(error); }
}
export async function POST(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess();
  if (request.headers.get("x-company-id") !== context.company.id) return NextResponse.json({ error: "Company selection changed. Reload before reviewing." }, { status: 409 });
  const text = await request.text();
  if (text.length > 16_000) return NextResponse.json({ error: "Review request is too large." }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "Invalid JSON request." }, { status: 400 }); }
  try { return NextResponse.json(await executeForecastReconciliation(context.company.id, body, context.user.id)); }
  catch (error) { return reconciliationErrorResponse(error); }
}
