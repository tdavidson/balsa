import { z } from "zod";
import { operatingModelSchema } from "./operating-model-contract";
import { triggerRuleSchema } from "./operating-triggers-contract";
const decimal = z.string().regex(/^-?\d{1,12}(\.\d{1,6})?$/);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const studySourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("draft"),
      model: operatingModelSchema,
      caseId: z.string().min(1).max(64),
    })
    .strict(),
  z.object({ kind: z.literal("prediction"), predictionId: z.uuid() }).strict(),
]);
export const conditionalPlanSchema = z
  .object({
    startMonth: month,
    branches: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            name: z.string().trim().min(1).max(120),
            rationale: z.string().trim().min(1).max(1000),
            rule: triggerRuleSchema,
            leadMonths: z.number().int().min(0).max(6),
            minimumMonths: z.number().int().min(1).max(12),
            inputs: z
              .array(
                z
                  .object({ nodeId: z.string().min(1).max(64), value: decimal })
                  .strict(),
              )
              .min(1)
              .max(12),
            switchCost: z
              .object({
                nodeId: z.string().min(1).max(64),
                value: decimal.refine((v) => Number(v) >= 0),
              })
              .strict()
              .nullable(),
            limits: z
              .array(
                z
                  .object({
                    nodeId: z.string().min(1).max(64),
                    maximum: decimal,
                  })
                  .strict(),
              )
              .max(8),
          })
          .strict(),
      )
      .min(1)
      .max(6),
  })
  .strict();
const parameter = z
  .object({
    nodeId: z.string().min(1).max(64),
    from: month,
    low: decimal,
    high: decimal,
    group: z.string().max(64),
    inverse: z.boolean(),
    rationale: z.string().trim().min(1).max(1000),
  })
  .strict();
const entity = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(120),
    cohort: z.string().min(1).max(120),
    nodeIds: z.array(z.string().min(1).max(64)).min(1).max(80),
  })
  .strict();
export const studyDefinition = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("conditional"),
      source: studySourceSchema,
      plan: conditionalPlanSchema,
      mode: z.enum(["simulated", "observed"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("calibration"),
      source: z
        .object({ kind: z.literal("prediction"), predictionId: z.uuid() })
        .strict(),
      binding: z
        .object({
          horizonMonths: z.number().int().min(1).max(24),
          metricId: z.string().trim().min(1).max(100),
          nodeId: z.string().min(1).max(64),
          unit: z.string().min(1).max(60),
          scope: z.string().trim().min(1).max(240),
          aggregation: z.enum([
            "monthly_total",
            "month_end",
            "monthly_average",
          ]),
          reason: z.string().trim().min(1).max(1000),
          additionalVersions: z
            .array(
              z
                .object({
                  predictionId: z.uuid(),
                  nodeId: z.string().min(1).max(64),
                })
                .strict(),
            )
            .max(11),
          acknowledgeComparable: z.literal(true),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("simulation"),
      source: studySourceSchema,
      settings: z
        .object({
          seed: z.number().int().min(0).max(4294967295),
          count: z.number().int().min(16).max(64),
          parameters: z.array(parameter).min(1).max(8),
          entities: z.array(entity).max(12),
        })
        .strict(),
      cashFloorMinor: z.string().regex(/^-?\d{1,18}$/),
      alternatives: z
        .array(
          z
            .object({
              name: z.string().min(1).max(120),
              model: operatingModelSchema,
              caseId: z.string().min(1).max(64),
            })
            .strict(),
        )
        .max(2),
      valuation: z
        .object({
          nodeId: z.string().min(1).max(64),
          annualDiscount: decimal,
          terminalMultiple: decimal,
          priceMinor: z.string().regex(/^\d{1,18}$/),
          basis: z.string().trim().min(1).max(1000),
        })
        .strict()
        .nullable(),
    })
    .strict(),
]);
export const operatingStudyCommand = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("preview"), definition: studyDefinition })
    .strict(),
  z
    .object({
      action: z.literal("save"),
      definition: studyDefinition,
      name: z.string().trim().min(1).max(120),
      previewToken: z.string().regex(/^[a-f0-9]{64}$/),
      requestKey: z.uuid(),
      acknowledgeAssumptions: z.literal(true),
    })
    .strict(),
]);
export type OperatingStudyDefinition = z.infer<typeof studyDefinition>;
export type OperatingStudySource = z.infer<typeof studySourceSchema>;
