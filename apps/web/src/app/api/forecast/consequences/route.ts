import { NextResponse } from "next/server";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { loadRecentConsequences } from "@/lib/forecast-read";

/** Recent forecast consequences, newest first, each with its attributed causes. */
export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? "10");
  return NextResponse.json({ consequences: await loadRecentConsequences(context.company.id, Number.isFinite(limit) ? limit : 10) });
}
