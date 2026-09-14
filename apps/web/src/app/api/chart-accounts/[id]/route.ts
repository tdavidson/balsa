import { auth } from "@/lib/auth";
import { and, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { chartAccounts, getDatabase, journalLines, postingRules, sourceRowMappings } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";

const account = z.object({
  code: z.string().trim().min(1).max(32), name: z.string().trim().min(1).max(160),
  accountType: z.enum(["asset", "liability", "equity", "revenue", "expense", "contra"]), normalBalance: z.enum(["debit", "credit"]),
  statementSection: z.enum(["asset", "liability", "equity", "revenue", "expense"]).optional(), statementLine: z.string().trim().min(1).max(80).optional(), balanceTiming: z.enum(["current", "noncurrent"]).optional(), bankAccountIdentifier: z.string().trim().min(1).max(160).optional(),
  cashFlowCategory: z.enum(["operating", "investing", "financing", "none"]).optional(), workingCapitalCategory: z.enum(["receivables", "payables", "deferred_revenue", "prepaids", "inventory", "other"]).optional(), fxMonetary: z.enum(["Y", "N"]).optional(), activeFrom: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(), activeTo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(), active: z.enum(["Y", "N"]),
});

async function referenced(companyId: string, accountId: string) {
  const db = getDatabase();
  const [lines, rules, mappings] = await Promise.all([
    db.select({ id: journalLines.id }).from(journalLines).where(and(eq(journalLines.companyId, companyId), eq(journalLines.accountId, accountId))).limit(1),
    db.select({ id: postingRules.id }).from(postingRules).where(and(eq(postingRules.companyId, companyId), or(eq(postingRules.cashAccountId, accountId), eq(postingRules.offsetAccountId, accountId)))).limit(1),
    db.select({ id: sourceRowMappings.id }).from(sourceRowMappings).where(and(eq(sourceRowMappings.companyId, companyId), or(eq(sourceRowMappings.chartAccountId, accountId), eq(sourceRowMappings.offsetAccountId, accountId)))).limit(1),
  ]);
  return { journal: Boolean(lines[0]), rules: Boolean(rules[0]), mappings: Boolean(mappings[0]) };
}

async function findAccount(companyId: string, id: string) {
  return (await getDatabase().select().from(chartAccounts).where(and(eq(chartAccounts.companyId, companyId), eq(chartAccounts.id, id))).limit(1))[0] ?? null;
}

/** Update an unused account, or deactivate any account without losing historical references. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = account.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid chart account", details: parsed.error.flatten() }, { status: 400 });
  const existing = await findAccount(context.company.id, (await params).id);
  if (!existing) return NextResponse.json({ error: "Chart account not found" }, { status: 404 });
  const value = parsed.data;
  if (value.accountType === "contra" && !value.statementSection) return NextResponse.json({ error: "A contra account requires the statement section it offsets." }, { status: 400 });
  if (value.balanceTiming && !["asset", "liability"].includes(value.statementSection ?? value.accountType)) return NextResponse.json({ error: "Current/non-current classification applies only to asset and liability accounts." }, { status: 400 });
  if (value.bankAccountIdentifier && !["asset"].includes(value.statementSection ?? value.accountType)) return NextResponse.json({ error: "A bank account identifier may be assigned only to a cash asset account." }, { status: 400 });
  if (value.fxMonetary === "Y" && !["asset", "liability"].includes(value.statementSection ?? value.accountType)) return NextResponse.json({ error: "Only asset and liability accounts may be marked monetary for FX remeasurement." }, { status: 400 });
  const references = await referenced(context.company.id, existing.id);
  if (references.journal && value.active === "Y" && (value.code !== existing.code || value.accountType !== existing.accountType || value.normalBalance !== existing.normalBalance || value.statementSection !== existing.statementSection || value.statementLine !== existing.statementLine || value.balanceTiming !== existing.balanceTiming || value.bankAccountIdentifier !== existing.bankAccountIdentifier || value.cashFlowCategory !== existing.cashFlowCategory || value.fxMonetary !== existing.fxMonetary)) {
    return NextResponse.json({ error: "This account has posted journal lines. Deactivate it and create a successor account instead; changing its accounting treatment would rewrite historical presentation." }, { status: 409 });
  }
  try {
    const [updated] = await getDatabase().update(chartAccounts).set({ ...value, updatedAt: new Date() }).where(and(eq(chartAccounts.companyId, context.company.id), eq(chartAccounts.id, existing.id))).returning();
    return NextResponse.json({ account: updated, references });
  } catch { return NextResponse.json({ error: "An account with that code already exists." }, { status: 409 }); }
}

/** Delete only an unreferenced account. Historical accounting accounts are deactivated, never erased. */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const existing = await findAccount(context.company.id, (await params).id);
  if (!existing) return NextResponse.json({ error: "Chart account not found" }, { status: 404 });
  const references = await referenced(context.company.id, existing.id);
  if (references.journal || references.rules || references.mappings) {
    const [deactivated] = await getDatabase().update(chartAccounts).set({ active: "N", updatedAt: new Date() }).where(and(eq(chartAccounts.companyId, context.company.id), eq(chartAccounts.id, existing.id))).returning();
    return NextResponse.json({ account: deactivated, deleted: false, deactivated: true, references });
  }
  await getDatabase().delete(chartAccounts).where(and(eq(chartAccounts.companyId, context.company.id), eq(chartAccounts.id, existing.id)));
  return NextResponse.json({ deleted: true, deactivated: false, references });
}
