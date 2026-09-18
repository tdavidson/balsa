import { auth } from "@/lib/auth";
import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { chartAccounts, getDatabase, journalBatches, journalEntries, journalLines } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";
import { postApprovedJournal, type JournalPostingRequest } from "@/lib/journal-posting";

const line = z.object({ accountId: z.string().uuid(), entityId: z.string().uuid().optional(), currency: z.string().regex(/^[A-Z]{3}$/), debitMinor: z.string().regex(/^\d+$/), creditMinor: z.string().regex(/^\d+$/), transactionCurrency: z.string().regex(/^[A-Z]{3}$/).optional(), transactionDebitMinor: z.string().regex(/^\d+$/).optional(), transactionCreditMinor: z.string().regex(/^\d+$/).optional(), fxRateId: z.string().uuid().optional(), externalKey: z.string().min(1).optional(), sourceId: z.string().uuid().optional(), sourceRowId: z.string().uuid().optional(), evidenceId: z.string().uuid().optional(), factId: z.string().uuid().optional(), decisionId: z.string().uuid().optional(), policyId: z.string().uuid().optional(), approvalEventId: z.string().uuid().optional(), sourceLocation: z.string().optional(), memo: z.string().optional() });
const body = z.object({ idempotencyKey: z.string().min(1), label: z.string().min(1), source: z.string().min(1), activity: z.enum(["operating", "transfer", "investment", "financing"]).optional(), postingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), memo: z.string().min(1), basis: z.enum(["actual", "forecast", "scenario", "plan", "adjustment", "elimination"]).optional(), scenarioId: z.string().uuid().optional(), reversalOfEntryId: z.string().uuid().optional(), entityId: z.string().uuid().optional(), sourceId: z.string().uuid().optional(), sourceRowId: z.string().uuid().optional(), evidenceId: z.string().uuid().optional(), factId: z.string().uuid().optional(), decisionId: z.string().uuid().optional(), policyId: z.string().uuid().optional(), approvalEventId: z.string().uuid().optional(), lines: z.array(line).min(2) });

/** Read-only posted journal register for the Accounting workspace. */
export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const period = new URL(request.url).searchParams.get("period");
  if (period && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return NextResponse.json({ error: "period must be YYYY-MM" }, { status: 400 });
  const db = getDatabase();
  const entries = await db.select({ id: journalEntries.id, period: journalEntries.period, postingDate: journalEntries.postingDate, memo: journalEntries.memo, batchLabel: journalBatches.label, source: journalBatches.source, postedAt: journalEntries.postedAt }).from(journalEntries).innerJoin(journalBatches, eq(journalEntries.batchId, journalBatches.id)).where(and(eq(journalEntries.companyId, context.company.id), eq(journalEntries.status, "posted"), ...(period ? [eq(journalEntries.period, period)] : []))).orderBy(desc(journalEntries.postingDate)).limit(100);
  const entryIds = entries.map((entry) => entry.id);
  const lines = entryIds.length ? await db.select({ id: journalLines.id, entryId: journalLines.entryId, accountCode: chartAccounts.code, accountName: chartAccounts.name, currency: journalLines.currency, debitMinor: journalLines.debitMinor, creditMinor: journalLines.creditMinor, transactionCurrency: journalLines.transactionCurrency, transactionDebitMinor: journalLines.transactionDebitMinor, transactionCreditMinor: journalLines.transactionCreditMinor, fxRateId: journalLines.fxRateId, sourceRowId: journalLines.sourceRowId }).from(journalLines).innerJoin(chartAccounts, eq(journalLines.accountId, chartAccounts.id)).where(and(eq(journalLines.companyId, context.company.id), inArray(journalLines.entryId, entryIds))).orderBy(chartAccounts.code) : [];
  return NextResponse.json({ entries: entries.map((entry) => ({ ...entry, lines: lines.filter((line) => line.entryId === entry.id) })) });
}

export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid journal posting", details: parsed.error.flatten() }, { status: 400 });
  try {
    // JSON request parsing represents omitted optional fields as `undefined`;
    // remove them before entering the exact optional-type posting boundary.
    const posting = JSON.parse(JSON.stringify(parsed.data)) as JournalPostingRequest;
    return NextResponse.json(await postApprovedJournal(context.company.id, { ...posting, actorUserId: context.user.id }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Journal posting failed" }, { status: 409 });
  }
}
