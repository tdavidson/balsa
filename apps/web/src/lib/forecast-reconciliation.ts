import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { cashCoverageRecords, economicItems, forecastEntryTemplates, evidence, forecastOccurrences, forecastRecurrencePolicies, forecastReviewCommands, forecastSettlementAllocations, getDatabase, recordAudit, setCompanyScopeSql } from "@finance/database";
import { addMonths, suggestCashMatches, buildForecastedCloses, buildForecastRun, cashMovement, compatibleCashMovement, stableJson, recurrenceDefinition, type CashOccurrence } from "@balsa/finance-engine";
import { historyRuleVersion, historySourceHash } from "./forecast-history";
import { loadRecurrenceReview } from "./forecast-recurrence";
import type { DbExecutor } from "./db-executor";
import { loadForecastInputs } from "./forecast-inputs";
import { loadPostedJournalLines } from "./journal-ledger";
import { cashCoverageHash, loadCashCoverage, loadCoverageSourceState } from "./cash-coverage";
import { enqueueCalculationRefreshWith, processEnqueuedCalculationRefresh } from "./refresh-calculation-run";
import { reconciliationCommand, type ForecastReconciliationData, type OccurrenceCandidate } from "./forecast-reconciliation-contract";

export class ReconciliationError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const hash = (value: unknown) => createHash("sha256").update(stableJson(value)).digest("hex");

export async function loadForecastReconciliationWith(db: DbExecutor, companyId: string, now = new Date()): Promise<ForecastReconciliationData> {
  const input = await loadForecastInputs(companyId, { db, now });
  const settlement = input.settlement!;
  const { settlement: _settlement, ...unreconciled } = input; void _settlement;
  const baseline = buildForecastRun(unreconciled);
  const run = buildForecastRun(input);
  const lines = (await loadPostedJournalLines(companyId, now.toISOString().slice(0, 7), db)).filter((line) => !line.postingDate || line.postingDate <= settlement.throughDate);
  const eligibleIds = new Set(settlement.actuals.filter((entry) => !entry.reversed).map((entry) => entry.id));
  const inferred = buildForecastedCloses(lines.filter((line) => eligibleIds.has(line.entryId ?? line.id)), now.toISOString().slice(0, 7));
  const captured = new Set(settlement.occurrences.map((item) => item.key));
  const groups = new Map<string, typeof lines>();
  for (const line of [...baseline.projectedLines.filter((line) => line.period === now.toISOString().slice(0, 7)), ...inferred.projectedLines]) {
    const key = line.entryId ?? line.id;
    if (!captured.has(key)) groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  const historyDrivers = await db.select({ origin: economicItems.forecastOrigin }).from(economicItems).where(eq(economicItems.companyId, companyId));
  const approvedPatterns = new Set(historyDrivers.flatMap((item) => item.origin ? [(item.origin as { patternKey: string }).patternKey] : []));
  const candidates: OccurrenceCandidate[] = [];
  for (const [key, rows] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    if (key.startsWith("forecasted-close:") && approvedPatterns.has(key.slice(0, -8))) continue;
    const movement = cashMovement(rows); if (!movement || movement.currency !== input.currency || rows.some((row) => !input.accounts.some((account) => account.accountId === row.accountId))) continue;
    const driver = input.drivers.find((item) => key === `projection:${item.id}:base:${rows[0]!.period}`);
    const definition: Omit<CashOccurrence, "id" | "version"> = { key, label: driver?.label ?? rows[0]?.memo ?? "Expected cash activity", origin: driver ? "driver" : "history", driverId: driver?.id ?? null, originalMonth: rows[0]!.period, expectedDate: movement.postingDate, amountMinor: movement.amountMinor, originalAmountMinor: movement.amountMinor, currency: movement.currency, status: "active", final: false, lines: rows, sourceLineIds: inferred.sourceLineIds[key] ?? [] };
    const eligibleAutoMatchFactId = driver?.cadence === "once" ? driver.factId ?? null : null;
    candidates.push({ definition, hash: hash({ definition, eligibleAutoMatchFactId }), eligibleAutoMatchFactId });
  }
  // A preserved historical occurrence remains intact; its recurring schedule starts next month.
  for (const occurrence of settlement.occurrences.filter((item) => item.origin === "history" && !item.driverId && item.originalMonth === settlement.throughDate.slice(0, 7) && !approvedPatterns.has(item.key.slice(0, -8)))) {
    const { id, version, ...definition } = occurrence;
    candidates.push({ definition, capturedOccurrenceId: id, hash: hash({ definition, id, version }), eligibleAutoMatchFactId: null });
  }
  const recurrence = await loadRecurrenceReview(db, companyId, input, settlement.throughDate, captured);
  const recovery = recurrence.states.filter((state) => state.state === "stale").flatMap((state) => {
    const driver = input.drivers.find((item) => item.id === state.policy.driverId); if (!driver) return [];
    const preserved = settlement.occurrences.filter((item) => item.driverId === driver.id);
    const currentMonth = settlement.throughDate.slice(0, 7); const lastCaptured = preserved.map((item) => item.originalMonth).filter((month) => month >= currentMonth).sort().at(-1);
    const startMonth = lastCaptured ? addMonths(lastCaptured, 1) : currentMonth;
    const oldSourceLineIds = state.policy.definition.history?.sourceLineIds ?? [];
    const currentSourceLines = lines.filter((line) => oldSourceLineIds.includes(line.id));
    return [{ driverId: driver.id, label: driver.label, reason: state.reason ?? "The approved schedule changed.", startMonth, oldAmountMinor: state.policy.definition.driver.amountMinor, currentAmountMinor: driver.amountMinor, oldSourceLineIds, currentSourceLines, preservedOccurrenceIds: preserved.map((item) => item.id), hash: hash({ input, driver, state, startMonth, currentSourceLines, preserved }) }];
  });
  const coverage = await loadCashCoverage(db, companyId, lines, `${input.asOfMonth}-01`, settlement.throughDate);
  return { recovery, matchSuggestions: suggestCashMatches(settlement, run.settlements ?? []), recurrence, companyId, currency: input.currency, throughDate: settlement.throughDate, asOfMonth: input.asOfMonth, candidates, settlement, results: run.settlements ?? [], exceptions: run.exceptions, coverage, coveragePreviewHash: hash({ throughDate: settlement.throughDate, lines, coverage, sourceState: await loadCoverageSourceState(db, companyId) }) };
}

export function loadForecastReconciliation(companyId: string, now = new Date()) {
  return getDatabase().transaction(async (tx) => { await tx.execute(setCompanyScopeSql(companyId)); return loadForecastReconciliationWith(tx, companyId, now); }, { isolationLevel: "repeatable read" });
}

export async function executeForecastReconciliation(companyId: string, raw: unknown, actorUserId: string | null, now = new Date()) {
  const parsed = reconciliationCommand.safeParse(raw);
  if (!parsed.success) throw new ReconciliationError("Invalid review request. Check dates, amounts, and required fields.");
  const command = parsed.data;
  const committed = await getDatabase().transaction(async (tx) => {
    await tx.execute(setCompanyScopeSql(companyId));
    await tx.execute(sql`select pg_advisory_xact_lock(7406, hashtext(${companyId}))`);
    const requestHash = hash(command);
    const [prior] = await tx.select().from(forecastReviewCommands).where(and(eq(forecastReviewCommands.companyId, companyId), eq(forecastReviewCommands.requestKey, command.requestKey)));
    if (prior) {
      if (prior.requestHash !== requestHash) throw new ReconciliationError("Request key already used for a different review.", 409);
      return { result: prior.result, receipt: null, reused: true };
    }
    const review = await loadForecastReconciliationWith(tx, companyId, now);
    let subjectId: string; let before: unknown = null; let after: unknown;
    if (command.action === "preview_recurrence_replacement" || command.action === "replace_recurrence") {
      const candidate = review.recovery.find((item) => item.driverId === command.driverId);
      if (!candidate || candidate.hash !== command.replacementHash) throw new ReconciliationError("The stale schedule or its sources changed. Refresh the recovery review.", 409);
      if (command.endMonth < candidate.startMonth || command.endMonth > addMonths(review.throughDate.slice(0, 7), 23)) throw new ReconciliationError("Choose an end month within the next 24 months and after preserved occurrences.");
      const input = await loadForecastInputs(companyId, { db: tx, now }); const driver = input.drivers.find((item) => item.id === command.driverId)!;
      const policy = review.recurrence.states.find((item) => item.policy.driverId === driver.id)!.policy;
      const newId = command.action === "replace_recurrence" ? randomUUID() : `replacement:${driver.id}`;
      const replacement = { id: newId, label: `${driver.label} — reviewed replacement`, itemType: driver.itemType, direction: driver.direction, amountMinor: command.amountMinor, cadence: "monthly" as const, effectiveFrom: candidate.startMonth, effectiveTo: command.endMonth, expectedDay: command.expectedDay, ...(driver.category ? { category: driver.category } : {}), ...(driver.templateId ? { templateId: driver.templateId } : {}) };
      const changedInput = { ...input, drivers: [...input.drivers.map((item) => item.id === driver.id ? { ...item, effectiveTo: addMonths(candidate.startMonth, -1) } : item), replacement], recurrence: (input.recurrence ?? []).filter((item) => item.policy.id !== policy.id) };
      const definition = recurrenceDefinition(changedInput, newId);
      if (!definition) throw new ReconciliationError("The replacement needs a supported, unambiguous cash accounting template.", 422);
      const output = buildForecastRun(changedInput);
      if (command.action === "preview_recurrence_replacement") return { result: { companyId, candidate, replacement, before: buildForecastRun(input).months, after: output.months, exceptions: output.exceptions }, receipt: null, reused: false };
      const amount = BigInt(command.amountMinor);
      await tx.update(economicItems).set({ effectiveTo: addMonths(candidate.startMonth, -1), updatedAt: now }).where(and(eq(economicItems.companyId, companyId), eq(economicItems.id, driver.id)));
      await tx.update(forecastRecurrencePolicies).set({ status: "paused", version: policy.version + 1, actorUserId }).where(and(eq(forecastRecurrencePolicies.companyId, companyId), eq(forecastRecurrencePolicies.id, policy.id)));
      await tx.insert(economicItems).values({ id: newId, companyId, type: driver.itemType, direction: driver.direction, label: replacement.label, amount: `${amount / 100n}.${String(amount % 100n).padStart(2, "0")}`, cadence: "monthly", effectiveFrom: candidate.startMonth, effectiveTo: command.endMonth, expectedDay: command.expectedDay, category: driver.category ?? null, forecastTemplateId: driver.templateId ?? null, basis: "assumed", accountingTreatment: "cash", status: "confirmed", rationale: `Reviewed replacement for ${driver.id}: ${command.reason}` });
      const nextInput = await loadForecastInputs(companyId, { db: tx, now }); const option = (await loadRecurrenceReview(tx, companyId, nextInput, review.throughDate, new Set(review.settlement.occurrences.map((item) => item.key)))).options.find((item) => item.driverId === newId);
      if (!option) throw new ReconciliationError("Replacement approval could not reproduce its schedule.", 409);
      const [saved] = await tx.insert(forecastRecurrencePolicies).values({ companyId, driverId: newId, status: "active", startMonth: candidate.startMonth, endMonth: command.endMonth, definition: option.definition, definitionHash: option.hash, actorUserId }).returning();
      subjectId = saved!.id; before = { driver, policy, candidate }; after = { replacement, policyId: subjectId, preservedOccurrenceIds: candidate.preservedOccurrenceIds, manualAssumption: true };
    } else if (command.action === "approve_history") {
      const candidate = review.candidates.find((item) => item.definition.key === command.candidateKey && item.definition.origin === "history");
      if (!candidate || candidate.hash !== command.candidateHash) throw new ReconciliationError("The historical suggestion changed. Refresh before approving.", 409);
      const definition = candidate.definition; const month = review.throughDate.slice(0, 7);
      const startMonth = candidate.capturedOccurrenceId ? addMonths(month, 1) : month;
      if (command.endMonth < startMonth || command.endMonth > addMonths(month, 23)) throw new ReconciliationError("Approve a history schedule for up to 24 months.");
      const movement = cashMovement(definition.lines)!;
      const cash = definition.lines.find((line) => line.accountType === "asset" && /cash/i.test(line.statementLine ?? line.accountName))!;
      const direction = movement.debitAccountId === cash.accountId ? "receipt" as const : "spend" as const;
      const itemType = direction === "receipt" ? "agreement" as const : "obligation" as const;
      const driverId = randomUUID();
      const patternKey = definition.key.slice(0, -8);
      const existing = await tx.select({ id: economicItems.id }).from(economicItems).where(and(eq(economicItems.companyId, companyId), sql`${economicItems.forecastOrigin}->>'patternKey' = ${patternKey}`));
      if (existing.length) throw new ReconciliationError("This pattern already has a reviewed driver. Renew or revise that schedule instead.", 409);
      const lines = await loadPostedJournalLines(companyId, month, tx);
      const supporting = lines.filter((line) => definition.sourceLineIds.includes(line.id));
      if (supporting.length !== definition.sourceLineIds.length) throw new ReconciliationError("Supporting history is no longer available.", 409);
      const sourceIds = new Set(supporting.flatMap((line) => line.provenance?.sourceId ? [line.provenance.sourceId] : []));
      const approvedDocuments = await tx.select({ id: evidence.id, sourceId: evidence.sourceId, status: evidence.status, identityStatus: evidence.identityStatus, hash: evidence.sourceHash }).from(evidence).where(eq(evidence.companyId, companyId));
      const documents = approvedDocuments.filter((document) => document.sourceId && sourceIds.has(document.sourceId)).sort((a, b) => a.id.localeCompare(b.id));
      if (documents.some((document) => document.status !== "approved" || document.identityStatus !== "approved")) throw new ReconciliationError("Supporting documents need approved evidence and identity.", 422);
      const origin = { approvalHash: hash(documents), patternKey, sourceLineIds: definition.sourceLineIds, sourceHash: historySourceHash(supporting), expectedDay: Number(definition.expectedDate.slice(8)), ruleVersion: historyRuleVersion };
      const [template] = await tx.insert(forecastEntryTemplates).values({ companyId, name: `Reviewed history: ${definition.label}`.slice(0, 160), itemType, direction, category: `history:${driverId}`, debitAccountId: movement.debitAccountId, creditAccountId: movement.creditAccountId }).returning();
      const amount = BigInt(definition.amountMinor);
      await tx.insert(economicItems).values({ id: driverId, companyId, type: itemType, direction, label: definition.label, amount: `${amount / 100n}.${String(amount % 100n).padStart(2, "0")}`, cadence: "monthly", effectiveFrom: startMonth, effectiveTo: command.endMonth, status: "confirmed", basis: "assumed", accountingTreatment: "cash", category: `history:${driverId}`, forecastTemplateId: template!.id, forecastOrigin: origin });
      const input = await loadForecastInputs(companyId, { db: tx, now });
      const option = (await loadRecurrenceReview(tx, companyId, input, review.throughDate, new Set(review.settlement.occurrences.map((item) => item.key)))).options.find((item) => item.driverId === driverId);
      if (!option) throw new ReconciliationError("The historical treatment cannot be captured safely.", 422);
      const [policy] = await tx.insert(forecastRecurrencePolicies).values({ companyId, driverId, version: 1, status: "active", startMonth, endMonth: command.endMonth, definition: option.definition, definitionHash: option.hash, actorUserId }).returning();
      subjectId = policy!.id; after = { driverId, policyId: policy!.id, origin, estimated: true };
    } else if (command.action === "approve_recurrence") {
      const option = review.recurrence.options.find((item) => item.driverId === command.driverId);
      if (!option || option.hash !== command.definitionHash) throw new ReconciliationError("The recurring schedule changed or is unsupported. Refresh before approving.", 409);
      const current = review.recurrence.states.find((item) => item.policy.driverId === command.driverId)?.policy;
      if ((current?.version ?? 0) !== command.expectedVersion) throw new ReconciliationError("The recurrence policy changed. Refresh before approving.", 409);
      const startMonth = review.throughDate.slice(0, 7);
      if (command.endMonth < startMonth || command.endMonth > addMonths(startMonth, 23)) throw new ReconciliationError("Approve a recurring capture window of up to 24 months, beginning this month.");
      const values = { companyId, driverId: command.driverId, version: (current?.version ?? 0) + 1, status: "active", startMonth, endMonth: command.endMonth, definition: option.definition, definitionHash: option.hash, actorUserId };
      const [saved] = current ? await tx.update(forecastRecurrencePolicies).set(values).where(and(eq(forecastRecurrencePolicies.companyId, companyId), eq(forecastRecurrencePolicies.id, current.id))).returning() : await tx.insert(forecastRecurrencePolicies).values(values).returning();
      subjectId = saved!.id; before = current ?? null; after = values;
    } else if (command.action === "pause_recurrence") {
      const policy = review.recurrence.states.find((item) => item.policy.id === command.policyId)?.policy;
      if (!policy) throw new ReconciliationError("Recurrence policy not found for this company.", 404);
      if (policy.version !== command.expectedVersion) throw new ReconciliationError("The recurrence policy changed. Refresh before pausing.", 409);
      before = policy;
      const [saved] = await tx.update(forecastRecurrencePolicies).set({ status: "paused", version: policy.version + 1, actorUserId }).where(and(eq(forecastRecurrencePolicies.companyId, companyId), eq(forecastRecurrencePolicies.id, policy.id))).returning();
      subjectId = saved!.id; after = saved;
    } else if (command.action === "capture") {
      const candidate = review.candidates.find((item) => item.definition.key === command.candidateKey);
      if (!candidate || candidate.capturedOccurrenceId || candidate.hash !== command.candidateHash) throw new ReconciliationError("This expectation changed or was already captured. Refresh before approving.", 409);
      if (command.autoMatch && !candidate.eligibleAutoMatchFactId) throw new ReconciliationError("Automatic matching requires a one-off driver with a specific source fact.");
      const definition = { ...candidate.definition, autoMatchFactId: command.autoMatch ? candidate.eligibleAutoMatchFactId : null };
      const [saved] = await tx.insert(forecastOccurrences).values({ companyId, occurrenceKey: definition.key, definition, actorUserId }).returning();
      subjectId = saved!.id; after = definition;
    } else if (command.action === "coverage") {
      if (command.startDate > command.throughDate || command.throughDate > review.throughDate) throw new ReconciliationError("Coverage must be an ordered date range through today or earlier.");
      if (command.previewHash !== review.coveragePreviewHash) throw new ReconciliationError("Activity or coverage changed. Refresh before recording coverage.", 409);
      const account = review.coverage.accounts.find((item) => item.id === command.accountId);
      if (!account) throw new ReconciliationError("Cash account not found for this company.", 404);
      let evidenceHash: string | null = null;
      if (command.evidenceId) {
        const [source] = await tx.select({ hash: evidence.sourceHash }).from(evidence).where(and(eq(evidence.companyId, companyId), eq(evidence.id, command.evidenceId), eq(evidence.status, "approved")));
        if (!source) throw new ReconciliationError("Supporting evidence must be approved and belong to this company.", 404);
        evidenceHash = source.hash ?? "unhashed";
      }
      const lines = await loadPostedJournalLines(companyId, review.throughDate.slice(0, 7), tx);
      const sourceState = await loadCoverageSourceState(tx, companyId);
      const [saved] = await tx.insert(cashCoverageRecords).values({ companyId, accountId: account.id, startDate: command.startDate, throughDate: command.throughDate, status: command.status, reason: command.reason, evidenceId: command.evidenceId ?? null, evidenceHash, ledgerHash: cashCoverageHash(lines, account.id, command.startDate, command.throughDate, sourceState, [account.name, ...(account.bankAccountIdentifier ? [account.bankAccountIdentifier] : [])]), actorUserId }).returning();
      subjectId = saved!.id; after = { ...command, ledgerHash: saved!.ledgerHash };
    } else {
      const occurrence = review.settlement.occurrences.find((item) => item.id === command.occurrenceId);
      if (!occurrence) throw new ReconciliationError("Expectation not found for this company.", 404);
      if (occurrence.version !== command.expectedVersion) throw new ReconciliationError("This expectation changed. Refresh before reviewing it.", 409);
      before = occurrence; const next = { ...occurrence };
      const result = review.results.find((item) => item.id === occurrence.id)!;
      if (command.action === "allocate") {
        if (occurrence.status !== "active" || occurrence.final && !result.invalidAllocationIds.length) throw new ReconciliationError("Reopen the expectation before allocating more actuals.", 409);
        const actual = review.settlement.actuals.find((item) => item.id === command.actualEntryId);
        if (!actual) throw new ReconciliationError("Eligible actual cash entry not found for this company.", 404);
        if (!compatibleCashMovement(occurrence, actual)) throw new ReconciliationError("Actual and expectation must share currency, entity, and approved cash/accounting treatment. Transfers, FX, and split journals need separate review.");
        const used = review.settlement.allocations.filter((allocation) => !allocation.revoked && allocation.actualEntryId === actual.id).reduce((sum, allocation) => sum + BigInt(allocation.amountMinor), 0n);
        if (used + BigInt(command.amountMinor) > BigInt(actual.amountMinor)) throw new ReconciliationError("The allocation exceeds the actual entry's remaining amount.");
        if (BigInt(result.allocatedMinor) + BigInt(command.amountMinor) > BigInt(occurrence.amountMinor)) throw new ReconciliationError("The allocation exceeds the expectation. Revise its amount explicitly to record an excess payment.");
        await tx.insert(forecastSettlementAllocations).values({ companyId, occurrenceId: occurrence.id, actualEntryId: actual.id, amountMinor: command.amountMinor });
        next.final = command.final;
      } else if (command.action === "revoke_allocation") {
        const [allocation] = await tx.update(forecastSettlementAllocations).set({ revoked: true }).where(and(eq(forecastSettlementAllocations.companyId, companyId), eq(forecastSettlementAllocations.id, command.allocationId), eq(forecastSettlementAllocations.occurrenceId, occurrence.id), eq(forecastSettlementAllocations.revoked, false))).returning();
        if (!allocation) throw new ReconciliationError("Active allocation not found.", 404);
        next.final = false;
      } else {
        if (BigInt(command.amountMinor) < BigInt(result.allocatedMinor)) throw new ReconciliationError("The revised amount cannot be less than valid allocations. Use final settlement to record a shortfall.");
        next.amountMinor = command.amountMinor; next.expectedDate = command.expectedDate; next.status = command.status; next.final = command.final;
        next.autoMatchFactId = command.autoMatch ? occurrence.autoMatchFactId ?? null : null;
        // Revise both sides together; no independent recognition schedule is changed.
        next.lines = next.lines.map((line) => ({ ...line, debitMinor: BigInt(line.debitMinor) > 0n ? command.amountMinor : "0", creditMinor: BigInt(line.creditMinor) > 0n ? command.amountMinor : "0" }));
      }
      const { id, version, ...definition } = next;
      await tx.update(forecastOccurrences).set({ definition, version: version + 1, actorUserId }).where(and(eq(forecastOccurrences.companyId, companyId), eq(forecastOccurrences.id, id), eq(forecastOccurrences.version, version)));
      subjectId = id; after = { ...definition, version: version + 1 };
    }
    await recordAudit(tx, { companyId, actorUserId, via: "ui", action: `forecast.${command.action}`, entityType: command.action === "coverage" ? "cash_coverage" : command.action === "replace_recurrence" || command.action === "approve_history" || command.action === "approve_recurrence" || command.action === "pause_recurrence" ? "forecast_recurrence_policy" : "forecast_occurrence", entityId: subjectId, summary: command.reason, before, after: { state: after, command }, requestId: command.requestKey });
    const receipt = await enqueueCalculationRefreshWith(tx, companyId, { rebuildJournalGraphs: false, cause: { kind: command.action === "coverage" ? "coverage_reviewed" : "expectation_reviewed", subjectType: "forecast_review", subjectId, actorUserId, via: "ui" } });
    const result = { id: subjectId, financialStateRevision: receipt.financialStateRevision };
    await tx.insert(forecastReviewCommands).values({ companyId, requestKey: command.requestKey, requestHash, result });
    return { result, receipt, reused: false };
  }, { isolationLevel: "repeatable read" });
  const refresh = committed.receipt ? await processEnqueuedCalculationRefresh(committed.receipt, now) : null;
  return { ...committed.result as Record<string, unknown>, reused: committed.reused, calculationStatus: refresh?.forecastStatus ?? "unchanged" };
}
