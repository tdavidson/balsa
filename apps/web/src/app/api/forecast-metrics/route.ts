import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { forecastMetrics, getDatabase } from "@finance/database";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { metricSchema } from "@/lib/driver-pattern-schema";
import { patternErrorResponse } from "@/lib/driver-patterns-http";
import { saveMetricWith } from "@/lib/driver-patterns-store";
import { commitModelWrite } from "@/lib/forecast-model-http";
import type { DriverPattern } from "@balsa/finance-engine";

export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  return NextResponse.json({ metrics: await getDatabase().select().from(forecastMetrics).where(eq(forecastMetrics.companyId, context.company.id)).orderBy(asc(forecastMetrics.label)) });
}

/** Add an operating metric: a forecast series drivers can be a "% of" or "per unit" of. */
export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = metricSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid metric" }, { status: 400 });
  try {
    const committed = await commitModelWrite(context.company.id, { kind: "model_changed", subjectType: "forecast_metric", actorUserId: context.user.id, via: "ui" }, async (tx) => { const row = await saveMetricWith(tx, { companyId: context.company.id, actorUserId: context.user.id, via: "ui" }, { ...parsed.data, pattern: parsed.data.pattern as DriverPattern }); return { value: row, subjectId: row.id }; });
    return NextResponse.json({ metric: committed.value, calculationRun: committed.calculationRun }, { status: 201 });
  } catch (error) { return patternErrorResponse(error); }
}
