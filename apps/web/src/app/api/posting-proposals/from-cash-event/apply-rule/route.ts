import { auth } from "@/lib/auth";
import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { cashEvents, getDatabase, postingProposals, postingRuleApplications, postingRules } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";
import { matchPostingRules } from "@/lib/posting-rule-matching";

const body = z.object({ eventId: z.string().uuid() });
const toMinor = (amount: string) => {
  const match = amount.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error("Cash-event amount is not a valid positive decimal.");
  return (BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"))).toString();
};

/** Apply exactly one approved company rule; ambiguity stays visible for CFO review. */
export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid cash-event rule request" }, { status: 400 });
  const [event] = await getDatabase().select().from(cashEvents).where(and(eq(cashEvents.id, parsed.data.eventId), eq(cashEvents.companyId, context.company.id))).limit(1);
  if (!event) return NextResponse.json({ error: "Cash event not found" }, { status: 404 });
  const rules = await getDatabase().select().from(postingRules).where(and(eq(postingRules.companyId, context.company.id), eq(postingRules.active, "Y"))).orderBy(asc(postingRules.priority));
  const match = matchPostingRules(event, rules);
  if (match.status === "unmatched") return NextResponse.json({ status: "unmatched", error: "No approved posting rule matched this cash event." }, { status: 409 });
  if (match.status === "ambiguous") return NextResponse.json({ status: "ambiguous", ruleIds: match.rules.map((rule) => rule.id), error: "More than one approved posting rule matched this cash event." }, { status: 409 });
  const rule = match.rule;
  try {
    const minor = toMinor(event.amount); const cashDebit = event.direction === "receipt";
    const entityId = rule.entityId ?? event.entityId;
    const provenance = { ...(event.sourceId ? { sourceId: event.sourceId } : {}), ...(event.sourceRowId ? { sourceRowId: event.sourceRowId } : {}), ...(event.evidenceId ? { evidenceId: event.evidenceId } : {}), ...(event.factId ? { factId: event.factId } : {}), ...(rule.policyId ? { policyId: rule.policyId } : {}), ...(rule.decisionId ? { decisionId: rule.decisionId } : {}), ...(event.sourceLocation ? { sourceLocation: event.sourceLocation } : {}) };
    const proposal = { idempotencyKey: `cash-event:${event.id}`, label: event.description, source: "posting_rule", activity: event.category, postingDate: event.transactionDate ?? `${event.month}-01`, period: event.month, memo: event.description, ...(entityId ? { entityId } : {}), ...provenance, rationale: `Approved posting rule: ${rule.name}`, confidence: "1.0", lines: [{ accountId: rule.cashAccountId, currency: event.currency ?? context.company.baseCurrency, debitMinor: cashDebit ? minor : "0", creditMinor: cashDebit ? "0" : minor, externalKey: `cash-event:${event.id}:cash`, ...provenance }, { accountId: rule.offsetAccountId, currency: event.currency ?? context.company.baseCurrency, debitMinor: cashDebit ? "0" : minor, creditMinor: cashDebit ? minor : "0", externalKey: `cash-event:${event.id}:offset`, ...provenance }] };
    const [stored] = await getDatabase().insert(postingProposals).values({ companyId: context.company.id, sourceId: event.sourceId, sourceRowId: event.sourceRowId, evidenceId: event.evidenceId, factId: event.factId, decisionId: rule.decisionId, policyId: rule.policyId, sourceLocation: event.sourceLocation, externalKey: proposal.idempotencyKey, proposalJson: JSON.stringify(proposal), rationale: proposal.rationale, confidence: "1.0", status: "draft" }).returning();
    if (event.sourceRowId && stored) await getDatabase().insert(postingRuleApplications).values({ companyId: context.company.id, sourceRowId: event.sourceRowId, postingRuleId: rule.id, postingProposalId: stored.id, ruleSnapshot: JSON.stringify(rule), outcome: "drafted" }).onConflictDoNothing({ target: [postingRuleApplications.sourceRowId, postingRuleApplications.postingRuleId] });
    return NextResponse.json({ status: "matched", ruleId: rule.id, proposal: stored }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create posting proposal" }, { status: 409 }); }
}
