import { compareDecisions, dispositionFor, type Assumption, type FactAssessment } from "./review-assessment";

/**
 * Arrange extracted evidence for review: what needs a person, what can wait as
 * less important, and what Balsa assumed under the owner's threshold. Settled
 * facts a person reviewed are not shown again. Assessments come from the
 * server; this only groups and orders them.
 */

export type QueueFact = { label: string; value: string; accountingRole?: string; factId?: string; factStatus?: string; assessment?: FactAssessment & { assumed?: Assumption | null; reopened?: boolean } };
export type QueueEvidence = {
  id: string;
  sourceName: string;
  status: string;
  identityStatus: string;
  ingestionStatus?: string | null;
  reportingMonth?: string | null;
  sourceMetadata?: { classification?: { kind?: string } } | null;
  identityAssessment?: { score: number; reasons: string[]; assumed?: Assumption | null };
  extraction: { facts: QueueFact[] } | null;
};

export type QueueItem = { evidence: QueueEvidence; fact: QueueFact & { factId: string }; assessment: FactAssessment; reason: string };
export type ReviewQueue = {
  /** Documents whose identity a person must confirm before their facts are reviewed. */
  documents: { evidence: QueueEvidence; pendingFacts: number; reason: string }[];
  decisions: QueueItem[];
  minor: { evidence: QueueEvidence; items: QueueItem[] }[];
  assumed: (QueueItem & { assumption: Assumption })[];
  assumedDocuments: { evidence: QueueEvidence; assumption: Assumption }[];
};

const activeIngestion = new Set(["stored", "extracting", "reconciling", "processing"]);
const fallbackAssessment: FactAssessment = { score: 0, reasons: ["Not yet assessed"], amount: null, minor: false };
const percent = (value: number) => `${Math.round(value * 100)}%`;

/** The one line that says why a fact needs a person. */
export function decisionReason(assessment: FactAssessment, threshold: number | null, reopened = false) {
  if (reopened) return "You asked to review this";
  const cap = assessment.reasons.find((reason) => !reason.startsWith("Extraction reported"));
  if (cap) return cap;
  if (threshold === null) return `${percent(assessment.score)} confident · Balsa asks about every fact`;
  return `${percent(assessment.score)} confident, below your ${percent(threshold)}`;
}

export function buildReviewQueue(evidence: QueueEvidence[], threshold: number | null): ReviewQueue {
  const queue: ReviewQueue = { documents: [], decisions: [], minor: [], assumed: [], assumedDocuments: [] };
  for (const item of evidence) {
    if (item.identityStatus === "rejected" || !item.extraction || activeIngestion.has(item.ingestionStatus ?? "")) continue;
    const facts = item.extraction.facts.filter((fact): fact is QueueFact & { factId: string } => Boolean(fact.factId));
    const open = facts.filter((fact) => fact.factStatus === "pending" || fact.factStatus === "approved");
    if (item.identityStatus !== "approved") {
      const identity = item.identityAssessment;
      queue.documents.push({ evidence: item, pendingFacts: open.length, reason: identity ? identity.reasons.find((reason) => !reason.startsWith("Source type recognized")) ?? (threshold === null ? "Balsa asks you to confirm every document" : `${percent(identity.score)} confident, below your ${percent(threshold)}`) : "Confirm the source, entity, and period" });
      continue;
    }
    if (item.identityAssessment?.assumed) queue.assumedDocuments.push({ evidence: item, assumption: item.identityAssessment.assumed });
    const minor: QueueItem[] = [];
    for (const fact of facts) {
      const assessment = fact.assessment ?? fallbackAssessment;
      if (fact.factStatus === "treatment_approved") {
        if (fact.assessment?.assumed) queue.assumed.push({ evidence: item, fact, assessment, reason: "", assumption: fact.assessment.assumed });
        continue;
      }
      if (fact.factStatus !== "pending" && fact.factStatus !== "approved") continue;
      const reopened = Boolean(fact.assessment?.reopened);
      // Below the threshold, or reopened by a person. A fact at or above the threshold waits for the automatic pass.
      const disposition = reopened ? "decide" : dispositionFor(assessment, threshold);
      if (disposition === "assumed") continue;
      const entry = { evidence: item, fact, assessment, reason: decisionReason(assessment, threshold, reopened) };
      if (disposition === "minor") minor.push(entry); else queue.decisions.push(entry);
    }
    if (minor.length) queue.minor.push({ evidence: item, items: minor });
  }
  queue.decisions.sort((left, right) => compareDecisions(left.assessment, right.assessment));
  queue.assumed.sort((left, right) => compareDecisions(left.assessment, right.assessment));
  return queue;
}

/** Documents with facts the automatic pass could accept now under `threshold`. */
export function evidenceReadyToAssume(evidence: QueueEvidence[], threshold: number | null) {
  if (threshold === null) return [];
  return evidence.filter((item) => {
    if (item.identityStatus === "rejected" || !item.extraction || activeIngestion.has(item.ingestionStatus ?? "")) return false;
    if (item.identityStatus !== "approved") return (item.identityAssessment?.score ?? 0) >= threshold;
    return item.extraction.facts.some((fact) => fact.factId && (fact.factStatus === "pending" || fact.factStatus === "approved") && !fact.assessment?.reopened && (fact.assessment?.score ?? 0) >= threshold);
  });
}
