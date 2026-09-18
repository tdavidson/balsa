import { auth } from "@/lib/auth";
import { and, asc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { approvalEvents, evidence, factRecords, fxRates, fxRateSets, getDatabase, sources } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";
import { refreshCurrentCalculationRun } from "@/lib/refresh-calculation-run";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const currency = z.string().regex(/^[A-Z]{3}$/);
const positiveInteger = z.string().regex(/^[1-9]\d*$/);
const rateType = z.enum(["spot", "average", "closing", "historical"]);
const rate = z.object({ fromCurrency: currency, toCurrency: currency, rateType, effectiveDate: isoDate, numerator: positiveInteger, denominator: positiveInteger, sourceId: z.string().uuid().optional(), evidenceId: z.string().uuid().optional(), factId: z.string().uuid().optional(), sourceLocation: z.string().trim().max(500).optional() }).refine((value) => value.fromCurrency !== value.toCurrency, { message: "A rate must quote two different currencies." });
const createRateSet = z.object({ name: z.string().trim().min(1).max(200), provider: z.string().trim().max(200).optional(), sourceId: z.string().uuid().optional(), effectiveFrom: isoDate.optional(), effectiveTo: isoDate.optional(), notes: z.string().trim().max(2_000).optional(), rates: z.array(rate).min(1).max(1_000) }).refine((value) => !value.effectiveFrom || !value.effectiveTo || value.effectiveFrom <= value.effectiveTo, { message: "effectiveFrom must not be after effectiveTo." });
const updateRateSet = z.object({ id: z.string().uuid(), status: z.enum(["approved", "superseded", "rejected"]), approvalEventId: z.string().uuid().optional() });

/** Rate sets preserve draft evidence separately from the CFO-approved quote set that may affect reporting. */
export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const db = getDatabase();
  const sets = await db.select().from(fxRateSets).where(eq(fxRateSets.companyId, context.company.id)).orderBy(asc(fxRateSets.createdAt));
  const rows = sets.length ? await db.select().from(fxRates).where(and(eq(fxRates.companyId, context.company.id), inArray(fxRates.rateSetId, sets.map((set) => set.id)))).orderBy(asc(fxRates.effectiveDate)) : [];
  const ratesBySet = new Map<string, typeof rows>();
  for (const row of rows) ratesBySet.set(row.rateSetId, [...(ratesBySet.get(row.rateSetId) ?? []), row]);
  return NextResponse.json({ rateSets: sets.map((set) => ({ ...set, rates: ratesBySet.get(set.id) ?? [] })) });
}

export async function POST(request: Request) {
  await auth.protect();
  const parsed = createRateSet.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid FX rate set", details: parsed.error.flatten() }, { status: 400 });
  const context = await requireCompanyAccess();
  const db = getDatabase();
  if (parsed.data.rates.some((item) => !item.sourceId && !item.evidenceId && !item.factId)) return NextResponse.json({ error: "Every FX quote requires a source, evidence document, or extracted fact." }, { status: 400 });
  const sourceIds = [...new Set([parsed.data.sourceId, ...parsed.data.rates.map((item) => item.sourceId)].filter((value): value is string => Boolean(value)))];
  if (sourceIds.length) {
    const rows = await db.select({ id: sources.id }).from(sources).where(and(eq(sources.companyId, context.company.id), inArray(sources.id, sourceIds)));
    if (rows.length !== sourceIds.length) return NextResponse.json({ error: "An FX source does not belong to this company." }, { status: 400 });
  }
  const evidenceIds = [...new Set(parsed.data.rates.map((item) => item.evidenceId).filter((value): value is string => Boolean(value)))];
  if (evidenceIds.length && (await db.select({ id: evidence.id }).from(evidence).where(and(eq(evidence.companyId, context.company.id), inArray(evidence.id, evidenceIds)))).length !== evidenceIds.length) return NextResponse.json({ error: "An FX evidence document does not belong to this company." }, { status: 400 });
  const factIds = [...new Set(parsed.data.rates.map((item) => item.factId).filter((value): value is string => Boolean(value)))];
  if (factIds.length && (await db.select({ id: factRecords.id }).from(factRecords).where(and(eq(factRecords.companyId, context.company.id), inArray(factRecords.id, factIds)))).length !== factIds.length) return NextResponse.json({ error: "An FX fact does not belong to this company." }, { status: 400 });
  const created = await db.transaction(async (transaction) => {
    const [set] = await transaction.insert(fxRateSets).values({ companyId: context.company.id, name: parsed.data.name, provider: parsed.data.provider, sourceId: parsed.data.sourceId, effectiveFrom: parsed.data.effectiveFrom, effectiveTo: parsed.data.effectiveTo, notes: parsed.data.notes, status: "draft" }).returning();
    const rates = await transaction.insert(fxRates).values(parsed.data.rates.map((item) => ({ companyId: context.company.id, rateSetId: set!.id, ...item }))).returning();
    return { set, rates };
  });
  return NextResponse.json({ rateSet: created.set, rates: created.rates }, { status: 201 });
}

export async function PATCH(request: Request) {
  await auth.protect();
  const parsed = updateRateSet.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid FX rate-set update" }, { status: 400 });
  const context = await requireCompanyAccess();
  const db = getDatabase();
  const [set] = await db.select().from(fxRateSets).where(and(eq(fxRateSets.id, parsed.data.id), eq(fxRateSets.companyId, context.company.id)));
  if (!set) return NextResponse.json({ error: "FX rate set not found" }, { status: 404 });
  if (parsed.data.status === "approved") {
    if (!parsed.data.approvalEventId) return NextResponse.json({ error: "An approval event is required before rates can affect reporting." }, { status: 400 });
    const [event] = await db.select({ id: approvalEvents.id, evidenceId: approvalEvents.evidenceId, factId: approvalEvents.factId, action: approvalEvents.action }).from(approvalEvents).where(and(eq(approvalEvents.id, parsed.data.approvalEventId), eq(approvalEvents.companyId, context.company.id)));
    if (!event || event.action !== "approved") return NextResponse.json({ error: "A recorded approval event is required for this company." }, { status: 400 });
    const rateRows = await db.select({ id: fxRates.id, sourceId: fxRates.sourceId, evidenceId: fxRates.evidenceId, factId: fxRates.factId }).from(fxRates).where(and(eq(fxRates.rateSetId, set.id), eq(fxRates.companyId, context.company.id)));
    if (!rateRows.length) return NextResponse.json({ error: "A rate set must contain at least one quote before approval." }, { status: 400 });
    if (rateRows.some((row) => !row.sourceId && !row.evidenceId && !row.factId)) return NextResponse.json({ error: "Every approved FX quote must retain source lineage." }, { status: 409 });
    if (!rateRows.some((row) => (event.evidenceId && row.evidenceId === event.evidenceId) || (event.factId && row.factId === event.factId))) return NextResponse.json({ error: "The approval event must approve evidence or a fact used by this rate set." }, { status: 409 });
  }
  const [updated] = await db.update(fxRateSets).set({ status: parsed.data.status, ...(parsed.data.approvalEventId ? { approvalEventId: parsed.data.approvalEventId } : {}), updatedAt: new Date() }).where(and(eq(fxRateSets.id, set.id), eq(fxRateSets.companyId, context.company.id))).returning();
  const calculationRun = await refreshCurrentCalculationRun(context.company.id, { cause: { kind: "fx_changed", subjectType: "fx_rate_set", subjectId: set.id, actorUserId: context.user.id, via: "ui" } });
  return NextResponse.json({ rateSet: updated, calculationRun });
}
