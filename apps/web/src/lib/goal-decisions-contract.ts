import { z } from "zod";
import type { CashGoalBridge, CashGoalEvaluation, ForecastRun, ForecastRunInput } from "@nevermodel/finance-engine";
import type { GoalOutlook, GoalVersion } from "./goal-review-contract";
import type { ScenarioDetail } from "./scenario-changes";

const conditionReview = z.object({ goalVersionId: z.uuid(), conditionId: z.uuid(), status: z.enum(["pending", "met", "failed"]), reason: z.string().trim().max(1000) }).strict().refine((item) => item.status === "pending" || item.reason.length > 0, "Reviewed conditions require a reason.");
export const decisionSelection = z.object({ scenarioId: z.uuid(), planId: z.uuid(), conditionReviews: z.array(conditionReview).max(400).default([]) }).strict();
const save = { previewToken: z.string().regex(/^[a-f0-9]{64}$/), requestKey: z.uuid(), name: z.string().trim().min(1).max(120), reason: z.string().trim().min(1).max(2000), acknowledgeLimitations: z.literal(true) };
export const goalDecisionCommand = z.discriminatedUnion("action", [
  decisionSelection.extend({ action: z.literal("preview") }),
  decisionSelection.extend({ action: z.literal("save_evaluation"), ...save }),
  decisionSelection.extend({ action: z.literal("approve"), ...save }),
  z.object({ action: z.literal("preview_outcome"), reviewId: z.uuid() }).strict(),
  z.object({ action: z.literal("save_outcome"), reviewId: z.uuid(), ...save }).strict(),
]);
export type DecisionSelection = z.infer<typeof decisionSelection>;
export type GoalDecisionPreview = {
  companyId: string; previewToken: string; scenario: ScenarioDetail; planId: string; primaryGoalVersionId: string;
  base: GoalOutlook; scenarioInput: ForecastRunInput; scenarioRun: ForecastRun; goals: GoalVersion[];
  evaluations: { goalVersionId: string; before: CashGoalEvaluation; after: CashGoalEvaluation; deltaMinor: string | null }[];
  conditions: { goalVersionId: string; conditionId: string; label: string; status: "pending" | "met" | "failed"; reason: string }[];
  monthlyChanges: { month: string; beforeMinor: string | null; afterMinor: string; deltaMinor: string | null }[];
  attribution?: import("./decision-attribution").DecisionAttribution;
  blockers: string[];
};
export type GoalDecisionOutcome = { companyId: string; previewToken: string; parentId: string; scenarioId: string; planId: string; goal: GoalVersion; outlook: GoalOutlook; bridge: CashGoalBridge; notice: string };
export type GoalDecisionSnapshot = { type: "evaluation" | "applied"; preview: GoalDecisionPreview; decisionIds: string[]; appliedOutlook?: GoalOutlook; reason: string } | { type: "outcome"; outcome: GoalDecisionOutcome; reason: string };
export type GoalDecisionHistory = { id: string; name: string; kind: string; scenarioId: string; goalVersionId: string; parentId: string | null; createdAt: string };
