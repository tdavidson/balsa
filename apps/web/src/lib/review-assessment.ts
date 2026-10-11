import { parseFinancialAmount } from "./financial-events";

/**
 * Deterministic review triage for extracted evidence.
 *
 * A model reports its own confidence for each fact. That number alone is not a
 * reason to trust a value, so it is checked against what code can verify: the
 * accounting role is known, the value is a readable amount, and the amount
 * appears in the source text. The assessed score is the model's confidence
 * capped by every check that fails, and each cap carries a plain reason.
 *
 * The owner sets the confidence Balsa needs before it proceeds without asking.
 * At or above that level a fact is accepted as an assumption: recorded, shown,
 * and reversible. Below it the fact is a decision, unless it is immaterial to
 * its document, in which case it waits in a quieter "less important" group.
 */

export type ReviewDisposition = "decide" | "minor" | "assumed";
export type FactAssessment = { score: number; reasons: string[]; amount: number | null; minor: boolean };
export type AssessableFact = { label: string; value: string; accountingRole?: string | null; confidence: number | string };

/** Roles whose value must be an amount before it can affect financial state. */
const amountRoles = new Set(["transaction", "opening_balance", "ending_balance", "transfer", "investment_movement", "revenue", "expense", "financing"]);
/** Below this share of a document's largest amount, an uncertain fact is grouped as less important. */
export const minorShareOfDocument = 0.01;
/** The levels offered in the UI; the stored value may be any of these or null. */
export const confidenceThresholdOptions = [0.95, 0.9, 0.8] as const;
export const minimumConfidenceThreshold = 0.5;

const percent = (value: number) => `${Math.round(value * 100)}%`;

function clampConfidence(value: number | string) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0;
}

/** Spellings a statement commonly uses for an amount: 1,234.50 and 1234.50, and whole numbers without cents. */
function amountSpellings(amount: number) {
  const absolute = Math.abs(amount);
  const fixed = absolute.toFixed(2);
  const grouped = absolute.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const spellings = new Set([fixed, grouped]);
  if (Number.isInteger(absolute)) {
    spellings.add(String(absolute));
    spellings.add(absolute.toLocaleString("en-US", { maximumFractionDigits: 0 }));
  }
  return [...spellings];
}

/** Whether a value can be found in the source text it was extracted from. */
export function valueAppearsInSource(rawText: string, value: string, amount: number | null) {
  const text = rawText.toLowerCase();
  if (amount !== null) return amountSpellings(amount).some((spelling) => text.includes(spelling.toLowerCase()));
  const needle = value.trim().toLowerCase();
  return needle.length > 0 && text.includes(needle);
}

/**
 * Assess one fact. `documentMaxAmount` is the largest absolute amount among the
 * document's facts; `rawText` is the stored source text, or empty when the
 * source has none to compare against (a structured feed).
 */
export function assessFact(fact: AssessableFact, options: { rawText: string; documentMaxAmount: number }): FactAssessment {
  const role = fact.accountingRole ?? "unknown";
  const amount = parseFinancialAmount(fact.value) ?? null;
  let score = clampConfidence(fact.confidence);
  const reasons: string[] = [];
  const cap = (limit: number, reason: string) => {
    if (score > limit) score = limit;
    reasons.push(reason);
  };
  if (score < 1) reasons.push(`Extraction reported ${percent(score)} confidence`);
  if (role === "unknown") cap(0.4, "The source does not establish an accounting role");
  if (amountRoles.has(role) && amount === null) cap(0.5, "The value is not a readable amount");
  if (options.rawText.trim() && !valueAppearsInSource(options.rawText, fact.value, amount)) cap(0.6, amount === null ? "The value was not found in the source text" : "The amount was not found in the source text");
  const minor = amount !== null && options.documentMaxAmount > 0 && Math.abs(amount) < options.documentMaxAmount * minorShareOfDocument;
  return { score, reasons, amount, minor };
}

/** The largest absolute amount among a document's facts, used to judge materiality. */
export function documentMaxAmount(facts: { value: string }[]) {
  return facts.reduce((max, fact) => Math.max(max, Math.abs(parseFinancialAmount(fact.value) ?? 0)), 0);
}

/** How a fact is presented for a given owner threshold; null means ask about everything. */
export function dispositionFor(assessment: Pick<FactAssessment, "score" | "minor">, threshold: number | null): ReviewDisposition {
  if (threshold !== null && assessment.score >= threshold) return "assumed";
  return assessment.minor ? "minor" : "decide";
}

export type IdentityAssessment = { score: number; reasons: string[] };

/**
 * Assess whether a document is what intake says it is. A reference model or an
 * unrecognized source always needs a person; so does a source with no period.
 */
export function assessDocumentIdentity(input: { classificationConfidence?: string | null; kind?: string | null; sourceRole?: string | null; reportingMonth?: string | null }): IdentityAssessment {
  const reasons: string[] = [];
  let score = input.classificationConfidence === "high" ? 0.95 : input.classificationConfidence === "medium" ? 0.8 : 0.5;
  reasons.push(`Source type recognized with ${input.classificationConfidence ?? "low"} confidence`);
  const cap = (limit: number, reason: string) => {
    if (score > limit) score = limit;
    reasons.push(reason);
  };
  if (!input.kind || input.kind === "unknown") cap(0.4, "The source type was not recognized");
  if (input.sourceRole === "reference_model") cap(0.4, "Reference models are always confirmed by a person");
  if (!input.reportingMonth) cap(0.5, "No reporting period was established");
  return { score, reasons };
}

/** Parse a stored threshold; anything outside 0.5 through 1 is treated as unset. */
export function parseConfidenceThreshold(value: string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimumConfidenceThreshold && number <= 1 ? number : null;
}

/** Importance order for decisions: larger amounts first, then lower confidence. */
export function compareDecisions(left: FactAssessment, right: FactAssessment) {
  const amount = Math.abs(right.amount ?? 0) - Math.abs(left.amount ?? 0);
  return amount !== 0 ? amount : left.score - right.score;
}

/** The approval-event basis recorded when Balsa accepts under the owner's threshold. */
export const confidenceThresholdBasis = "confidence_threshold";
export type Assumption = { threshold: number; score: number; at: string };
type ApprovalLike = { factId?: string | null; layer: string; action: string; metadata?: string | null; createdAt: Date | string };

/**
 * Whether the latest approval of a fact (or, with `factId` null, of the
 * document identity) was an assumption under the owner's threshold rather
 * than a person's review. A later manual approval replaces the assumption.
 */
export function assumptionFromApprovals(approvals: ApprovalLike[], factId: string | null): Assumption | null {
  const relevant = approvals.filter((approval) => factId === null ? approval.layer === "document" && !approval.factId : approval.factId === factId);
  const latest = relevant.reduce<ApprovalLike | null>((current, approval) => !current || new Date(approval.createdAt) > new Date(current.createdAt) ? approval : current, null);
  if (!latest || latest.action !== "approved" || !latest.metadata) return null;
  try {
    const metadata = JSON.parse(latest.metadata) as { basis?: string; threshold?: number; score?: number };
    if (metadata.basis !== confidenceThresholdBasis || typeof metadata.threshold !== "number" || typeof metadata.score !== "number") return null;
    return { threshold: metadata.threshold, score: metadata.score, at: new Date(latest.createdAt).toISOString() };
  } catch {
    return null;
  }
}

/** Whether a person sent this fact back to review; such a fact is never assumed again. */
export function reopenedFromApprovals(approvals: Pick<ApprovalLike, "factId" | "action">[], factId: string) {
  return approvals.some((approval) => approval.factId === factId && approval.action === "pending");
}
