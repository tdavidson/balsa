import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { cashEvents, decisions, economicItems, entities, evidence, getDatabase, knowledgeDocuments, openingPositions, policies, reportingPeriods, reviewItems } from "@finance/database";
import { transactionExternalKey } from "@nevermodel/ingestion";
import type { ApplicationContext } from "@finance/auth";
import { getModelProvider, modelRequestSchema, resolveModelOverrides } from "@/lib/models";
import { recordLlmRun } from "@/lib/llm-telemetry";
import { interpretEvidence, resolveCounterparty, type Interpretation, type KnownEntity } from "@/lib/interpretation";
import { uniqueReviewQuestions } from "@/lib/review-questions";
import { loadEntityStructure } from "@/lib/entity-structure";
import type { z } from "zod";

const cashProvingSources = new Set(["bank_statement", "brokerage_statement", "quickbooks_transactions", "general_ledger"]);

export type ApplyEvidenceResult =
  | { items: number; transactions: number; balances: number; questions: number; interpretation: Interpretation }
  | { error: string; status: number };

/**
 * Turn approved evidence into Company State: interpreted items as drafts for
 * the CFO to confirm, transactions as actual cash events, balances as period
 * opening cash and statement balances. Replaces the regex approval path.
 */
export async function applyApprovedEvidence(options: {
  context: ApplicationContext;
  evidenceId: string;
  evidenceStatus: string;
  extraction: { summary?: string; facts?: { label: string; value: string; confidence?: number; accountingRole?: string }[] };
  /** Intake classification of the source; only cash-proving sources may produce transactions. */
  sourceKind?: string;
  currency?: string;
  modelChoice: z.infer<typeof modelRequestSchema>;
  replace: boolean;
}): Promise<ApplyEvidenceResult> {
  const { context, evidenceId } = options;
  const db = getDatabase();
  const companyId = context.company.id;
  const [evidenceRow] = await db.select({ sourceName: evidence.sourceName, reportingMonth: evidence.reportingMonth, openingBalance: evidence.openingBalance, endingBalance: evidence.endingBalance, statementPeriodEnd: evidence.statementPeriodEnd, accountEntityId: evidence.accountEntityId }).from(evidence).where(and(eq(evidence.id, evidenceId), eq(evidence.companyId, companyId)));
  if (!evidenceRow) return { error: "Evidence not found", status: 404 };
  const [policyRows, decisionRows, knowledgeRows, entityRows] = await Promise.all([
    db.select({ id: policies.id, name: policies.name, rule: policies.rule }).from(policies).where(and(eq(policies.companyId, companyId), eq(policies.active, "Y"))),
    db.select({ question: decisions.question, answer: decisions.answer }).from(decisions).where(and(eq(decisions.companyId, companyId), eq(decisions.status, "applied"))),
    db.select({ slug: knowledgeDocuments.slug, content: knowledgeDocuments.content }).from(knowledgeDocuments).where(eq(knowledgeDocuments.companyId, companyId)),
    db.select({ id: entities.id, name: entities.name, type: entities.type, attributes: entities.attributes }).from(entities).where(eq(entities.companyId, companyId)),
  ]);
  const candidates: KnownEntity[] = entityRows.filter((entity) => entity.type !== "legal_entity" && entity.type !== "account");
  const structure = await loadEntityStructure(companyId);
  const accountId = evidenceRow.accountEntityId ?? undefined;
  const accountEntity = structure.entityOfAccount(accountId);
  const provider = getModelProvider(resolveModelOverrides(options.modelChoice));
  let interpretation: Interpretation;
  try {
    interpretation = await interpretEvidence({ provider, sourceName: evidenceRow.sourceName, summary: options.extraction.summary, facts: options.extraction.facts ?? [], reportingMonth: evidenceRow.reportingMonth ?? undefined, policies: policyRows, decisions: decisionRows, knowledge: knowledgeRows, entities: candidates, legalEntities: structure.legalEntities, ...(options.sourceKind ? { sourceKind: options.sourceKind } : {}) });
    // A source that cannot prove cash (an income statement, a balance sheet, an agreement) never creates transactions.
    if (options.sourceKind && !cashProvingSources.has(options.sourceKind)) interpretation = { ...interpretation, transactions: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Interpretation failed";
    await recordLlmRun({ db, provider, companyId, userId: context.user.id, operation: "evidence_interpretation", request: { evidenceId, facts: options.extraction.facts?.length ?? 0 }, status: "failed", error: message });
    await db.insert(reviewItems).values({ companyId, evidenceId, question: `The approved facts from ${evidenceRow.sourceName} could not be interpreted into agreements and transactions (${message}). Approve the evidence again to retry.` });
    return { error: `Evidence approved, but interpretation failed: ${message}`, status: 502 };
  }
  await recordLlmRun({ db, provider, companyId, userId: context.user.id, operation: "evidence_interpretation", request: { evidenceId, sourceName: evidenceRow.sourceName, facts: options.extraction.facts }, response: JSON.stringify(interpretation) });

  // Closed periods reject anything dated inside them.
  const touchedMonths = new Set<string>([
    ...interpretation.transactions.map((transaction) => transaction.date.slice(0, 7)),
    ...interpretation.balances.map((balance) => balance.date.slice(0, 7)),
    ...interpretation.items.filter((item) => item.cadence === "once").map((item) => item.effectiveFrom),
  ]);
  if (touchedMonths.size) {
    const closed = await db.select({ month: reportingPeriods.month }).from(reportingPeriods).where(and(eq(reportingPeriods.companyId, companyId), inArray(reportingPeriods.month, [...touchedMonths]), eq(reportingPeriods.status, "closed")));
    if (closed.length) {
      await db.update(evidence).set({ status: "pending", updatedAt: new Date() }).where(eq(evidence.id, evidenceId));
      return { error: `Evidence references closed reporting month: ${closed[0]!.month}`, status: 409 };
    }
  }
  if (options.replace) {
    // Imported rows (those with an external key) are the source's own transactions and stay.
    await db.delete(cashEvents).where(and(eq(cashEvents.companyId, companyId), eq(cashEvents.evidenceId, evidenceId), isNull(cashEvents.externalKey)));
    await db.delete(economicItems).where(and(eq(economicItems.companyId, companyId), eq(economicItems.evidenceId, evidenceId)));
  }

  // Balances: an opening balance sets the period's opening cash; both feed reconciliation from the evidence row.
  let openingBalance = evidenceRow.openingBalance;
  let endingBalance = evidenceRow.endingBalance;
  for (const balance of interpretation.balances) {
    const month = balance.date.slice(0, 7);
    const amount = Math.abs(balance.amount);
    if (balance.kind === "opening") {
      if (accountId) {
        // A statement opening balance is that account's cash position at the start of the month.
        const [existing] = await db.select({ id: openingPositions.id }).from(openingPositions).where(and(eq(openingPositions.companyId, companyId), eq(openingPositions.accountEntityId, accountId), eq(openingPositions.month, month), eq(openingPositions.ledger, "cash")));
        if (existing) await db.update(openingPositions).set({ amount: String(amount), updatedAt: new Date() }).where(eq(openingPositions.id, existing.id));
        else await db.insert(openingPositions).values({ companyId, entityId: accountEntity ?? null, accountEntityId: accountId, month, ledger: "cash", amount: String(amount) });
      } else {
        await db.insert(reportingPeriods).values({ companyId, month, openingCash: String(amount) }).onConflictDoUpdate({ target: [reportingPeriods.companyId, reportingPeriods.month], set: { openingCash: String(amount), updatedAt: new Date() } });
      }
      if (!openingBalance) openingBalance = String(amount);
    } else if (!endingBalance) endingBalance = String(amount);
  }
  const reportingMonth = evidenceRow.reportingMonth ?? interpretation.balances.find((balance) => balance.kind === "ending")?.date.slice(0, 7) ?? interpretation.transactions.map((transaction) => transaction.date.slice(0, 7)).sort().at(-1);
  await db.update(evidence).set({ ...(openingBalance !== evidenceRow.openingBalance ? { openingBalance } : {}), ...(endingBalance !== evidenceRow.endingBalance ? { endingBalance } : {}), ...(reportingMonth && !evidenceRow.reportingMonth ? { reportingMonth } : {}), updatedAt: new Date() }).where(eq(evidence.id, evidenceId));

  // Transactions become actual cash events with their counterparty and category already resolved.
  const existingEvents = await db.select({ id: cashEvents.id }).from(cashEvents).where(and(eq(cashEvents.companyId, companyId), eq(cashEvents.evidenceId, evidenceId))).limit(1);
  let transactionCount = 0;
  if (!existingEvents.length && interpretation.transactions.length) {
    const rows = [];
    for (const transaction of interpretation.transactions) {
      const entity = transaction.counterparty && transaction.activity === "operating" ? await resolveCounterparty(db, companyId, { name: transaction.counterparty, alias: transaction.description, category: transaction.category, direction: transaction.direction, candidates }) : undefined;
      rows.push({
        companyId, evidenceId, month: transaction.date.slice(0, 7), transactionDate: transaction.date, description: transaction.description, amount: String(transaction.amount), direction: transaction.direction,
        category: transaction.activity, financialCategory: transaction.category ?? undefined, counterpartyEntityId: entity?.id, accountEntityId: accountId, entityId: structure.resolveEntityName(transaction.entity) ?? accountEntity, ...(options.currency ? { currency: options.currency } : {}), isActual: options.evidenceStatus === "approved" ? "Y" as const : "N" as const,
        externalKey: transactionExternalKey({ date: transaction.date.slice(0, 7), postedDate: transaction.date, description: transaction.description, amount: transaction.amount, direction: transaction.direction }),
      });
    }
    const inserted = await db.insert(cashEvents).values(rows).onConflictDoNothing({ target: [cashEvents.companyId, cashEvents.externalKey] }).returning({ id: cashEvents.id });
    transactionCount = inserted.length;
  }

  // Items are drafts until the CFO confirms them.
  const existingItems = await db.select({ id: economicItems.id }).from(economicItems).where(and(eq(economicItems.companyId, companyId), eq(economicItems.evidenceId, evidenceId))).limit(1);
  let itemCount = 0;
  if (!existingItems.length && interpretation.items.length) {
    const rows = [];
    for (const item of interpretation.items) {
      const entity = item.counterparty ? await resolveCounterparty(db, companyId, { name: item.counterparty, category: item.category, direction: item.direction, candidates }) : undefined;
      const policy = item.appliedPolicy ? policyRows.find((row) => row.name.toLowerCase() === item.appliedPolicy!.toLowerCase() || item.appliedPolicy!.toLowerCase().includes(row.name.toLowerCase())) : undefined;
      rows.push({
        companyId, evidenceId, type: item.direction === "spend" ? "obligation" as const : "agreement" as const, direction: item.direction, label: item.label, counterparty: item.counterparty ?? undefined, counterpartyEntityId: entity?.id,
        amount: String(item.amount), cadence: item.cadence, effectiveFrom: item.effectiveFrom, effectiveTo: item.effectiveTo ?? undefined, category: item.category, basis: item.basis,
        accountingTreatment: item.accountingTreatment, recognitionStart: item.recognitionStart ?? undefined, recognitionEnd: item.recognitionEnd ?? undefined,
        confidence: String(item.confidence), rationale: item.rationale, policyId: policy?.id, entityId: structure.resolveEntityName(item.entity) ?? accountEntity, status: "draft" as const,
      });
    }
    const inserted = await db.insert(economicItems).values(rows).returning({ id: economicItems.id });
    itemCount = inserted.length;
  }

  const openQuestions = await db.select({ question: reviewItems.question }).from(reviewItems).where(and(eq(reviewItems.companyId, companyId), eq(reviewItems.status, "open")));
  const fresh = uniqueReviewQuestions([...openQuestions, ...interpretation.questions.map((question) => ({ question: question.trim() })).filter((entry) => entry.question)]).slice(openQuestions.length);
  if (fresh.length) await db.insert(reviewItems).values(fresh.map((entry) => ({ companyId, evidenceId, question: entry.question })));
  return { items: itemCount, transactions: transactionCount, balances: interpretation.balances.length, questions: fresh.length, interpretation };
}
