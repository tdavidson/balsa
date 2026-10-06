import { NextResponse } from "next/server";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { metricSchema } from "@/lib/driver-pattern-schema";
import { patternErrorResponse } from "@/lib/driver-patterns-http";
import { deleteMetricWith, saveMetricWith } from "@/lib/driver-patterns-store";
import { commitModelWrite } from "@/lib/forecast-model-http";
import type { DriverPattern } from "@balsa/finance-engine";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = metricSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid metric" }, { status: 400 });
  const id = (await params).id;
  try {
    const committed = await commitModelWrite(context.company.id, { kind: "model_changed", subjectType: "forecast_metric", actorUserId: context.user.id, via: "ui" }, async (tx) => ({ value: await saveMetricWith(tx, { companyId: context.company.id, actorUserId: context.user.id, via: "ui" }, { ...parsed.data, pattern: parsed.data.pattern as DriverPattern }, id), subjectId: id }));
    return NextResponse.json({ metric: committed.value, calculationRun: committed.calculationRun });
  } catch (error) { return patternErrorResponse(error); }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const id = (await params).id;
  try {
    const committed = await commitModelWrite(context.company.id, { kind: "model_changed", subjectType: "forecast_metric", actorUserId: context.user.id, via: "ui" }, async (tx) => { await deleteMetricWith(tx, { companyId: context.company.id, actorUserId: context.user.id, via: "ui" }, id); return { value: null, subjectId: id }; });
    return NextResponse.json({ deleted: true, calculationRun: committed.calculationRun });
  } catch (error) { return patternErrorResponse(error); }
}
