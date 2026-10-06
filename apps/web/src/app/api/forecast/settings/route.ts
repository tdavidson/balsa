import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { companies, getDatabase, recordAudit } from "@finance/database";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { amountToMinor } from "@/lib/forecast-drivers";
import { forecastAsOfMonth } from "@/lib/forecast-inputs";
import { resolveModelTimeline, validateTimeline } from "@/lib/model-timeline";
import { refreshCurrentCalculationRun } from "@/lib/refresh-calculation-run";

const settingsColumns = { minimumCashMinor: companies.minimumCashMinor, modelFirstPeriod: companies.modelFirstPeriod, modelLastPeriod: companies.modelLastPeriod, fiscalYearEnd: companies.fiscalYearEnd };
type Settings = { minimumCashMinor: string; modelFirstPeriod: string | null; modelLastPeriod: string | null; fiscalYearEnd: string | null };

async function present(companyId: string, settings: Settings) {
  const asOfMonth = await forecastAsOfMonth(companyId, new Date());
  return { minimumCash: Number(settings.minimumCashMinor) / 100, timeline: { ...resolveModelTimeline(settings, asOfMonth), asOfMonth, stored: { firstPeriod: settings.modelFirstPeriod, lastPeriod: settings.modelLastPeriod } } };
}

export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const [company] = await getDatabase().select(settingsColumns).from(companies).where(eq(companies.id, context.company.id)).limit(1);
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  return NextResponse.json(await present(context.company.id, company));
}

const body = z.object({
  minimumCash: z.number().min(0).optional(),
  /** The model timeline; null returns to the rolling default. */
  timeline: z.object({ firstPeriod: z.string(), lastPeriod: z.string(), fiscalYearEndMonth: z.number().int() }).nullable().optional(),
}).refine((value) => value.minimumCash !== undefined || value.timeline !== undefined, "Provide minimumCash or timeline");

/**
 * The cash floor that defines the forecast's cash-out month, and the model
 * timeline whose last period sets the forecast horizon. Changing either is a
 * revision with its own consequence.
 */
export async function PATCH(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  if (context.company.role !== "owner") return NextResponse.json({ error: "Only the company owner can change forecast settings" }, { status: 403 });
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message === "Provide minimumCash or timeline" ? "Provide a minimum cash amount or a timeline" : "Minimum cash must be zero or a positive amount" }, { status: 400 });
  const minor = parsed.data.minimumCash !== undefined ? amountToMinor(parsed.data.minimumCash.toFixed(2)) : undefined;
  if (minor === "") return NextResponse.json({ error: "Minimum cash must be zero or a positive amount" }, { status: 400 });
  const timeline = parsed.data.timeline;
  if (timeline) { const error = validateTimeline(timeline); if (error) return NextResponse.json({ error }, { status: 400 }); }
  const db = getDatabase();
  const [current] = await db.select(settingsColumns).from(companies).where(eq(companies.id, context.company.id)).limit(1);
  if (!current) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  const next: Settings = {
    minimumCashMinor: minor ?? current.minimumCashMinor,
    ...(timeline === undefined ? { modelFirstPeriod: current.modelFirstPeriod, modelLastPeriod: current.modelLastPeriod, fiscalYearEnd: current.fiscalYearEnd }
      : timeline === null ? { modelFirstPeriod: null, modelLastPeriod: null, fiscalYearEnd: null }
      : { modelFirstPeriod: timeline.firstPeriod, modelLastPeriod: timeline.lastPeriod, fiscalYearEnd: String(timeline.fiscalYearEndMonth).padStart(2, "0") }),
  };
  // An unchanged setting is not a revision: no consequence, no refresh.
  if (JSON.stringify(next) === JSON.stringify(current)) return NextResponse.json({ ...(await present(context.company.id, next)), calculationRun: null });
  await db.transaction(async (tx) => {
    await tx.update(companies).set({ ...next, updatedAt: new Date() }).where(eq(companies.id, context.company.id));
    if (timeline !== undefined) await recordAudit(tx, { companyId: context.company.id, actorUserId: context.user.id, via: "ui", action: "company.timeline_changed", entityType: "company", entityId: context.company.id, summary: timeline ? `Set the model timeline to ${timeline.firstPeriod} through ${timeline.lastPeriod}` : "Returned the model timeline to the rolling default", before: { firstPeriod: current.modelFirstPeriod, lastPeriod: current.modelLastPeriod, fiscalYearEnd: current.fiscalYearEnd }, after: { firstPeriod: next.modelFirstPeriod, lastPeriod: next.modelLastPeriod, fiscalYearEnd: next.fiscalYearEnd } });
  });
  // Only the last period and the cash floor change the forecast; the first period and fiscal year end are presentation.
  const forecastChanged = next.minimumCashMinor !== current.minimumCashMinor || next.modelLastPeriod !== current.modelLastPeriod;
  const calculationRun = forecastChanged ? await refreshCurrentCalculationRun(context.company.id, { ...(next.minimumCashMinor === current.minimumCashMinor ? { rebuildJournalGraphs: false } : {}), cause: { kind: "settings_changed", subjectType: "company", subjectId: context.company.id, actorUserId: context.user.id, via: "ui" } }) : null;
  return NextResponse.json({ ...(await present(context.company.id, next)), calculationRun });
}
