import { auth } from "@/lib/auth";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDatabase, journalEntries, journalLines } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";
import { journalReversalRequest } from "@/lib/journal-reversal-request";
import { postApprovedJournal } from "@/lib/journal-posting";

const body = z.object({ postingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), memo: z.string().min(1) });

/** Corrections are new reversing postings; historical posted entries remain immutable. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid reversal", details: parsed.error.flatten() }, { status: 400 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid journal entry ID" }, { status: 400 });
  const [entry] = await getDatabase().select().from(journalEntries).where(and(eq(journalEntries.id, id), eq(journalEntries.companyId, context.company.id), eq(journalEntries.status, "posted"))).limit(1);
  if (!entry) return NextResponse.json({ error: "Posted journal entry not found" }, { status: 404 });
  const lines = await getDatabase().select().from(journalLines).where(and(eq(journalLines.companyId, context.company.id), eq(journalLines.entryId, entry.id)));
  if (!lines.length) return NextResponse.json({ error: "Journal entry has no lines" }, { status: 409 });
  try {
    const result = await postApprovedJournal(context.company.id, journalReversalRequest(entry, lines, parsed.data, context.user.id));
    return NextResponse.json({ reversalOfEntryId: entry.id, ...result });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Journal reversal failed" }, { status: 409 }); }
}
