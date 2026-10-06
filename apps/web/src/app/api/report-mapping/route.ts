import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { chartAccounts, getDatabase, recordAudit, reportCategories } from "@finance/database";
import { accountStatementSection, isStandardLineId, lineAcceptsAccount, standardLines, suggestStandardLine } from "@balsa/finance-engine";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { loadStandardMapping, toStandardMappingAccount } from "@/lib/standard-statements";

const withArticle = (word: string) => `${/^[aeiou]/.test(word) ? "an" : "a"} ${word}`;

async function payload(companyId: string) {
  const mapping = await loadStandardMapping(companyId);
  return {
    companyId,
    lines: standardLines.map((line) => ({ id: line.id, label: line.label, section: line.section, ...("timing" in line ? { timing: line.timing } : {}), fallback: "fallback" in line && line.fallback === true })),
    categories: mapping.categories,
    accounts: mapping.rows.map((row) => {
      const account = mapping.accounts.find((item) => item.accountId === row.id)!;
      const resolved = mapping.resolved.get(row.id)!;
      const suggestion = suggestStandardLine(account);
      return { id: row.id, code: row.code, name: row.name, accountType: row.accountType, section: accountStatementSection(account), active: row.active === "Y", inUse: mapping.inUseIds.has(row.id), reportLine: account.reportLine ?? null, reportCategoryId: row.reportCategoryId, resolved, suggestion };
    }),
    summary: mapping.summary,
  };
}

export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  return NextResponse.json(await payload(context.company.id));
}

const change = z.object({ accountId: z.string().uuid(), line: z.string().nullable(), categoryId: z.string().uuid().nullable().optional() });
const body = z.object({ changes: z.array(change).min(1).max(1000) });

/**
 * Confirm, change, or clear accounts' Standard lines and categories. Presentation
 * only: no journal, balance or ledger statement changes, so accounts with posted
 * lines can be remapped at any time. One audit entry records every change.
 */
export async function PATCH(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid mapping change", details: parsed.error.flatten() }, { status: 400 });
  const { changes } = parsed.data;
  if (new Set(changes.map((item) => item.accountId)).size !== changes.length) return NextResponse.json({ error: "Each account may appear once per change." }, { status: 400 });
  const db = getDatabase();
  const [rows, categoryRows] = await Promise.all([
    db.select().from(chartAccounts).where(and(eq(chartAccounts.companyId, context.company.id), inArray(chartAccounts.id, changes.map((item) => item.accountId)))),
    db.select().from(reportCategories).where(eq(reportCategories.companyId, context.company.id)),
  ]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const categoryById = new Map(categoryRows.map((row) => [row.id, row]));
  for (const item of changes) {
    const row = byId.get(item.accountId);
    if (!row) return NextResponse.json({ error: "Chart account not found" }, { status: 404 });
    if (item.line === null) { if (item.categoryId) return NextResponse.json({ error: `${row.code} needs a line before it can take a category.` }, { status: 400 }); continue; }
    if (!isStandardLineId(item.line)) return NextResponse.json({ error: `Unknown statement line: ${item.line}` }, { status: 400 });
    if (!lineAcceptsAccount(item.line, toStandardMappingAccount(row))) return NextResponse.json({ error: `${row.code} ${row.name} is ${withArticle(accountStatementSection(toStandardMappingAccount(row)) ?? "unclassified")} account and cannot be placed on ${standardLines.find((line) => line.id === item.line)!.label}.` }, { status: 400 });
    if (item.categoryId) {
      const category = categoryById.get(item.categoryId);
      if (!category) return NextResponse.json({ error: "Category not found" }, { status: 404 });
      if (category.line !== item.line) return NextResponse.json({ error: `${category.name} belongs to a different line.` }, { status: 400 });
    }
  }
  const before = changes.map((item) => { const row = byId.get(item.accountId)!; return { accountId: row.id, code: row.code, line: row.reportLine, categoryId: row.reportCategoryId }; });
  const after = changes.map((item) => ({ accountId: item.accountId, code: byId.get(item.accountId)!.code, line: item.line, categoryId: item.line === null ? null : item.categoryId === undefined ? (byId.get(item.accountId)!.reportLine === item.line ? byId.get(item.accountId)!.reportCategoryId : null) : item.categoryId }));
  await db.transaction(async (tx) => {
    for (const item of after) await tx.update(chartAccounts).set({ reportLine: item.line, reportCategoryId: item.categoryId, updatedAt: new Date() }).where(and(eq(chartAccounts.companyId, context.company.id), eq(chartAccounts.id, item.accountId)));
    await recordAudit(tx, { companyId: context.company.id, actorUserId: context.user.id, via: "ui", action: "report_mapping.changed", entityType: "chart_account", ...(changes.length === 1 ? { entityId: changes[0]!.accountId } : {}), summary: changes.length === 1 ? `Mapped ${before[0]!.code} to ${after[0]!.line ? standardLines.find((line) => line.id === after[0]!.line)!.label : "its suggested line"}` : `Updated the statement mapping for ${changes.length} accounts`, before, after });
  });
  return NextResponse.json(await payload(context.company.id));
}
