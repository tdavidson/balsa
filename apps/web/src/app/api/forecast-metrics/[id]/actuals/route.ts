import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { evidence, factRecords, forecastMetricActuals, getDatabase } from "@finance/database";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { patternErrorResponse } from "@/lib/driver-patterns-http";
import { setMetricActualsWith } from "@/lib/driver-patterns-store";
import { commitModelWrite } from "@/lib/forecast-model-http";

/** A metric's actual values, each with where it came from. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const rows = await getDatabase().select({ month: forecastMetricActuals.month, value: forecastMetricActuals.value, evidenceId: forecastMetricActuals.evidenceId, factId: forecastMetricActuals.factId, decisionId: forecastMetricActuals.decisionId, sourceName: evidence.sourceName, factLabel: factRecords.label })
    .from(forecastMetricActuals).leftJoin(evidence, eq(forecastMetricActuals.evidenceId, evidence.id)).leftJoin(factRecords, eq(forecastMetricActuals.factId, factRecords.id))
    .where(and(eq(forecastMetricActuals.companyId, context.company.id), eq(forecastMetricActuals.metricId, (await params).id))).orderBy(asc(forecastMetricActuals.month));
  return NextResponse.json({ actuals: rows });
}

const body = z.object({ values: z.array(z.object({ month: z.string(), value: z.string().trim().nullable(), evidenceId: z.string().uuid().nullable().optional(), factId: z.string().uuid().nullable().optional() })).min(1).max(240) });

/** Record, change or remove actual values; a null value removes that month. A revision: the forecast recalculates. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid actuals" }, { status: 400 });
  const id = (await params).id;
  try {
    const committed = await commitModelWrite(context.company.id, { kind: "model_changed", subjectType: "forecast_metric", actorUserId: context.user.id, via: "ui" }, async (tx) => ({ value: await setMetricActualsWith(tx, { companyId: context.company.id, actorUserId: context.user.id, via: "ui" }, { id }, parsed.data.values), subjectId: id }));
    return NextResponse.json({ metric: committed.value, calculationRun: committed.calculationRun });
  } catch (error) { return patternErrorResponse(error); }
}
