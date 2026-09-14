import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { approvalEvents, chartAccounts, decisions, evidence, factRecords, policies, postingProposals, getDatabase, sourceRows, sources } from "@finance/database";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireCompanyAccess } from "@/lib/auth";

const line = z.object({ accountId: z.string().uuid(), currency: z.string().regex(/^[A-Z]{3}$/), debitMinor: z.string().regex(/^\d+$/), creditMinor: z.string().regex(/^\d+$/), entityId: z.string().uuid().optional(), externalKey: z.string().min(1).optional(), sourceId: z.string().uuid().optional(), sourceRowId: z.string().uuid().optional(), evidenceId: z.string().uuid().optional(), factId: z.string().uuid().optional(), decisionId: z.string().uuid().optional(), policyId: z.string().uuid().optional(), approvalEventId: z.string().uuid().optional(), sourceLocation: z.string().optional(), memo: z.string().optional() });
const body = z.object({ idempotencyKey: z.string().min(1), label: z.string().min(1), source: z.string().min(1), activity: z.enum(["operating", "transfer", "investment", "financing"]).optional(), postingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), memo: z.string().min(1), entityId: z.string().uuid().optional(), sourceId: z.string().uuid().optional(), sourceRowId: z.string().uuid().optional(), evidenceId: z.string().uuid().optional(), factId: z.string().uuid().optional(), decisionId: z.string().uuid().optional(), policyId: z.string().uuid().optional(), approvalEventId: z.string().uuid().optional(), rationale: z.string().min(1), confidence: z.string().optional(), lines: z.array(line).min(2) });

export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const status = new URL(request.url).searchParams.get("status");
  const proposals = await getDatabase().select().from(postingProposals).where(and(eq(postingProposals.companyId, context.company.id), ...(status ? [eq(postingProposals.status, status as "draft" | "approved" | "rejected" | "posted")] : []))).orderBy(desc(postingProposals.createdAt)).limit(100);
  return NextResponse.json({ proposals });
}

/** Model-derived postings stop here until an explicit approval posts the journal. */
export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid posting proposal", details: parsed.error.flatten() }, { status: 400 });
  const value = parsed.data;
  const db = getDatabase();
  // Provenance and account ids arrive from a model-assisted client, so a draft may never reference another company's records.
  const references = [["source", sources, [value.sourceId, ...value.lines.map((row) => row.sourceId)]], ["source row", sourceRows, [value.sourceRowId, ...value.lines.map((row) => row.sourceRowId)]], ["evidence", evidence, [value.evidenceId, ...value.lines.map((row) => row.evidenceId)]], ["fact", factRecords, [value.factId, ...value.lines.map((row) => row.factId)]], ["decision", decisions, [value.decisionId, ...value.lines.map((row) => row.decisionId)]], ["policy", policies, [value.policyId, ...value.lines.map((row) => row.policyId)]], ["approval event", approvalEvents, [value.approvalEventId, ...value.lines.map((row) => row.approvalEventId)]], ["account", chartAccounts, value.lines.map((row) => row.accountId)]] as const;
  for (const [label, table, candidates] of references) {
    const ids = [...new Set((candidates as readonly (string | undefined)[]).filter((id): id is string => Boolean(id)))];
    if (ids.length && (await db.select({ id: table.id }).from(table).where(and(eq(table.companyId, context.company.id), inArray(table.id, ids)))).length !== ids.length) return NextResponse.json({ error: `Every referenced ${label} must belong to the company.` }, { status: 404 });
  }
  try {
    const [proposal] = await getDatabase().insert(postingProposals).values(JSON.parse(JSON.stringify({ companyId: context.company.id, sourceId: value.sourceId, sourceRowId: value.sourceRowId, evidenceId: value.evidenceId, factId: value.factId, decisionId: value.decisionId, policyId: value.policyId, externalKey: value.idempotencyKey, proposalJson: JSON.stringify(value), rationale: value.rationale, confidence: value.confidence, status: "draft" }))).returning();
    return NextResponse.json({ proposal }, { status: 201 });
  } catch { return NextResponse.json({ error: "A proposal for this source key already exists." }, { status: 409 }); }
}
