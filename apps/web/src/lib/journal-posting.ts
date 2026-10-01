import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { approvalEvents, chartAccounts, decisions, entities, evidence, factRecords, fxRates, fxRateSets, getDatabase, journalBatches, journalEntries, journalLines, policies, postingProposals, recordAudit, reportingPeriods, scenarios, sourceRows, sources } from "@finance/database";
import { convertMinorAtFxRate, selectApprovedFxRate, validateJournalEntry, type JournalLineInput } from "@balsa/finance-engine";
import { refreshCurrentCalculationRun } from "@/lib/refresh-calculation-run";
import { validatePostingActivity } from "@/lib/posting-controls";
import { hasPostingBasis } from "@/lib/posting-basis";

export type JournalPostingRequest = {
  idempotencyKey: string;
  /** The person who posted; omitted by unattended paths, which log as `worker`. */
  actorUserId?: string;
  label: string;
  source: string;
  /** Cash activity class, if the proposal originated from a source cash row. */
  activity?: "operating" | "transfer" | "investment" | "financing";
  postingDate: string;
  period: string;
  memo: string;
  /** Actual is the default; forecasts and scenarios use the same balanced-entry model. */
  basis?: "actual" | "forecast" | "scenario" | "plan" | "adjustment" | "elimination" | "translation";
  scenarioId?: string;
  reversalOfEntryId?: string;
  entityId?: string;
  sourceId?: string;
  sourceRowId?: string;
  evidenceId?: string;
  factId?: string;
  decisionId?: string;
  policyId?: string;
  approvalEventId?: string;
  lines: (JournalLineInput & { transactionCurrency?: string; transactionDebitMinor?: string; transactionCreditMinor?: string; fxRateId?: string; sourceId?: string; sourceRowId?: string; evidenceId?: string; factId?: string; decisionId?: string; policyId?: string; approvalEventId?: string; sourceLocation?: string; memo?: string })[];
  /** Batch posters (plan pins) refresh once themselves after the batch; the single entry must not advance the revision. */
  deferRefresh?: boolean;
};

export type JournalPostingResult = { batchId: string; entryId: string; proposalId: string; idempotent: boolean; calculationRun: Awaited<ReturnType<typeof refreshCurrentCalculationRun>> | null };

async function verifyProvenanceOwnership(companyId: string, request: JournalPostingRequest, tx: Parameters<Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]>[0]) {
  const collect = (key: "sourceId" | "sourceRowId" | "evidenceId" | "factId" | "decisionId" | "policyId" | "approvalEventId") => [...new Set([request[key], ...request.lines.map((line) => line[key])].filter((value): value is string => Boolean(value)))];
  const checks = [
    ["source", collect("sourceId"), sources],
    ["source row", collect("sourceRowId"), sourceRows],
    ["evidence", collect("evidenceId"), evidence],
    ["fact", collect("factId"), factRecords],
    ["decision", collect("decisionId"), decisions],
    ["policy", collect("policyId"), policies],
    ["approval event", collect("approvalEventId"), approvalEvents],
  ] as const;
  for (const [label, ids, table] of checks) {
    if (!ids.length) continue;
    const rows = await tx.select({ id: table.id }).from(table).where(and(eq(table.companyId, companyId), inArray(table.id, ids)));
    if (rows.length !== ids.length) throw new Error(`Every referenced ${label} must belong to the company.`);
  }
  const [approvedEvidence, approvedFacts, appliedDecisions, activePolicies] = await Promise.all([
    collect("evidenceId").length ? tx.select({ id: evidence.id }).from(evidence).where(and(eq(evidence.companyId, companyId), inArray(evidence.id, collect("evidenceId")), eq(evidence.status, "approved"))) : [],
    collect("factId").length ? tx.select({ id: factRecords.id }).from(factRecords).where(and(eq(factRecords.companyId, companyId), inArray(factRecords.id, collect("factId")), eq(factRecords.status, "approved"))) : [],
    collect("decisionId").length ? tx.select({ id: decisions.id }).from(decisions).where(and(eq(decisions.companyId, companyId), inArray(decisions.id, collect("decisionId")), eq(decisions.status, "applied"))) : [],
    collect("policyId").length ? tx.select({ id: policies.id }).from(policies).where(and(eq(policies.companyId, companyId), inArray(policies.id, collect("policyId")), eq(policies.active, "Y"))) : [],
  ]);
  if (approvedEvidence.length !== collect("evidenceId").length) throw new Error("Journal postings require approved evidence.");
  if (approvedFacts.length !== collect("factId").length) throw new Error("Journal postings require approved facts.");
  if (appliedDecisions.length !== collect("decisionId").length) throw new Error("Journal postings require applied decisions.");
  if (activePolicies.length !== collect("policyId").length) throw new Error("Journal postings require active policies.");
  for (const [index, line] of request.lines.entries()) {
    const basis = { evidenceId: line.evidenceId ?? request.evidenceId, factId: line.factId ?? request.factId, decisionId: line.decisionId ?? request.decisionId, policyId: line.policyId ?? request.policyId, approvalEventId: line.approvalEventId ?? request.approvalEventId };
    if (!hasPostingBasis(basis)) throw new Error(`Journal line ${index + 1} needs approved evidence, fact, decision, approval event, or active policy.`);
  }
}

/**
 * The only Phase-1 write path for authoritative journals. It validates the
 * proposed entry before writing, verifies all accounts/entities are owned by
 * the company, rejects closed periods, and refreshes deterministic reporting
 * only after the posting transaction commits.
 */
export async function postApprovedJournalWith(tx: import("./db-executor").DbTransaction, companyId: string, request: JournalPostingRequest) {
  const validation = validateJournalEntry({ idempotencyKey: request.idempotencyKey, postingDate: request.postingDate, period: request.period, lines: request.lines });
  if (!validation.valid) throw new Error(validation.errors.join(" "));
    const basis = request.basis ?? "actual";
    if (basis === "scenario" && !request.scenarioId) throw new Error("Scenario journal entries require a scenario.");
    if (request.scenarioId && !(await tx.select({ id: scenarios.id }).from(scenarios).where(and(eq(scenarios.id, request.scenarioId), eq(scenarios.companyId, companyId))).limit(1))[0]) throw new Error("Scenario must belong to the company.");
    if (request.reversalOfEntryId) {
      const [original] = await tx.select({ companyId: journalEntries.companyId, basis: journalEntries.basis, scenarioId: journalEntries.scenarioId, status: journalEntries.status }).from(journalEntries).where(eq(journalEntries.id, request.reversalOfEntryId)).limit(1);
      if (!original || original.companyId !== companyId) throw new Error("Reversal entry must belong to the company.");
      if (original.status !== "posted") throw new Error("Only posted journal entries may be reversed.");
      if (original.basis !== basis || original.scenarioId !== (request.scenarioId ?? null)) throw new Error("A reversal must preserve the original entry basis and scenario.");
    }
    const [existing] = await tx.select({ id: journalBatches.id }).from(journalBatches).where(and(eq(journalBatches.companyId, companyId), eq(journalBatches.idempotencyKey, request.idempotencyKey))).limit(1);
    if (existing) {
      const [entry] = await tx.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.batchId, existing.id)).limit(1);
      const [proposal] = await tx.select({ id: postingProposals.id }).from(postingProposals).where(and(eq(postingProposals.companyId, companyId), eq(postingProposals.externalKey, request.idempotencyKey))).limit(1);
      if (!entry || !proposal) throw new Error("Existing journal batch is incomplete.");
      return { batchId: existing.id, entryId: entry.id, proposalId: proposal.id, idempotent: true };
    }
    const [period] = await tx.select({ status: reportingPeriods.status }).from(reportingPeriods).where(and(eq(reportingPeriods.companyId, companyId), eq(reportingPeriods.month, request.period))).limit(1);
    if (period?.status === "closed" && !["journal_adjustment", "journal_reversal"].includes(request.source)) throw new Error(`Reporting period ${request.period} is closed; only an explicit adjustment or reversal may affect it.`);
    const accountIds = [...new Set(request.lines.map((line) => line.accountId))];
    const accounts = await tx.select({ id: chartAccounts.id, accountType: chartAccounts.accountType }).from(chartAccounts).where(and(eq(chartAccounts.companyId, companyId), inArray(chartAccounts.id, accountIds), eq(chartAccounts.active, "Y")));
    if (accounts.length !== accountIds.length) throw new Error("Every journal line must use an active account owned by the company.");
    const activityErrors = validatePostingActivity(request.activity, accounts.map((account) => account.accountType), request.policyId);
    if (activityErrors.length) throw new Error(activityErrors.join(" "));
    const entityIds = [...new Set([request.entityId, ...request.lines.map((line) => line.entityId)].filter((value): value is string => Boolean(value)))];
    const legalEntities = await tx.select({ id: entities.id }).from(entities).where(and(eq(entities.companyId, companyId), eq(entities.type, "legal_entity")));
    if (entityIds.length) {
      const rows = await tx.select({ id: entities.id }).from(entities).where(and(eq(entities.companyId, companyId), eq(entities.type, "legal_entity"), inArray(entities.id, entityIds)));
      if (rows.length !== entityIds.length) throw new Error("Every journal entity must be a legal entity owned by the company.");
    }
    if (basis !== "elimination" && legalEntities.length && request.lines.some((line) => !line.entityId && !request.entityId)) throw new Error("Every non-elimination journal line must name a legal entity once the company has legal entities.");
    const nativeLines = request.lines.filter((line) => line.transactionCurrency || line.transactionDebitMinor || line.transactionCreditMinor || line.fxRateId);
    if (nativeLines.length) {
      for (const [index, line] of request.lines.entries()) {
        const hasNative = Boolean(line.transactionCurrency || line.transactionDebitMinor || line.transactionCreditMinor || line.fxRateId);
        if (!hasNative) continue;
        if (!line.transactionCurrency || line.transactionDebitMinor === undefined || line.transactionCreditMinor === undefined || !line.fxRateId) throw new Error(`Journal line ${index + 1} must include transaction currency, both native amounts, and an approved FX rate.`);
        if (!/^[A-Z]{3}$/.test(line.transactionCurrency) || !/^\d+$/.test(line.transactionDebitMinor) || !/^\d+$/.test(line.transactionCreditMinor)) throw new Error(`Journal line ${index + 1} has invalid native-currency amounts.`);
      }
      const rateIds = [...new Set(nativeLines.map((line) => line.fxRateId!).filter(Boolean))];
      const rates = await tx.select({ id: fxRates.id, rateSetId: fxRates.rateSetId, fromCurrency: fxRates.fromCurrency, toCurrency: fxRates.toCurrency, rateType: fxRates.rateType, effectiveDate: fxRates.effectiveDate, numerator: fxRates.numerator, denominator: fxRates.denominator, rateSetStatus: fxRateSets.status }).from(fxRates).innerJoin(fxRateSets, eq(fxRates.rateSetId, fxRateSets.id)).where(and(eq(fxRates.companyId, companyId), eq(fxRateSets.companyId, companyId), inArray(fxRates.id, rateIds)));
      if (rates.length !== rateIds.length) throw new Error("Every FX rate must belong to the company.");
      const rateById = new Map(rates.map((rate) => [rate.id, rate]));
      for (const [index, line] of request.lines.entries()) {
        if (!line.fxRateId || !line.transactionCurrency || line.transactionDebitMinor === undefined || line.transactionCreditMinor === undefined) continue;
        const rate = rateById.get(line.fxRateId)!;
        if (rate.rateSetStatus !== "approved" || !["spot", "average", "closing", "historical"].includes(rate.rateType)) throw new Error(`Journal line ${index + 1} requires an approved FX rate.`);
        const selected = selectApprovedFxRate([{ ...rate, rateSetStatus: "approved", rateType: rate.rateType as "spot" | "average" | "closing" | "historical" }], { fromCurrency: line.transactionCurrency, toCurrency: line.currency, rateType: rate.rateType as "spot" | "average" | "closing" | "historical", asOfDate: request.postingDate });
        const expectedDebit = convertMinorAtFxRate(line.transactionDebitMinor, selected); const expectedCredit = convertMinorAtFxRate(line.transactionCreditMinor, selected);
        if (expectedDebit.status !== "ready" || expectedCredit.status !== "ready" || expectedDebit.convertedMinor !== line.debitMinor || expectedCredit.convertedMinor !== line.creditMinor) throw new Error(`Journal line ${index + 1} functional amount does not match its approved FX rate.`);
      }
    }
    await verifyProvenanceOwnership(companyId, request, tx);
    const [batch] = await tx.insert(journalBatches).values({ companyId, label: request.label, source: request.source, status: "posted", idempotencyKey: request.idempotencyKey, sourceId: request.sourceId, decisionId: request.decisionId, approvalEventId: request.approvalEventId, postedAt: new Date() }).returning({ id: journalBatches.id });
    const [entry] = await tx.insert(journalEntries).values({ companyId, batchId: batch!.id, entityId: request.entityId, postingDate: request.postingDate, period: request.period, memo: request.memo, status: "posted", basis, scenarioId: request.scenarioId, reversalOfEntryId: request.reversalOfEntryId, postedAt: new Date() }).returning({ id: journalEntries.id });
    await tx.insert(journalLines).values(request.lines.map((line) => ({ companyId, entryId: entry!.id, accountId: line.accountId, entityId: line.entityId ?? request.entityId, currency: line.currency, debitMinor: line.debitMinor, creditMinor: line.creditMinor, transactionCurrency: line.transactionCurrency, transactionDebitMinor: line.transactionDebitMinor, transactionCreditMinor: line.transactionCreditMinor, fxRateId: line.fxRateId, sourceId: line.sourceId ?? request.sourceId, sourceRowId: line.sourceRowId ?? request.sourceRowId, evidenceId: line.evidenceId ?? request.evidenceId, factId: line.factId ?? request.factId, decisionId: line.decisionId ?? request.decisionId, policyId: line.policyId ?? request.policyId, approvalEventId: line.approvalEventId ?? request.approvalEventId, sourceLocation: line.sourceLocation, externalKey: line.externalKey, memo: line.memo }))); 
    const [existingProposal] = await tx.select({ id: postingProposals.id }).from(postingProposals).where(and(eq(postingProposals.companyId, companyId), eq(postingProposals.externalKey, request.idempotencyKey))).limit(1);
    const proposal = existingProposal
      ? (await tx.update(postingProposals).set({ status: "posted", journalEntryId: entry!.id, approvedAt: new Date(), updatedAt: new Date() }).where(eq(postingProposals.id, existingProposal.id)).returning({ id: postingProposals.id }))[0]
      : (await tx.insert(postingProposals).values({ companyId, sourceId: request.sourceId, sourceRowId: request.sourceRowId, evidenceId: request.evidenceId, factId: request.factId, decisionId: request.decisionId, policyId: request.policyId, externalKey: request.idempotencyKey, proposalJson: JSON.stringify(request), rationale: "Validated deterministic journal posting.", confidence: "1.0", status: "posted", journalEntryId: entry!.id, approvedAt: new Date() }).returning({ id: postingProposals.id }))[0];
    if (!proposal) throw new Error("Unable to record posting proposal.");
    // Inside the posting transaction: a rolled-back entry must leave no record
    // of having been posted. A reversal is itself a posting, but reads as its
    // own action in the log.
    const reversing = Boolean(request.reversalOfEntryId) || request.source === "journal_reversal";
    await recordAudit(tx, { companyId, actorUserId: request.actorUserId ?? null, via: request.actorUserId ? "ui" : "worker", action: reversing ? "journal.reversed" : "journal.posted", entityType: "journal_entry", entityId: entry!.id, summary: `${reversing ? "Reversed" : "Posted"} journal ${request.label} in ${request.period}`, after: { batchId: batch!.id, label: request.label, source: request.source, period: request.period, basis } });
    return { batchId: batch!.id, entryId: entry!.id, proposalId: proposal.id, idempotent: false };
}
export async function postApprovedJournal(companyId: string, request: JournalPostingRequest): Promise<JournalPostingResult> {
  const committed = await getDatabase().transaction((tx) => postApprovedJournalWith(tx, companyId, request));
  const reversing = Boolean(request.reversalOfEntryId) || request.source === "journal_reversal";
  // An idempotent retry must not create a second calculation revision.
  const calculationRun = committed.idempotent || request.deferRefresh ? null : await refreshCurrentCalculationRun(companyId, { journalPeriods: [request.period], cause: { kind: reversing ? "journal_reversed" : "journal_posted", subjectType: "journal_entry", subjectId: committed.entryId, actorUserId: request.actorUserId ?? null, via: request.actorUserId ? "ui" : "worker" } });
  return { ...committed, calculationRun };
}
