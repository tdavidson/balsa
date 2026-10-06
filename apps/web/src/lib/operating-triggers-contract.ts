import { z } from "zod";
import type {
  OperatingTriggerResult,
  OperatingTriggerRule,
} from "@balsa/finance-engine";
import type { OperatingObservationDefinition } from "./operating-outcomes-contract";
const decimal = z.string().regex(/^-?\d{1,12}(\.\d{1,6})?$/);
export const triggerRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("review_date"), dueDate: z.iso.date() }).strict(),
  z
    .object({
      kind: z.literal("threshold"),
      nodeId: z.string().min(1).max(80),
      unit: z.string().min(1).max(80),
      scope: z.string().trim().min(1).max(240),
      measure: z.enum(["observed", "difference"]),
      direction: z.enum(["above", "below"]),
      threshold: decimal,
      tolerance: decimal.refine((v) => Number(v) >= 0),
      consecutiveMonths: z.number().int().min(1).max(6),
      reportingLagMonths: z.number().int().min(0).max(3),
    })
    .strict(),
]);
const common = { predictionId: z.uuid(), requestKey: z.uuid() };
const reason = z.string().trim().min(1).max(1000);
export const operatingTriggerCommand = z.discriminatedUnion("action", [
  z
    .object({
      ...common,
      action: z.literal("create"),
      name: z.string().trim().min(1).max(120),
      rule: triggerRuleSchema,
      replacesId: z.uuid().nullable(),
      reason,
      acknowledgeRule: z.literal(true),
    })
    .strict(),
  z
    .object({ ...common, action: z.literal("evaluate"), ruleId: z.uuid() })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal("transition"),
      reviewId: z.uuid(),
      expectedEventId: z.uuid(),
      status: z.enum(["acknowledged", "snoozed", "resolved"]),
      snoozeUntil: z.iso.date().nullable(),
      reason,
    })
    .strict(),
]);
export type TriggerSnapshot = {
  rule: OperatingTriggerRule;
  name: string;
  ruleId: string;
  predictionId: string;
  evaluatedAt: string;
  result: OperatingTriggerResult;
  evidence: {
    observationId: string;
    month: string;
    definition: OperatingObservationDefinition;
  }[];
};
export type TriggerReviewStatus =
  | "open"
  | "acknowledged"
  | "snoozed"
  | "resolved"
  | "superseded";
