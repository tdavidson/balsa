import { auth } from "@/lib/auth";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { buildProjectedEntries } from "@nevermodel/finance-engine";
import { economicItems, forecastEntryTemplates, getDatabase } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";

const validMonth = (value: string | null) => Boolean(value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value));
const toMinor = (value: string | null) => {
  if (!value || !/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split("."); return `${whole}${fraction.padEnd(2, "0")}`.replace(/^0+(?=\d)/, "");
};

/** Preview projected balanced entries. This endpoint never writes journals. */
export async function GET(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess(); const url = new URL(request.url);
  const start = url.searchParams.get("start"); const end = url.searchParams.get("end"); const scenarioId = url.searchParams.get("scenarioId") ?? undefined;
  if (!validMonth(start) || !validMonth(end) || start! > end!) return NextResponse.json({ error: "start and end must be YYYY-MM, with start no later than end" }, { status: 400 });
  const db = getDatabase();
  const [items, templates] = await Promise.all([
    db.select().from(economicItems).where(and(eq(economicItems.companyId, context.company.id), eq(economicItems.status, "confirmed"))),
    db.select().from(forecastEntryTemplates).where(and(eq(forecastEntryTemplates.companyId, context.company.id), eq(forecastEntryTemplates.active, "Y"))),
  ]);
  const drivers = items.filter((item) => (scenarioId ? item.scenarioId === scenarioId : !item.scenarioId)).map((item) => ({ id: item.id, label: item.label, itemType: item.type as "agreement" | "obligation", direction: item.direction, ...(item.category ? { category: item.category } : {}), amountMinor: toMinor(item.amount) ?? "", cadence: item.cadence as "once" | "monthly" | "quarterly" | "annual", effectiveFrom: item.effectiveFrom ?? "", ...(item.effectiveTo ? { effectiveTo: item.effectiveTo } : {}), ...(item.scenarioId ? { scenarioId: item.scenarioId } : {}), ...(item.decisionId ? { decisionId: item.decisionId } : {}) }));
  const projection = buildProjectedEntries(drivers, templates.map((template) => ({ id: template.id, itemType: template.itemType as "agreement" | "obligation", direction: template.direction, ...(template.category ? { category: template.category } : {}), debitAccountId: template.debitAccountId, creditAccountId: template.creditAccountId, ...(template.decisionId ? { decisionId: template.decisionId } : {}), ...(template.policyId ? { policyId: template.policyId } : {}) })), { start: start!, end: end! }, scenarioId);
  return NextResponse.json({ horizon: { start, end }, scenarioId: scenarioId ?? null, ...projection });
}
