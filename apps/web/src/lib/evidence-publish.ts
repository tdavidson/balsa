import { and, eq, inArray, isNull } from "drizzle-orm";
import type { ApplicationContext } from "@finance/auth";
import { cashEvents, economicItems, evidence, factRecords, getDatabase, ingestionRuns, policies, reportingPeriods, reviewItems, sourceRows, sources } from "@finance/database";
import type { SourceKind } from "@balsa/ingestion";
import { applyApprovedEvidence } from "./apply-evidence";
import { recordReviewedKnowledge } from "./company-knowledge";
import { buildEvidencePublication } from "./evidence-publication";
import { refreshCurrentCalculationRun } from "./refresh-calculation-run";

const sourceProvesCash = (kind: SourceKind | undefined) => ["bank_statement", "brokerage_statement", "quickbooks_transactions"].includes(kind ?? "");

type DocumentRow = { id: string; sourceId: string | null; identityStatus: string; status: string; currency: string | null; reportingMonth: string | null; extractedJson: string | null; sourceMetadata: string | null };

export type PublishOutcome =
  /** The document is not confirmed, or some fact still awaits a treatment approval. */
  | { kind: "not_ready"; document: DocumentRow | undefined }
  | { kind: "blocked"; blocked: { label: string; reason: string }[] }
  | { kind: "closed_month"; month: string }
  | { kind: "conflict"; error: string }
  | { kind: "published"; document: DocumentRow; interpretation: { error: string } | { items: unknown; transactions: unknown; balances: unknown; questions: unknown }; calculationRun: Awaited<ReturnType<typeof refreshCurrentCalculationRun>> };

/**
 * Publish a confirmed document once every fact carries an approved treatment.
 * Staged import rows become actuals, derived rows from any earlier publication
 * are cleared, and the source is marked published. The typed Company State is
 * then produced by interpretation, whose items stay drafts until confirmed.
 */
export async function publishEvidenceIfComplete(context: ApplicationContext, evidenceId: string, actorUserId: string): Promise<PublishOutcome> {
  const db = getDatabase();
  const companyId = context.company.id;
  const [document] = await db.select({ id: evidence.id, sourceId: evidence.sourceId, identityStatus: evidence.identityStatus, status: evidence.status, currency: evidence.currency, reportingMonth: evidence.reportingMonth, extractedJson: evidence.extractedJson, sourceMetadata: sources.metadata }).from(evidence).leftJoin(sources, eq(evidence.sourceId, sources.id)).where(and(eq(evidence.id, evidenceId), eq(evidence.companyId, companyId)));
  if (!document || document.identityStatus !== "approved" || !document.extractedJson) return { kind: "not_ready", document };
  const approvedFacts = await db.select({ status: factRecords.status, label: factRecords.label, value: factRecords.value, accountingRole: factRecords.accountingRole }).from(factRecords).where(and(eq(factRecords.companyId, companyId), eq(factRecords.evidenceId, evidenceId)));
  if (!approvedFacts.length || !approvedFacts.every((fact) => fact.status === "treatment_approved")) return { kind: "not_ready", document };

  let sourceKind: SourceKind | undefined;
  let sourceRole: "reference_model" | undefined;
  try {
    const metadata = JSON.parse(document.sourceMetadata ?? "{}") as { sourceRole?: string; classification?: { kind?: SourceKind } };
    sourceKind = metadata.classification?.kind;
    sourceRole = metadata.sourceRole === "reference_model" ? "reference_model" : undefined;
  } catch { /* unknown sources cannot prove cash */ }
  const policyRows = await db.select({ id: policies.id, name: policies.name, rule: policies.rule, scope: policies.scope, effectiveFrom: policies.effectiveFrom }).from(policies).where(and(eq(policies.companyId, companyId), eq(policies.active, "Y")));
  const publication = buildEvidencePublication({ facts: approvedFacts, ...(sourceKind ? { sourceKind } : {}), ...(sourceRole ? { sourceRole } : {}), reportingMonth: document.reportingMonth, currency: document.currency, policies: policyRows });
  if (publication.blocked.length) {
    const existingBlocks = await db.select({ reviewKey: reviewItems.reviewKey }).from(reviewItems).where(and(eq(reviewItems.companyId, companyId), eq(reviewItems.evidenceId, evidenceId)));
    const keys = new Set(existingBlocks.map((item) => item.reviewKey));
    const blocks = publication.blocked.map((item) => ({ reviewKey: `publication:${evidenceId}:${item.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80)}`, question: `${item.label} cannot be published: ${item.reason}` })).filter((item) => !keys.has(item.reviewKey));
    if (blocks.length) await db.insert(reviewItems).values(blocks.map((item) => ({ companyId, evidenceId, ...item, status: "open" })));
    return { kind: "blocked", blocked: publication.blocked };
  }
  const eventMonths = [...new Set(publication.cashEvents.map((event) => event.month))];
  if (eventMonths.length) {
    const [closed] = await db.select({ month: reportingPeriods.month }).from(reportingPeriods).where(and(eq(reportingPeriods.companyId, companyId), inArray(reportingPeriods.month, eventMonths), eq(reportingPeriods.status, "closed")));
    if (closed) return { kind: "closed_month", month: closed.month };
  }
  await db.transaction(async (tx) => {
    await tx.delete(cashEvents).where(and(eq(cashEvents.companyId, companyId), eq(cashEvents.evidenceId, evidenceId), isNull(cashEvents.externalKey)));
    // A GL, P&L, balance sheet, or agreement can support recognition and
    // mappings, but cannot publish staged rows as cash actuals by itself.
    await tx.update(cashEvents).set(sourceProvesCash(sourceKind) ? { isActual: "Y", accountingTreatment: "cash", updatedAt: new Date() } : { isActual: "N", accountingTreatment: "pending", updatedAt: new Date() }).where(and(eq(cashEvents.companyId, companyId), eq(cashEvents.evidenceId, evidenceId)));
    // Reference-model rows remain a separately marked learning layer. They
    // cannot enter ledger reconciliation or posting merely because the file
    // itself has been reviewed.
    await tx.update(sourceRows).set({ status: sourceRole === "reference_model" ? "reference" : "approved", updatedAt: new Date() }).where(and(eq(sourceRows.companyId, companyId), eq(sourceRows.evidenceId, evidenceId)));
    await tx.delete(economicItems).where(and(eq(economicItems.companyId, companyId), eq(economicItems.evidenceId, evidenceId)));
    await tx.update(evidence).set({ status: "approved", publishedAt: new Date(), updatedAt: new Date() }).where(and(eq(evidence.id, evidenceId), eq(evidence.companyId, companyId)));
    if (document.sourceId) await tx.insert(ingestionRuns).values({ companyId, sourceId: document.sourceId, stage: "reconciliation", status: "waiting", metadata: JSON.stringify({ trigger: "publication", evidenceId }) });
  });
  let summary: string | undefined;
  try { summary = (JSON.parse(document.extractedJson) as { summary?: string }).summary; } catch { /* the facts carry the content */ }
  const interpretation = await applyApprovedEvidence({ context, actorUserId, evidenceId, evidenceStatus: "approved", extraction: { ...(summary ? { summary } : {}), facts: approvedFacts.map((fact) => ({ label: fact.label, value: fact.value, ...(fact.accountingRole ? { accountingRole: fact.accountingRole } : {}) })) }, ...(sourceKind ? { sourceKind } : {}), ...(sourceRole ? { sourceRole } : {}), ...(document.currency ? { currency: document.currency } : {}), modelChoice: {}, replace: false });
  if ("error" in interpretation && interpretation.status === 409) return { kind: "conflict", error: interpretation.error };
  await recordReviewedKnowledge(db, companyId, evidenceId, approvedFacts.map((fact) => ({ label: fact.label, value: fact.value, ...(fact.accountingRole ? { accountingRole: fact.accountingRole } : {}) })));
  const calculationRun = await refreshCurrentCalculationRun(companyId, { cause: { kind: "evidence_published", subjectType: "evidence", subjectId: document.id, actorUserId, via: "ui" } });
  return { kind: "published", document, interpretation: "error" in interpretation ? { error: interpretation.error } : { items: interpretation.items, transactions: interpretation.transactions, balances: interpretation.balances, questions: interpretation.questions }, calculationRun };
}
