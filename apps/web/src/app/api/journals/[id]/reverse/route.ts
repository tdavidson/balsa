import { auth } from "@/lib/auth";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDatabase, journalEntries, journalLines } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";
import { postApprovedJournal } from "@/lib/journal-posting";

const body = z.object({ postingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), memo: z.string().min(1) });

/** Corrections are new reversing postings; historical posted entries remain immutable. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid reversal", details: parsed.error.flatten() }, { status: 400 });
  const { id } = await params;
  const [entry] = await getDatabase().select().from(journalEntries).where(and(eq(journalEntries.id, id), eq(journalEntries.companyId, context.company.id), eq(journalEntries.status, "posted"))).limit(1);
  if (!entry) return NextResponse.json({ error: "Posted journal entry not found" }, { status: 404 });
  const lines = await getDatabase().select().from(journalLines).where(eq(journalLines.entryId, entry.id));
  if (!lines.length) return NextResponse.json({ error: "Journal entry has no lines" }, { status: 409 });
  try {
    const result = await postApprovedJournal(context.company.id, { idempotencyKey: `reversal:${entry.id}:${parsed.data.period}`, label: `Reversal of ${entry.memo}`, source: "journal_reversal", postingDate: parsed.data.postingDate, period: parsed.data.period, memo: parsed.data.memo, ...(entry.entityId ? { entityId: entry.entityId } : {}), lines: lines.map((line) => ({ accountId: line.accountId, ...(line.entityId ? { entityId: line.entityId } : {}), currency: line.currency, debitMinor: line.creditMinor, creditMinor: line.debitMinor, externalKey: `reversal:${line.id}`, ...(line.sourceId ? { sourceId: line.sourceId } : {}), ...(line.evidenceId ? { evidenceId: line.evidenceId } : {}), ...(line.factId ? { factId: line.factId } : {}), ...(line.decisionId ? { decisionId: line.decisionId } : {}), ...(line.policyId ? { policyId: line.policyId } : {}), ...(line.approvalEventId ? { approvalEventId: line.approvalEventId } : {}), ...(line.sourceLocation ? { sourceLocation: line.sourceLocation } : {}), memo: `Reversal: ${line.memo ?? entry.memo}` })) });
    return NextResponse.json({ reversalOfEntryId: entry.id, ...result });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Journal reversal failed" }, { status: 409 }); }
}
