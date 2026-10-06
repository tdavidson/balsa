import { z } from "zod";
import type { OperatingCashBinding } from "@balsa/finance-engine";
const selection = {
  reviewId: z.uuid(),
  inputs: z
    .array(
      z
        .object({
          nodeId: z.string().min(1).max(64),
          month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
          value: z.string().regex(/^-?\d{1,12}(\.\d{1,6})?$/),
          reason: z.string().trim().min(1).max(240),
        })
        .strict(),
    )
    .min(1)
    .max(40),
};
export const operatingPlanCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), ...selection }).strict(),
  z
    .object({
      action: z.literal("save"),
      ...selection,
      name: z.string().trim().min(1).max(120),
      reason: z.string().trim().min(1).max(1000),
      previewToken: z.string().regex(/^[a-f0-9]{64}$/),
      requestKey: z.uuid(),
      acknowledgeCommitments: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal("reject"),
      experimentId: z.uuid(),
      reason: z.string().trim().min(1).max(1000),
    })
    .strict(),
]);
export type OperatingPlanLineage = {
  predictionId: string;
  reviewId: string;
  contextToken: string;
  itemsToken: string;
  settlementToken: string;
  documentsToken: string;
  forecastStart: string;
  retainedBindings: OperatingCashBinding[];
};
