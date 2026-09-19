import { auth } from "@/lib/auth";
import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { economicItems, entities, evidence, getDatabase, knowledgeDocuments } from "@finance/database";
import { categories } from "@nevermodel/finance-engine";
import { requireCompanyAccess } from "@/lib/auth";
import { refreshCurrentCalculationRun } from "@/lib/refresh-calculation-run";
import { commitModelWrite, modelErrorResponse } from "@/lib/forecast-model-http";
import { confirmItemsWith, setItemFormulaWith } from "@/lib/forecast-model-store";

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
    amountFormula: z.string().trim().max(2000).nullable().optional(),
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
  // A formula is checked against the final model; "" clears it like null.
  const formula = changes.amountFormula === undefined ? undefined : changes.amountFormula || null;
  if (body.data.status === "confirmed") {
    if (formula !== undefined && body.data.ids.length !== 1) return NextResponse.json({ error: "Set a formula on one item at a time" }, { status: 400 });
    try {
      const committed = await commitModelWrite(context.company.id, { kind: "item_confirmed", subjectType: "economic_item", actorUserId: context.user.id, via: "ui", ...(body.data.ids.length > 1 ? { subjectIds: body.data.ids } : {}) }, async (tx) => {
        const rows = await confirmItemsWith(tx, context.company.id, body.data.ids, {
          ...(changes.label !== undefined ? { label: changes.label } : {}),
          ...(changes.amount !== undefined ? { amount: changes.amount } : {}),
          ...(formula !== undefined ? { amountFormula: formula } : {}),
          ...(changes.cadence !== undefined ? { cadence: changes.cadence } : {}),
          ...(changes.effectiveFrom !== undefined ? { effectiveFrom: changes.effectiveFrom } : {}),
          ...(changes.effectiveTo !== undefined ? { effectiveTo: changes.effectiveTo } : {}),
          ...(changes.category !== undefined ? { category: changes.category } : {}),
          ...(changes.basis !== undefined ? { basis: changes.basis } : {}),
          ...(changes.accountingTreatment !== undefined ? { accountingTreatment: changes.accountingTreatment } : {}),
        });
        const assumed = rows.filter((row) => row.basis === "assumed");
        if (assumed.length) {
          const [doc] = await tx.select({ content: knowledgeDocuments.content }).from(knowledgeDocuments).where(and(eq(knowledgeDocuments.companyId, context.company.id), eq(knowledgeDocuments.slug, "forecast")));
          const lines = assumed.filter((row) => !doc?.content.includes(`item:${row.id}`)).map((row) => `- [item:${row.id}] ${row.label}: ${row.direction === "receipt" ? "+" : "−"}$${Number(row.amount ?? 0).toLocaleString("en-US")} ${row.cadence ?? "once"} from ${row.effectiveFrom ?? "now"}${row.effectiveTo ? ` to ${row.effectiveTo}` : ""}`);
          if (lines.length) {
            const base = doc?.content.trim() ?? "# Forecast\n\nForecast assumptions and scenarios.";
            const content = base.includes("## Assumptions") ? `${base}\n${lines.join("\n")}\n` : `${base}\n\n## Assumptions\n${lines.join("\n")}\n`;
            if (doc) await tx.update(knowledgeDocuments).set({ content, updatedAt: new Date() }).where(and(eq(knowledgeDocuments.companyId, context.company.id), eq(knowledgeDocuments.slug, "forecast")));
            else await tx.insert(knowledgeDocuments).values({ companyId: context.company.id, slug: "forecast", title: "Forecast", content });
          }
        }
        return { value: rows, subjectId: rows.length === 1 ? rows[0]!.id : null };
      });
      return NextResponse.json({ items: committed.value, calculationRun: committed.calculationRun });
    } catch (error) { return modelErrorResponse(error); }
  }
  if (formula !== undefined) {
    if (body.data.ids.length !== 1) return NextResponse.json({ error: "Set a formula on one item at a time" }, { status: 400 });
    if (body.data.status !== undefined || Object.keys(changes).some((key) => key !== "amountFormula")) return NextResponse.json({ error: "Set a formula separately from other item changes" }, { status: 400 });
    try {
      const committed = await commitModelWrite(context.company.id, { kind: "item_formula_changed", subjectType: "economic_item", actorUserId: context.user.id, via: "ui" }, async (tx) => {
        const row = await setItemFormulaWith(tx, context.company.id, body.data.ids[0]!, formula);
        return { value: row, subjectId: row.id };
      });
      return NextResponse.json({ item: committed.value, calculationRun: committed.calculationRun });
    } catch (error) { return modelErrorResponse(error); }
  }
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
  const calculationRun = await refreshCurrentCalculationRun(context.company.id, { cause: { kind: body.data.status === "rejected" ? "item_rejected" : "item_edited", subjectType: "economic_item", subjectId: rows.length === 1 ? rows[0]!.id : null, actorUserId: context.user.id, via: "ui", ...(rows.length > 1 ? { subjectIds: rows.map((row) => row.id) } : {}) } });
  return NextResponse.json({ items: rows, calculationRun });
}
