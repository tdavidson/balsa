import { auth } from "@/lib/auth";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { cashEvents, chartAccounts, getDatabase, journalEntries, journalLines, postingProposals, postingRuleApplications, postingRules, sourceRows } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";

/** Complete deterministic lineage for one normalized source row. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const { id } = await params;
  const db = getDatabase();
  const [row] = await db.select().from(sourceRows).where(and(eq(sourceRows.id, id), eq(sourceRows.companyId, context.company.id))).limit(1);
  if (!row) return NextResponse.json({ error: "Source row not found" }, { status: 404 });
  const [events, applications, proposals, lines] = await Promise.all([
    db.select().from(cashEvents).where(and(eq(cashEvents.companyId, context.company.id), eq(cashEvents.sourceRowId, id))),
    db.select({ application: postingRuleApplications, ruleName: postingRules.name }).from(postingRuleApplications).innerJoin(postingRules, eq(postingRuleApplications.postingRuleId, postingRules.id)).where(and(eq(postingRuleApplications.companyId, context.company.id), eq(postingRuleApplications.sourceRowId, id))),
    db.select().from(postingProposals).where(and(eq(postingProposals.companyId, context.company.id), eq(postingProposals.sourceRowId, id))),
    db.select({ line: journalLines, entryId: journalEntries.id, entryPeriod: journalEntries.period, entryStatus: journalEntries.status, accountCode: chartAccounts.code, accountName: chartAccounts.name, statementLine: chartAccounts.statementLine }).from(journalLines).innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id)).innerJoin(chartAccounts, eq(journalLines.accountId, chartAccounts.id)).where(and(eq(journalLines.companyId, context.company.id), eq(journalLines.sourceRowId, id))),
  ]);
  return NextResponse.json({ sourceRow: { ...row, rawJson: undefined }, cashEvents: events, ruleApplications: applications, proposals: proposals.map((proposal) => ({ ...proposal, proposalJson: undefined })), journalLines: lines });
}
