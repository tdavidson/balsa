import { z } from "zod";
import { isValidMonth, type CashGoal, type CashGoalEvaluation, type CashGoalBridge, type ForecastRun, type ForecastRunInput, type PostedJournalLine } from "@nevermodel/finance-engine";
import type { JournalCoverage } from "./journal-coverage";

const month = z.string().refine(isValidMonth, "Use YYYY-MM.");
export const cashGoalSchema = z.object({
  name: z.string().trim().min(1).max(120),
  metric: z.enum(["ending_cash_at_month", "minimum_month_end_cash"]),
  currency: z.string().regex(/^[A-Z]{3}$/),
  startMonth: month, endMonth: month,
  manualConditions: z.array(z.object({ id: z.uuid(), label: z.string().trim().min(1).max(200) }).strict()).max(20).refine((items) => new Set(items.map((item) => item.id)).size === items.length && new Set(items.map((item) => item.label)).size === items.length, "Conditions must be distinct.").optional(),
  targetMinor: z.string().regex(/^(0|[1-9]\d{0,29})$/),
}).strict().refine((goal) => goal.startMonth <= goal.endMonth && Number(goal.endMonth.slice(0, 4)) * 12 + Number(goal.endMonth.slice(5)) - Number(goal.startMonth.slice(0, 4)) * 12 - Number(goal.startMonth.slice(5)) <= 120, "Use an ordered interval of at most 120 months.");
export const goalReviewCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set_primary_goal"), goalId: z.uuid().nullable(), expectedVersion: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.literal("create_goal"), definition: cashGoalSchema, status: z.enum(["draft", "active"]).default("active"), reason: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ action: z.literal("revise_goal"), goalId: z.uuid(), expectedVersion: z.number().int().positive(), definition: cashGoalSchema, status: z.enum(["draft", "active", "archived"]), reason: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ action: z.literal("save_snapshot"), kind: z.enum(["plan", "review"]), goalVersionId: z.uuid(), planId: z.uuid().optional(), name: z.string().trim().min(1).max(120), previewToken: z.string().regex(/^[a-f0-9]{64}$/), requestKey: z.uuid(), acknowledgeLimitations: z.literal(true) }).strict(),
]);
export type GoalReviewCommand = z.infer<typeof goalReviewCommand>;
export type GoalVersion = { id: string; goalId: string; version: number; status: "draft" | "active" | "archived"; definition: CashGoal; reason: string; actorUserId: string | null; createdAt: string };
export type GoalOutlook = {
  schemaVersion: 1;
  companyId: string;
  financialStateRevision: string;
  capturedAt: string;
  input: ForecastRunInput;
  output: ForecastRun;
  actualJournalLines: PostedJournalLine[];
  coverage: JournalCoverage[];
  cashCoverage?: Awaited<ReturnType<typeof import("./cash-coverage").loadCashCoverage>> | undefined;
  openingCash?: import("@nevermodel/finance-engine").OpeningCashReview | undefined;
  limitations: string[];
  lineage: { journalLines: unknown[]; evidence: unknown[] };
};
export type GoalComparison = { baselineId: string; baselineName: string; baselineKind: "plan" | "review"; bridge: CashGoalBridge };
export type SavedGoalSnapshot = { comparisons?: { plan: GoalComparison; previousReview?: GoalComparison }; goal: GoalVersion; outlook: GoalOutlook; evaluation: CashGoalEvaluation; calculationRunId: string; acknowledgedLimitations: true };
export type SnapshotSummary = { id: string; kind: "plan" | "review"; name: string; goalVersionId: string; planId: string | null; actorUserId: string | null; createdAt: string; evaluation: CashGoalEvaluation };
export type GoalReviewData = {
  companyId: string;
  goals: GoalVersion[];
  primaryGoalId: string | null;
  preferenceVersion: number;
  snapshots: SnapshotSummary[];
  outlook: Pick<GoalOutlook, "capturedAt" | "financialStateRevision" | "limitations" | "openingCash" | "cashCoverage"> & { asOfMonth: string; horizon: ForecastRun["horizon"]; currency: string };
  previewToken: string;
  evaluations: Record<string, CashGoalEvaluation>;
  changes: Record<string, string | null>;
  assumptions: ForecastRunInput["drivers"];
  forecastMonths: ForecastRun["months"];
};
