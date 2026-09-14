import { auth } from "@/lib/auth";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { cashEvents, decisions, evidence, getDatabase, ingestionRuns, knowledgeDocuments, policies, sources } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";
import { previewPolicyImpact } from "@/lib/policy-impact";
import { classifyWithCompanyPolicy } from "@/lib/company-policy-engine";

const policySchema = z.object({
  action: z.enum(["preview", "apply"]),
  name: z.string().trim().min(3).max(255),
  rule: z.string().trim().min(8).max(20_000),
  scope: z.string().trim().min(1).max(255).default("company"),
  effectiveFrom: z.string().datetime().optional(),
  confidence: z.number().min(0).max(1).default(1),
});

async function eventsForPolicy(companyId: string) {
  const rows = await getDatabase().select({ id: cashEvents.id, sourceId: cashEvents.sourceId, month: cashEvents.month, description: cashEvents.description, amount: cashEvents.amount, direction: cashEvents.direction, category: cashEvents.category, policyId: cashEvents.policyId, sourceName: evidence.sourceName, accountIdentifier: evidence.accountIdentifier, sourceMetadata: sources.metadata }).from(cashEvents).leftJoin(evidence, eq(cashEvents.evidenceId, evidence.id)).leftJoin(sources, eq(cashEvents.sourceId, sources.id)).where(eq(cashEvents.companyId, companyId));
  return rows.map(({ sourceMetadata, ...row }) => {
    try { return { ...row, sourceKind: (JSON.parse(sourceMetadata ?? "{}") as { classification?: { kind?: string } }).classification?.kind ?? null }; } catch { return { ...row, sourceKind: null }; }
  });
}

export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = policySchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "A policy name, explicit match-and-classify rule, scope, and confidence are required." }, { status: 400 });
  const data = parsed.data;
  const draft = { id: "preview", name: data.name, rule: data.rule, scope: data.scope, ...(data.effectiveFrom ? { effectiveFrom: data.effectiveFrom } : {}) };
  const before = previewPolicyImpact(await eventsForPolicy(context.company.id), draft, data.effectiveFrom);
  if (!before.executable) return NextResponse.json({ error: "Use an explicit rule such as: Classify descriptions containing \"Automatic Investment\" as transfer." }, { status: 422 });
  if (data.action === "preview") return NextResponse.json({ impact: before });

  const db = getDatabase();
  const [decision] = await db.insert(decisions).values({ companyId: context.company.id, question: `Standing policy: ${data.name}`, answer: data.rule }).returning();
  // A blank effective date means the CFO reviewed the rule against all loaded
  // history. Store that explicitly so the preview and the applied result agree.
  const [policy] = await db.insert(policies).values({ companyId: context.company.id, decisionId: decision!.id, name: data.name, rule: data.rule, scope: data.scope, effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom) : new Date("1970-01-01T00:00:00.000Z"), confidence: String(data.confidence) }).returning();
  const allEvents = await eventsForPolicy(context.company.id);
  const impact = previewPolicyImpact(allEvents, { id: policy!.id, name: policy!.name, rule: policy!.rule, scope: policy!.scope, effectiveFrom: policy!.effectiveFrom }, policy!.effectiveFrom.toISOString());
  const matchedEvents = allEvents.flatMap((event) => {
    if (!impact.affectedEventIds.includes(event.id)) return [];
    const classification = classifyWithCompanyPolicy(event.description, [policy!], { effectiveDate: `${event.month}-01`, ...(event.sourceName !== undefined ? { sourceName: event.sourceName } : {}), ...(event.sourceKind ? { sourceKind: event.sourceKind } : {}), ...(event.accountIdentifier !== undefined ? { accountIdentifier: event.accountIdentifier } : {}) });
    return classification ? [{ event, classification }] : [];
  });
  if (matchedEvents.length) await Promise.all(matchedEvents.map(({ event, classification }) => db.update(cashEvents).set({ category: classification.category, policyId: policy!.id, updatedAt: new Date() }).where(and(eq(cashEvents.id, event.id), eq(cashEvents.companyId, context.company.id)))));
  const sourceIds = [...new Set(matchedEvents.flatMap(({ event }) => event.sourceId ? [event.sourceId] : []))];
  if (sourceIds.length) await db.insert(ingestionRuns).values(sourceIds.map((sourceId) => ({ companyId: context.company.id, sourceId, stage: "reconciliation", status: "waiting", metadata: JSON.stringify({ trigger: "policy", policyId: policy!.id, policyName: policy!.name }) })));
  const [document] = await db.select({ content: knowledgeDocuments.content }).from(knowledgeDocuments).where(and(eq(knowledgeDocuments.companyId, context.company.id), eq(knowledgeDocuments.slug, "policies")));
  const addition = `- [decision:${decision!.id}] ${data.name}: ${data.rule}`;
  if (document && !document.content.includes(`decision:${decision!.id}`)) await db.update(knowledgeDocuments).set({ content: `${document.content.trim()}\n\n## Active policies\n${addition}\n`, updatedAt: new Date() }).where(and(eq(knowledgeDocuments.companyId, context.company.id), eq(knowledgeDocuments.slug, "policies")));
  return NextResponse.json({ policy, impact });
}
