import { z } from "zod";
export const operatingBindings = z
  .array(
    z
      .object({
        nodeId: z.string().min(1).max(64),
        reason: z.string().max(1000).optional(),
        factId: z.uuid(),
        from: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
        unit: z.string().min(1).max(60),
      })
      .strict(),
  )
  .min(1)
  .max(40);
export type OperatingBinding = z.infer<typeof operatingBindings>[number];
export const operatingConnectionCommand = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("suggest_sources"),
      experimentId: z.uuid().nullable(),
      connectionId: z.uuid().nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal("connect"),
      experimentId: z.uuid(),
      bindings: operatingBindings,
      acknowledgeUnits: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal("preview_update"),
      connectionId: z.uuid(),
      bindings: operatingBindings.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("reject_update"),
      connectionId: z.uuid(),
      experimentId: z.uuid(),
      reason: z.string().trim().min(1).max(1000),
    })
    .strict(),
  z
    .object({
      action: z.literal("save_update"),
      bindings: operatingBindings.optional(),
      connectionId: z.uuid(),
      previewToken: z.string().regex(/^[a-f0-9]{64}$/),
      requestKey: z.uuid(),
      acknowledgeAssumptions: z.literal(true),
    })
    .strict(),
]);
