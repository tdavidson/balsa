import { auth } from "@/lib/auth";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { cashEvents, getDatabase, postingProposals } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";

const body = z.object({ eventId: z.string().uuid(), cashAccountId: z.string().uuid(), offsetAccountId: z.string().uuid(), rationale: z.string().min(1) });
const toMinor = (amount: string) => {
  const match = amount.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error("Cash-event amount is not a valid positive decimal.");
  return (BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"))).toString();
};

/** Draft a balanced proposal from an approved cash event; account selection remains explicit. */
export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid cash-event proposal", details: parsed.error.flatten() }, { status: 400 });
  const value = parsed.data;
  const [event] = await getDatabase().select().from(cashEvents).where(and(eq(cashEvents.id, value.eventId), eq(cashEvents.companyId, context.company.id))).limit(1);
  if (!event) return NextResponse.json({ error: "Cash event not found" }, { status: 404 });
  try {
    const minor = toMinor(event.amount);
    const cashDebit = event.direction === "receipt";
    const proposal = { idempotencyKey: `cash-event:${event.id}`, label: event.description, source: "cash_event", activity: event.category, postingDate: event.transactionDate ?? `${event.month}-01`, period: event.month, memo: event.description, entityId: event.entityId ?? undefined, sourceId: event.sourceId ?? undefined, sourceRowId: event.sourceRowId ?? undefined, evidenceId: event.evidenceId ?? undefined, factId: event.factId ?? undefined, rationale: value.rationale, confidence: "1.0", lines: [
      { accountId: value.cashAccountId, currency: event.currency ?? context.company.baseCurrency, debitMinor: cashDebit ? minor : "0", creditMinor: cashDebit ? "0" : minor, externalKey: `cash-event:${event.id}:cash`, sourceId: event.sourceId ?? undefined, sourceRowId: event.sourceRowId ?? undefined, evidenceId: event.evidenceId ?? undefined, factId: event.factId ?? undefined, sourceLocation: event.sourceLocation ?? undefined },
      { accountId: value.offsetAccountId, currency: event.currency ?? context.company.baseCurrency, debitMinor: cashDebit ? "0" : minor, creditMinor: cashDebit ? minor : "0", externalKey: `cash-event:${event.id}:offset`, sourceId: event.sourceId ?? undefined, sourceRowId: event.sourceRowId ?? undefined, evidenceId: event.evidenceId ?? undefined, factId: event.factId ?? undefined, sourceLocation: event.sourceLocation ?? undefined },
    ] };
    const [stored] = await getDatabase().insert(postingProposals).values({ companyId: context.company.id, sourceId: event.sourceId, sourceRowId: event.sourceRowId, evidenceId: event.evidenceId, factId: event.factId, sourceLocation: event.sourceLocation, externalKey: proposal.idempotencyKey, proposalJson: JSON.stringify(proposal), rationale: value.rationale, confidence: "1.0", status: "draft" }).returning();
    return NextResponse.json({ proposal: stored }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create cash-event proposal" }, { status: 409 }); }
}
