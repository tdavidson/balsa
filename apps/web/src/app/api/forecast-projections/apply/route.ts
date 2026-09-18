import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { pinForecastAsPlan } from "@/lib/forecast-plan-pin";

const body = z.object({ start: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), end: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), scenarioId: z.string().uuid().optional() });

/** Pin the current projection as a plan. The live forecast is derived and never reads these entries. */
export async function POST(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess(); const parsed = body.safeParse(await request.json());
  if (!parsed.success || parsed.data.start > parsed.data.end) return NextResponse.json({ error: "start and end must be an ordered YYYY-MM range" }, { status: 400 });
  try {
    return NextResponse.json(await pinForecastAsPlan(context.company.id, { start: parsed.data.start, end: parsed.data.end, ...(parsed.data.scenarioId ? { scenarioId: parsed.data.scenarioId } : {}), actorUserId: context.user.id, baseCurrency: context.company.baseCurrency }));
  } catch (error) {
    if (error instanceof Error && error.message === "Scenario not found") return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
