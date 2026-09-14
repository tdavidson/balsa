import type { SourceKind } from "@nevermodel/ingestion";
import { classifyCashActivity, inferFinancialDirection, isDetailedFinancialEvent, parseFinancialAmount } from "./financial-events";
import { classifyWithCompanyPolicy, type ExecutableCompanyPolicy } from "./company-policy-engine";

export type PublishableFact = { label: string; value: string; accountingRole?: string | null };

export function dateFromEvidenceFact(value: string) {
  const raw = value.match(/\b20\d{2}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/20\d{2}\b|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+20\d{2}\b/i)?.[0];
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

export function monthFromEvidenceFact(value: string, reportingMonth?: string | null) {
  const exactDate = dateFromEvidenceFact(value);
  if (exactDate) return exactDate.slice(0, 7);
  return value.match(/\b(20\d{2}-\d{2})\b/)?.[1] ?? reportingMonth ?? undefined;
}

function sourceCanProveCash(kind: SourceKind | undefined) {
  return ["bank_statement", "brokerage_statement", "quickbooks_transactions"].includes(kind ?? "");
}

function cashRole(role: string | null | undefined) {
  return ["transaction", "transfer", "investment_movement", "revenue", "expense", "financing"].includes(role ?? "");
}

/**
 * Converts approved evidence into a posting plan without touching storage.
 * Source role is the outer gate: an income statement can prove revenue but
 * cannot, by itself, prove that cash moved.
 */
export function buildEvidencePublication(input: {
  facts: PublishableFact[];
  sourceKind?: SourceKind;
  sourceRole?: "reference_model";
  reportingMonth?: string | null;
  currency?: string | null;
  policies?: ExecutableCompanyPolicy[];
}) {
  const openingBalances: { month: string; amount: string }[] = [];
  const cashEvents: { month: string; transactionDate?: string; description: string; amount: string; currency?: string; direction: "receipt" | "spend"; category: string; policyId?: string }[] = [];
  const economicItems: { type: "agreement" | "obligation"; direction: "receipt" | "spend"; label: string; amount?: string; cadence?: string; policyId?: string }[] = [];
  const blocked: { label: string; reason: string }[] = [];

  // A financial model can be excellent onboarding context, but its values are
  // never a posting instruction. Keep this gate here as well as at promotion.
  if (input.sourceRole === "reference_model") return { openingBalances, cashEvents, economicItems, blocked };

  for (const fact of input.facts) {
    const role = fact.accountingRole;
    const amount = parseFinancialAmount(fact.value);
    const month = monthFromEvidenceFact(fact.value, input.reportingMonth);
    if (role === "opening_balance") {
      if (amount === undefined) blocked.push({ label: fact.label, reason: "Opening balance has no explicit amount." });
      else if (!month) blocked.push({ label: fact.label, reason: "Opening balance has no explicit reporting period." });
      else openingBalances.push({ month, amount: String(amount) });
      continue;
    }

    if (sourceCanProveCash(input.sourceKind) && cashRole(role)) {
      if (amount === undefined) { blocked.push({ label: fact.label, reason: "Cash fact has no explicit amount." }); continue; }
      if (!month) { blocked.push({ label: fact.label, reason: "Cash fact has no explicit reporting period." }); continue; }
      const description = `${fact.label}: ${fact.value}`;
      if (!isDetailedFinancialEvent(description)) continue;
      const direction = inferFinancialDirection(amount < 0 ? "spend" : "receipt", description);
      const transactionDate = dateFromEvidenceFact(fact.value);
      const policy = classifyWithCompanyPolicy(description, input.policies ?? [], { effectiveDate: transactionDate ?? `${month}-01`, ...(input.sourceKind ? { sourceKind: input.sourceKind } : {}) });
      cashEvents.push({ month, ...(transactionDate ? { transactionDate } : {}), description, amount: String(Math.abs(amount)), ...(input.currency ? { currency: input.currency } : {}), direction, category: policy?.category ?? classifyCashActivity(description, direction), ...(policy ? { policyId: policy.policyId } : {}) });
      continue;
    }

    if (input.sourceKind === "agreement" && ["agreement", "revenue", "expense"].includes(role ?? "")) {
      const spend = role === "expense" || /pay|spend|cost|expense|owe|vendor|bill/i.test(`${fact.label} ${fact.value}`);
      const cadence = /month|quarter|annual|year|weekly/i.exec(fact.value)?.[0];
      economicItems.push({ type: spend ? "obligation" : "agreement", direction: spend ? "spend" : "receipt", label: fact.label, ...(amount === undefined ? {} : { amount: String(Math.abs(amount)) }), ...(cadence ? { cadence } : {}) });
    }
  }

  return { openingBalances, cashEvents, economicItems, blocked };
}
