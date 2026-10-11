import { and, eq } from "drizzle-orm";
import type { ApplicationContext } from "@finance/auth";
import { approvalEvents, companies, evidence, factRecords, getDatabase, recordAudit, sources } from "@finance/database";
import { publishEvidenceIfComplete, type PublishOutcome } from "./evidence-publish";
import { assessDocumentIdentity, assessFact, confidenceThresholdBasis, documentMaxAmount, parseConfidenceThreshold, reopenedFromApprovals } from "./review-assessment";

export type AcceptanceScope = "assumed" | "minor";
export type AcceptanceResult = {
  accepted: number;
  identity: "already_confirmed" | "assumed" | "needs_review";
  publication: PublishOutcome["kind"] | "not_attempted" | "failed";
  threshold: number | null;
};

export class AcceptanceError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** The basis recorded when a person accepts a document's less important facts together. */
export const minorBatchBasis = "minor_batch";

/**
 * Accept facts without asking about each one.
 *
 * `assumed` applies the owner's confidence threshold: the document identity and
 * every fact whose deterministic assessment meets it are approved with their
 * proposed treatment, recorded as assumptions so they stay visible and
 * reversible. `minor` is a person's explicit action: it accepts the
 * document's immaterial facts that have a known accounting role.
 *
 * Every change writes an approval event and an audit row. Publication then
 * follows the same path as a manual approval.
 */
export async function acceptEvidenceFacts(context: ApplicationContext, evidenceId: string, scope: AcceptanceScope): Promise<AcceptanceResult> {
  const db = getDatabase();
  const companyId = context.company.id;
  const [company] = await db.select({ reviewConfidenceThreshold: companies.reviewConfidenceThreshold }).from(companies).where(eq(companies.id, companyId)).limit(1);
  const threshold = parseConfidenceThreshold(company?.reviewConfidenceThreshold);
  if (scope === "assumed" && threshold === null) throw new AcceptanceError("Choose a confidence level before Balsa accepts facts on its own.", 409);
  const [document] = await db.select({ id: evidence.id, sourceName: evidence.sourceName, identityStatus: evidence.identityStatus, rawText: evidence.rawText, reportingMonth: evidence.reportingMonth, extractedJson: evidence.extractedJson, sourceMetadata: sources.metadata }).from(evidence).leftJoin(sources, eq(evidence.sourceId, sources.id)).where(and(eq(evidence.id, evidenceId), eq(evidence.companyId, companyId)));
  if (!document) throw new AcceptanceError("Evidence not found", 404);
  if (document.identityStatus === "rejected") throw new AcceptanceError("This document was rejected.", 409);
  if (!document.extractedJson) return { accepted: 0, identity: document.identityStatus === "approved" ? "already_confirmed" : "needs_review", publication: "not_attempted", threshold };

  let identity: AcceptanceResult["identity"] = document.identityStatus === "approved" ? "already_confirmed" : "needs_review";
  if (identity === "needs_review") {
    if (scope === "minor") throw new AcceptanceError("Confirm the document before accepting its facts.", 409);
    let metadata: { sourceRole?: string; classification?: { kind?: string; confidence?: string } } = {};
    try { metadata = JSON.parse(document.sourceMetadata ?? "{}"); } catch { /* an unreadable classification is low confidence */ }
    const assessment = assessDocumentIdentity({ classificationConfidence: metadata.classification?.confidence ?? null, kind: metadata.classification?.kind ?? null, sourceRole: metadata.sourceRole ?? null, reportingMonth: document.reportingMonth });
    if (assessment.score < threshold!) return { accepted: 0, identity, publication: "not_attempted", threshold };
    const confirmed = await db.transaction(async (tx) => {
      const [row] = await tx.update(evidence).set({ identityStatus: "approved", status: "pending", updatedAt: new Date() }).where(and(eq(evidence.id, evidenceId), eq(evidence.companyId, companyId), eq(evidence.identityStatus, "pending"))).returning({ id: evidence.id });
      if (!row) return false;
      await tx.insert(approvalEvents).values({ companyId, evidenceId, userId: context.user.id, layer: "document", action: "approved", previousValue: "pending", nextValue: "approved", metadata: JSON.stringify({ basis: confidenceThresholdBasis, threshold, score: assessment.score, reasons: assessment.reasons }) });
      await recordAudit(tx, { companyId, actorUserId: context.user.id, via: "ui", action: "evidence.assumed", entityType: "evidence", entityId: evidenceId, summary: `Accepted ${document.sourceName} (document layer) at ${Math.round(assessment.score * 100)}% confidence under the ${Math.round(threshold! * 100)}% threshold`, before: { identityStatus: "pending" }, after: { identityStatus: "approved", threshold, score: assessment.score } });
      return true;
    });
    // Another request changed the identity first; leave the facts to that request.
    if (!confirmed) return { accepted: 0, identity, publication: "not_attempted", threshold };
    identity = "assumed";
  }

  const facts = await db.select({ id: factRecords.id, label: factRecords.label, value: factRecords.value, accountingRole: factRecords.accountingRole, confidence: factRecords.confidence, status: factRecords.status }).from(factRecords).where(and(eq(factRecords.companyId, companyId), eq(factRecords.evidenceId, evidenceId)));
  const maxAmount = documentMaxAmount(facts);
  const history = scope === "assumed" ? await db.select({ factId: approvalEvents.factId, action: approvalEvents.action }).from(approvalEvents).where(and(eq(approvalEvents.companyId, companyId), eq(approvalEvents.evidenceId, evidenceId))) : [];
  const eligible = facts.flatMap((fact) => {
    if (fact.status !== "pending" && fact.status !== "approved") return [];
    if (scope === "assumed" && reopenedFromApprovals(history, fact.id)) return [];
    const assessment = assessFact(fact, { rawText: document.rawText, documentMaxAmount: maxAmount });
    const take = scope === "assumed" ? assessment.score >= threshold! : assessment.minor && (fact.accountingRole ?? "unknown") !== "unknown";
    return take ? [{ fact, assessment }] : [];
  });

  const accepted = await db.transaction(async (tx) => {
    let count = 0;
    for (const { fact, assessment } of eligible) {
      const [row] = await tx.update(factRecords).set({ status: "treatment_approved", updatedAt: new Date() }).where(and(eq(factRecords.id, fact.id), eq(factRecords.companyId, companyId), eq(factRecords.evidenceId, evidenceId), eq(factRecords.status, fact.status))).returning({ id: factRecords.id });
      if (!row) continue;
      count += 1;
      const metadata = JSON.stringify({ label: fact.label, basis: scope === "assumed" ? confidenceThresholdBasis : minorBatchBasis, threshold, score: assessment.score, reasons: assessment.reasons });
      const role = fact.accountingRole;
      // Mirror the two manual layers so the history reads the same either way.
      if (fact.status === "pending") await tx.insert(approvalEvents).values({ companyId, evidenceId, factId: fact.id, userId: context.user.id, layer: "fact", action: "approved", previousValue: JSON.stringify({ status: "pending", accountingRole: role }), nextValue: JSON.stringify({ status: "approved", accountingRole: role }), metadata });
      await tx.insert(approvalEvents).values({ companyId, evidenceId, factId: fact.id, userId: context.user.id, layer: "treatment", action: "approved", previousValue: JSON.stringify({ status: "approved", accountingRole: role }), nextValue: JSON.stringify({ status: "treatment_approved", accountingRole: role }), metadata });
    }
    if (count) await recordAudit(tx, { companyId, actorUserId: context.user.id, via: "ui", action: scope === "assumed" ? "evidence.assumed" : "evidence.approved", entityType: "evidence", entityId: evidenceId, summary: scope === "assumed" ? `Accepted ${count} fact${count === 1 ? "" : "s"} from ${document.sourceName} at or above the ${Math.round(threshold! * 100)}% confidence threshold` : `Accepted ${count} less important fact${count === 1 ? "" : "s"} from ${document.sourceName}`, before: null, after: { accepted: count, scope, threshold } });
    return count;
  });

  // The acceptances above are committed. A publication failure (for example, an
  // unavailable model during interpretation) must not be reported as a failure
  // to accept; the document publishes on its next approval or retry.
  try {
    const outcome = await publishEvidenceIfComplete(context, evidenceId, context.user.id);
    return { accepted, identity, publication: outcome.kind, threshold };
  } catch {
    return { accepted, identity, publication: "failed", threshold };
  }
}
