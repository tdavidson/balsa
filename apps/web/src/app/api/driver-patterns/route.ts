import { NextResponse } from "next/server";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { loadDriverOverview } from "@/lib/driver-overview";

/** The driver editor's view: drivers, metrics, seasonality profiles and the default escalation. */
export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  return NextResponse.json(await loadDriverOverview(context.company.id));
}
