import { z } from "zod";
import type { CashOccurrence, CashOccurrenceResult, CashSettlementInput } from "@nevermodel/finance-engine";
import type { loadRecurrenceReview } from "./forecast-recurrence";
import type { loadCashCoverage } from "./cash-coverage";

export const reviewDate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/).refine((value) => { const time = Date.parse(`${value}T00:00:00Z`); return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value; });
const amount = z.string().regex(/^[1-9]\d{0,29}$/);
const reason = z.string().trim().min(1).max(2000);
const identity = { requestKey: z.uuid(), reason };
const replacement = { ...identity, driverId: z.uuid(), replacementHash: z.string().regex(/^[a-f0-9]{64}$/), amountMinor: amount, expectedDay: z.number().int().min(1).max(31), endMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), acknowledgePreservedOccurrences: z.literal(true) };
export const reconciliationCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview_recurrence_replacement"), ...replacement }).strict(),
  z.object({ action: z.literal("replace_recurrence"), ...replacement }).strict(),
  z.object({ ...identity, action: z.literal("approve_history"), candidateKey: z.string().min(1).max(2000), candidateHash: z.string().regex(/^[a-f0-9]{64}$/), endMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), independentObligation: z.literal(true) }).strict(),
  z.object({ ...identity, action: z.literal("approve_recurrence"), driverId: z.uuid(), definitionHash: z.string().regex(/^[a-f0-9]{64}$/), expectedVersion: z.number().int().nonnegative(), endMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), independentObligation: z.literal(true) }).strict(),
  z.object({ ...identity, action: z.literal("pause_recurrence"), policyId: z.uuid(), expectedVersion: z.number().int().positive() }).strict(),
  z.object({ ...identity, action: z.literal("capture"), candidateKey: z.string().min(1).max(2000), candidateHash: z.string().regex(/^[a-f0-9]{64}$/), independentObligation: z.literal(true), autoMatch: z.boolean().default(false) }).strict(),
  z.object({ ...identity, action: z.literal("allocate"), occurrenceId: z.uuid(), expectedVersion: z.number().int().positive(), actualEntryId: z.uuid(), amountMinor: amount, final: z.boolean() }).strict(),
  z.object({ ...identity, action: z.literal("revoke_allocation"), allocationId: z.uuid(), occurrenceId: z.uuid(), expectedVersion: z.number().int().positive() }).strict(),
  z.object({ ...identity, action: z.literal("revise_occurrence"), occurrenceId: z.uuid(), expectedVersion: z.number().int().positive(), expectedDate: reviewDate, amountMinor: amount, status: z.enum(["active", "cancelled"]), final: z.boolean(), autoMatch: z.boolean().default(false) }).strict(),
  z.object({ ...identity, action: z.literal("coverage"), accountId: z.uuid(), startDate: reviewDate, throughDate: reviewDate, status: z.enum(["complete", "partial", "revoked"]), evidenceId: z.uuid().optional(), previewHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);
export type ReconciliationCommand = z.infer<typeof reconciliationCommand>;
export type OccurrenceCandidate = { capturedOccurrenceId?: string; definition: Omit<CashOccurrence, "id" | "version">; hash: string; eligibleAutoMatchFactId: string | null };
export type ForecastReconciliationData = {
  companyId: string; currency: string; throughDate: string; asOfMonth: string;
  candidates: OccurrenceCandidate[];
  recovery: { driverId: string; hash: string; label: string; reason: string; startMonth: string; oldAmountMinor: string; currentAmountMinor: string; oldSourceLineIds: string[]; currentSourceLines: import("@nevermodel/finance-engine").PostedJournalLine[]; preservedOccurrenceIds: string[] }[];
  matchSuggestions: ReturnType<typeof import("@nevermodel/finance-engine").suggestCashMatches>;
  recurrence: Awaited<ReturnType<typeof loadRecurrenceReview>>;
  settlement: CashSettlementInput;
  results: CashOccurrenceResult[];
  exceptions: { driverId: string; reason: string }[];
  coverage: Awaited<ReturnType<typeof loadCashCoverage>>;
  coveragePreviewHash: string;
};
