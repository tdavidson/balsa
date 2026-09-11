import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { economicItems, entities, evidence, getDatabase, knowledgeDocuments } from "@finance/database";
import { categories } from "@nevermodel/finance-engine";
import { requireCompanyAccess } from "@/lib/auth";

/** Economic items (agreements and obligations): the interpreted, CFO-confirmed schedule the engine runs on. */
export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const rows = await getDatabase().select({ item: economicItems, sourceName: evidence.sourceName, counterpartyName: entities.name }).from(economicItems).leftJoin(evidence, eq(economicItems.evidenceId, evidence.id)).leftJoin(entities, eq(economicItems.counterpartyEntityId, entities.id)).where(eq(economicItems.companyId, context.company.id)).orderBy(desc(economicItems.createdAt));
  return NextResponse.json({ items: rows.map(({ item, sourceName, counterpartyName }) => ({ ...item, amount: item.amount ? Number(item.amount) : null, confidence: item.confidence ? Number(item.confidence) : null, sourceName, counterpartyName })) });
}

const patchSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  status: z.enum(["confirmed", "rejected", "draft"]).optional(),
  changes: z.object({
    label: z.string().trim().min(1).optional(),
    amount: z.number().positive().optional(),
    cadence: z.enum(["once", "monthly", "quarterly", "annual"]).optional(),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    effectiveTo: z.string().regex(/^\d{4}-\d{2}$/).nullable().optional(),
    category: z.enum(categories).optional(),
    basis: z.enum(["contractual", "assumed"]).optional(),
    accountingTreatment: z.enum(["cash", "accrual", "prepaid"]).optional(),
  }).optional(),
});

/** Confirm, reject, or correct interpreted items. Confirming is the CFO's act that lets an item into the forecast. */
export async function PATCH(request: Request) {
  await auth.protect();
  const body = patchSchema.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: "Invalid item update" }, { status: 400 });
  const context = await requireCompanyAccess();
  const db = getDatabase();
  const changes = body.data.changes ?? {};
  const rows = await db.update(economicItems).set({
    ...(body.data.status ? { status: body.data.status } : {}),
    ...(changes.label ? { label: changes.label } : {}),
    ...(changes.amount !== undefined ? { amount: String(changes.amount) } : {}),
    ...(changes.cadence ? { cadence: changes.cadence } : {}),
    ...(changes.effectiveFrom ? { effectiveFrom: changes.effectiveFrom } : {}),
    ...(changes.effectiveTo !== undefined ? { effectiveTo: changes.effectiveTo } : {}),
    ...(changes.category ? { category: changes.category } : {}),
    ...(changes.basis ? { basis: changes.basis } : {}),
    ...(changes.accountingTreatment ? { accountingTreatment: changes.accountingTreatment } : {}),
    updatedAt: new Date(),
  }).where(and(eq(economicItems.companyId, context.company.id), inArray(economicItems.id, body.data.ids))).returning();
  if (!rows.length) return NextResponse.json({ error: "Items not found" }, { status: 404 });
  // Confirmed assumptions are the forecast's stated assumptions; keep the knowledge document current.
  const assumed = rows.filter((row) => body.data.status === "confirmed" && row.basis === "assumed");
  if (assumed.length) {
    const [doc] = await db.select({ content: knowledgeDocuments.content }).from(knowledgeDocuments).where(and(eq(knowledgeDocuments.companyId, context.company.id), eq(knowledgeDocuments.slug, "forecast")));
    const lines = assumed.filter((row) => !doc?.content.includes(`item:${row.id}`)).map((row) => `- [item:${row.id}] ${row.label}: ${row.direction === "receipt" ? "+" : "−"}$${Number(row.amount ?? 0).toLocaleString("en-US")} ${row.cadence ?? "once"} from ${row.effectiveFrom ?? "now"}${row.effectiveTo ? ` to ${row.effectiveTo}` : ""}`);
    if (lines.length) {
      const base = doc?.content.trim() ?? "# Forecast\n\nForecast assumptions and scenarios.";
      const content = base.includes("## Assumptions") ? `${base}\n${lines.join("\n")}\n` : `${base}\n\n## Assumptions\n${lines.join("\n")}\n`;
      if (doc) await db.update(knowledgeDocuments).set({ content, updatedAt: new Date() }).where(and(eq(knowledgeDocuments.companyId, context.company.id), eq(knowledgeDocuments.slug, "forecast")));
      else await db.insert(knowledgeDocuments).values({ companyId: context.company.id, slug: "forecast", title: "Forecast", content });
    }
  }
  return NextResponse.json({ items: rows });
}
