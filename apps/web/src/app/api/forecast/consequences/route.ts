import { NextResponse } from "next/server";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { loadRecentConsequences } from "@/lib/forecast-read";

/** Recent forecast consequences, newest first, each with its attributed causes. */
export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const requested = Number(new URL(request.url).searchParams.get("limit") ?? "10");
  const limit = Number.isFinite(requested) ? Math.min(50, Math.max(1, Math.trunc(requested))) : 10;
  return NextResponse.json({ consequences: await loadRecentConsequences(context.company.id, limit) });
}
