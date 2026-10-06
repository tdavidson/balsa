import { z } from "zod";
import { operatingModelSchema } from "./operating-model-contract";
export const operatingDraftDefinition = z.object({ prompt: z.string().max(8000), model: operatingModelSchema.nullable(), selectedCase: z.string().max(64) }).strict();
export const saveOperatingDraftSchema = z.object({ id: z.uuid(), revision: z.number().int().min(0), definition: operatingDraftDefinition, experimentId: z.uuid().nullable() }).strict();
export type OperatingDraftDefinition = z.infer<typeof operatingDraftDefinition>;
