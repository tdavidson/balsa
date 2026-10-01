import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { chartAccounts, fxRateSets, fxRates, fxRemeasurementEntries, fxTranslationPolicies, getDatabase, journalBatches, journalEntries, journalLineLineage, journalLines, reportingPeriods } from "@finance/database";
import { remeasureForeignMonetaryBalance, validateJournalEntry, type FxRateObservation } from "@balsa/finance-engine";
import { loadPostedJournalLines } from "@/lib/journal-ledger";
import { refreshCurrentCalculationRun } from "@/lib/refresh-calculation-run";

type RemeasurementPreviewLine = {
  key: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  entityId?: string;
  currency: string;
  debitMinor: string;
  creditMinor: string;
  upstreamLineIds: string[];
  rateId: string;
};

export type FxRemeasurementPreview = {
  status: "ready" | "blocked" | "nothing_to_remeasure";
  policy: { id: string; name: string; fxGainLossAccountId: string } | null;
  entries: Array<{ key: string; entityId?: string; currency: string; transactionCurrency: string; nativeNetMinor: string; currentFunctionalNetMinor: string; lines: RemeasurementPreviewLine[] }>;
  blockers: string[];
};

const net = (debit: string | undefined, credit: string | undefined) => BigInt(debit ?? "0") - BigInt(credit ?? "0");
const keyPart = (value: string | undefined) => value ?? "company";

/**
 * Re-measurement is deliberately limited to explicit chart accounts. A native
 * amount by itself is not proof that an account is monetary.
 */
export async function loadFxRemeasurementPreview(companyId: string, period: string): Promise<FxRemeasurementPreview> {
  const db = getDatabase();
  const [policies, accounts, rateRows, postedLines] = await Promise.all([
    db.select().from(fxTranslationPolicies).where(and(eq(fxTranslationPolicies.companyId, companyId), eq(fxTranslationPolicies.status, "approved"))).limit(1),
    db.select({ id: chartAccounts.id, code: chartAccounts.code, name: chartAccounts.name, fxMonetary: chartAccounts.fxMonetary }).from(chartAccounts).where(and(eq(chartAccounts.companyId, companyId), eq(chartAccounts.active, "Y"))),
    db.select({ id: fxRates.id, rateSetId: fxRates.rateSetId, fromCurrency: fxRates.fromCurrency, toCurrency: fxRates.toCurrency, rateType: fxRates.rateType, effectiveDate: fxRates.effectiveDate, numerator: fxRates.numerator, denominator: fxRates.denominator, sourceId: fxRates.sourceId, evidenceId: fxRates.evidenceId, factId: fxRates.factId, sourceLocation: fxRates.sourceLocation, rateSetStatus: fxRateSets.status }).from(fxRates).innerJoin(fxRateSets, eq(fxRates.rateSetId, fxRateSets.id)).where(and(eq(fxRates.companyId, companyId), eq(fxRateSets.companyId, companyId))),
    loadPostedJournalLines(companyId, period),
  ]);
  const policy = policies[0] ?? null;
  if (!policy) return { status: "blocked", policy: null, entries: [], blockers: ["An approved FX translation policy with an FX gain/loss account is required before remeasurement."] };
  const gainLoss = accounts.find((account) => account.id === policy.fxGainLossAccountId);
  if (!gainLoss) return { status: "blocked", policy: { id: policy.id, name: policy.name, fxGainLossAccountId: policy.fxGainLossAccountId }, entries: [], blockers: ["The approved FX policy's gain/loss account is inactive or unavailable."] };
  const monetary = new Map(accounts.filter((account) => account.fxMonetary === "Y").map((account) => [account.id, account]));
  const groups = new Map<string, { account: NonNullable<typeof gainLoss>; entityId?: string; currency: string; transactionCurrency: string; nativeNetMinor: bigint; functionalNetMinor: bigint; upstreamLineIds: string[] }>();
  for (const line of postedLines) {
    const account = monetary.get(line.accountId);
    if (!account || !line.transactionCurrency || line.transactionDebitMinor === undefined || line.transactionCreditMinor === undefined || line.transactionCurrency === line.currency) continue;
    const key = [line.accountId, keyPart(line.entityId), line.currency, line.transactionCurrency].join(":");
    const current = groups.get(key) ?? { account, ...(line.entityId ? { entityId: line.entityId } : {}), currency: line.currency, transactionCurrency: line.transactionCurrency, nativeNetMinor: 0n, functionalNetMinor: 0n, upstreamLineIds: [] };
    current.nativeNetMinor += net(line.transactionDebitMinor, line.transactionCreditMinor);
    current.functionalNetMinor += net(line.debitMinor, line.creditMinor);
    current.upstreamLineIds.push(line.id);
    groups.set(key, current);
  }
  const rates: FxRateObservation[] = rateRows.map((rate) => ({ id: rate.id, rateSetId: rate.rateSetId, fromCurrency: rate.fromCurrency, toCurrency: rate.toCurrency, rateType: rate.rateType as FxRateObservation["rateType"], effectiveDate: rate.effectiveDate, numerator: rate.numerator, denominator: rate.denominator, rateSetStatus: rate.rateSetStatus as FxRateObservation["rateSetStatus"], ...(rate.sourceId ? { sourceId: rate.sourceId } : {}), ...(rate.evidenceId ? { evidenceId: rate.evidenceId } : {}), ...(rate.factId ? { factId: rate.factId } : {}), ...(rate.sourceLocation ? { sourceLocation: rate.sourceLocation } : {}) }));
  const entries: FxRemeasurementPreview["entries"] = [];
  const blockers: string[] = [];
  for (const [key, group] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (group.nativeNetMinor === 0n) continue;
    const result = remeasureForeignMonetaryBalance({ account: { accountId: group.account.id, accountCode: group.account.code, accountName: group.account.name, ...(group.entityId ? { entityId: group.entityId } : {}), currency: group.currency }, transactionCurrency: group.transactionCurrency, nativeNetMinor: group.nativeNetMinor.toString(), currentFunctionalNetMinor: group.functionalNetMinor.toString(), period, rates, fxGainLossAccount: { id: gainLoss.id, code: gainLoss.code, name: gainLoss.name } });
    if (result.status === "blocked") { blockers.push(...result.reasons.map((reason) => `${group.account.code}: ${reason}`)); continue; }
    if (!result.adjustment) continue;
    entries.push({ key, ...(group.entityId ? { entityId: group.entityId } : {}), currency: group.currency, transactionCurrency: group.transactionCurrency, nativeNetMinor: group.nativeNetMinor.toString(), currentFunctionalNetMinor: group.functionalNetMinor.toString(), lines: result.adjustment.map((line, index) => ({ key: `${key}:${index}`, accountId: line.accountId, accountCode: line.accountCode, accountName: line.accountName, ...(line.entityId ? { entityId: line.entityId } : {}), currency: line.currency, debitMinor: line.debitMinor, creditMinor: line.creditMinor, upstreamLineIds: group.upstreamLineIds, rateId: result.rateId })) });
  }
  return { status: blockers.length ? "blocked" : entries.length ? "ready" : "nothing_to_remeasure", policy: { id: policy.id, name: policy.name, fxGainLossAccountId: policy.fxGainLossAccountId }, entries, blockers: [...new Set(blockers)] };
}

/** Posts the exact deterministic preview with source-policy and upstream-line lineage. */
export async function postFxRemeasurement(input: { companyId: string; userId: string; period: string; entityId?: string }) {
  const preview = await loadFxRemeasurementPreview(input.companyId, input.period);
  if (preview.status !== "ready" || !preview.policy) return { ok: false as const, blockers: preview.blockers.length ? preview.blockers : ["There is no FX remeasurement adjustment to post."] };
  const candidates = preview.entries.filter((entry) => entry.entityId === input.entityId);
  if (!candidates.length) return { ok: false as const, blockers: ["No FX remeasurement adjustment exists for this entity and period."] };
  const validation = validateJournalEntry({ idempotencyKey: `fx-remeasurement:${input.period}:${input.entityId ?? "company"}:${preview.policy.id}`, postingDate: `${input.period}-01`, period: input.period, lines: candidates.flatMap((entry) => entry.lines) });
  if (!validation.valid) return { ok: false as const, blockers: validation.errors };
  const db = getDatabase();
  const committed = await db.transaction(async (tx) => {
    const entityClause = input.entityId ? eq(fxRemeasurementEntries.entityId, input.entityId) : isNull(fxRemeasurementEntries.entityId);
    const [existing] = await tx.select({ journalEntryId: fxRemeasurementEntries.journalEntryId }).from(fxRemeasurementEntries).where(and(eq(fxRemeasurementEntries.companyId, input.companyId), eq(fxRemeasurementEntries.period, input.period), eq(fxRemeasurementEntries.policyId, preview.policy!.id), entityClause)).limit(1);
    if (existing) return { entryId: existing.journalEntryId, idempotent: true };
    const [reportingPeriod] = await tx.select({ status: reportingPeriods.status }).from(reportingPeriods).where(and(eq(reportingPeriods.companyId, input.companyId), eq(reportingPeriods.month, input.period))).limit(1);
    if (reportingPeriod?.status === "closed") throw new Error(`Reporting period ${input.period} is closed; reverse or post an explicit adjustment instead.`);
    const [policy] = await tx.select().from(fxTranslationPolicies).where(and(eq(fxTranslationPolicies.id, preview.policy!.id), eq(fxTranslationPolicies.companyId, input.companyId), eq(fxTranslationPolicies.status, "approved"))).limit(1);
    if (!policy) throw new Error("The FX policy is no longer approved.");
    const key = `fx-remeasurement:${input.period}:${input.entityId ?? "company"}:${policy.id}`;
    const [batch] = await tx.insert(journalBatches).values({ companyId: input.companyId, label: `FX remeasurement · ${input.period}`, source: "fx_remeasurement", status: "posted", idempotencyKey: key, sourceId: policy.sourceId, decisionId: undefined, approvalEventId: policy.approvalEventId, postedAt: new Date() }).returning({ id: journalBatches.id });
    const [entry] = await tx.insert(journalEntries).values({ companyId: input.companyId, batchId: batch!.id, entityId: input.entityId, postingDate: `${input.period}-01`, period: input.period, memo: `Closing-rate remeasurement under approved FX policy ${policy.name}.`, status: "posted", basis: "adjustment", postedAt: new Date() }).returning({ id: journalEntries.id });
    for (const candidate of candidates) for (const line of candidate.lines) {
      const [posted] = await tx.insert(journalLines).values({ companyId: input.companyId, entryId: entry!.id, accountId: line.accountId, entityId: line.entityId, currency: line.currency, debitMinor: line.debitMinor, creditMinor: line.creditMinor, fxRateId: line.rateId === "identity" ? undefined : line.rateId, sourceId: policy.sourceId, evidenceId: policy.evidenceId, factId: policy.factId, approvalEventId: policy.approvalEventId, sourceLocation: `FX remeasurement ${input.period}; rate ${line.rateId}; native ${candidate.transactionCurrency} ${candidate.nativeNetMinor}`, externalKey: line.key, memo: "Closing-rate foreign monetary balance remeasurement" }).returning({ id: journalLines.id });
      await tx.insert(journalLineLineage).values(line.upstreamLineIds.map((upstreamJournalLineId) => ({ companyId: input.companyId, journalLineId: posted!.id, upstreamJournalLineId, relationship: "fx_remeasurement" })));
    }
    await tx.insert(fxRemeasurementEntries).values({ companyId: input.companyId, period: input.period, entityId: input.entityId, policyId: policy.id, journalEntryId: entry!.id, approvedByUserId: input.userId });
    return { entryId: entry!.id, idempotent: false };
  });
  const calculationRun = committed.idempotent ? null : await refreshCurrentCalculationRun(input.companyId, { journalPeriods: [input.period], cause: { kind: "fx_changed", subjectType: "fx_remeasurement", subjectId: input.period, actorUserId: input.userId, via: "ui" } });
  return { ok: true as const, ...committed, calculationRun };
}
