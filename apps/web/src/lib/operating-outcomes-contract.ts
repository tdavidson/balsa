import { z } from "zod";
import type {
  OperatingModel,
  OperatingRun,
  OperatingCashBinding,
} from "@balsa/finance-engine";

export type OperatingPredictionSnapshot = {
  schemaVersion: 1;
  forecastStart: string;
  name: string;
  approvedAt: string;
  preservedAt: string;
  model: OperatingModel;
  operating: OperatingRun;
  cashBindings: OperatingCashBinding[];
  retainedCashBindings?: OperatingCashBinding[];
};
export type OperatingObservationDefinition = {
  withdrawn?: boolean;
  value: string;
  unit: string;
  scope: string;
  coverage: "partial" | "complete";
  reason: string;
  source: {
    factId: string;
    evidenceId: string;
    label: string;
    sourceName: string;
    sourceLocation: string | null;
    currency: string | null;
    sourceHash: string | null;
    value: string;
    factUpdatedAt: string;
    evidenceUpdatedAt: string;
  };
};
const save = { requestKey: z.uuid() };
export const operatingOutcomeCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preserve"), reviewId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("withdraw"),
      predictionId: z.uuid(),
      observationId: z.uuid(),
      reason: z.string().trim().min(1).max(1000),
      ...save,
    })
    .strict(),
  z
    .object({
      action: z.literal("observe"),
      predictionId: z.uuid(),
      nodeId: z.string().min(1).max(80),
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
      factId: z.uuid(),
      unit: z.string().min(1).max(80),
      scope: z.string().trim().min(1).max(240),
      coverage: z.enum(["partial", "complete"]),
      reason: z.string().trim().min(1).max(1000),
      expectedObservationId: z.uuid().nullable(),
      acknowledgeMapping: z.literal(true),
      sourceToken: z.string().regex(/^[a-f0-9]{64}$/),
      ...save,
    })
    .strict(),
  z
    .object({
      action: z.literal("save_review"),
      predictionId: z.uuid(),
      previewToken: z.string().regex(/^[a-f0-9]{64}$/),
      reason: z.string().trim().min(1).max(1000),
      ...save,
    })
    .strict(),
]);
