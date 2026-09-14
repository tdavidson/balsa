import { auth } from "@/lib/auth";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { postingProposals, postingRuleApplications, getDatabase } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";
import { postApprovedJournal, type JournalPostingRequest } from "@/lib/journal-posting";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const { id } = await params;
  const [proposal] = await getDatabase().select().from(postingProposals).where(and(eq(postingProposals.id, id), eq(postingProposals.companyId, context.company.id))).limit(1);
  if (!proposal) return NextResponse.json({ error: "Posting proposal not found" }, { status: 404 });
  if (proposal.status === "rejected") return NextResponse.json({ error: "Rejected proposals cannot be posted" }, { status: 409 });
  try {
    const posted = await postApprovedJournal(context.company.id, JSON.parse(proposal.proposalJson) as JournalPostingRequest);
    await getDatabase().update(postingProposals).set({ status: "posted", journalEntryId: posted.entryId, approvedAt: new Date(), updatedAt: new Date() }).where(and(eq(postingProposals.id, proposal.id), eq(postingProposals.companyId, context.company.id)));
    await getDatabase().update(postingRuleApplications).set({ outcome: "posted", updatedAt: new Date() }).where(and(eq(postingRuleApplications.companyId, context.company.id), eq(postingRuleApplications.postingProposalId, proposal.id)));
    return NextResponse.json(posted);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Proposal approval failed" }, { status: 409 }); }
}
