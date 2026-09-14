import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCompanyAccess } from "@/lib/auth";
import { loadFxRemeasurementPreview, postFxRemeasurement } from "@/lib/fx-remeasurement";

const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const body = z.object({ period, entityId: z.string().uuid().optional() });

export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = period.safeParse(new URL(request.url).searchParams.get("period"));
  if (!parsed.success) return NextResponse.json({ error: "period must be YYYY-MM" }, { status: 400 });
  return NextResponse.json(await loadFxRemeasurementPreview(context.company.id, parsed.data));
}

export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid FX remeasurement request" }, { status: 400 });
  const result = await postFxRemeasurement({ companyId: context.company.id, userId: context.user.id, period: parsed.data.period, ...(parsed.data.entityId ? { entityId: parsed.data.entityId } : {}) });
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
