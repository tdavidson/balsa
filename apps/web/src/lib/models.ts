import "server-only";
import { z } from "zod";
import { createModelProvider, type ModelOverrides } from "@finance/model-providers";

export type ModelOption = { value: string; label: string };

const defaultOptions: Record<string, ModelOption[]> = {
  openrouter: [
    { value: "openai/gpt-5", label: "GPT-5" },
    { value: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
    { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  ],
  openai: [
    { value: "gpt-5", label: "GPT-5" },
    { value: "gpt-5-mini", label: "GPT-5 mini" },
    { value: "o3", label: "o3" },
  ],
};

/**
 * Models the composer can choose from. "Auto" always comes first and means
 * MODEL_NAME from the environment. Override the list with
 * MODEL_OPTIONS="Label=model-id,Label=model-id".
 */
export function getModelOptions(): ModelOption[] {
  const provider = process.env.MODEL_PROVIDER ?? "openai";
  const configured = (process.env.MODEL_OPTIONS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [label, value] = entry.split("=").map((part) => part.trim());
      return value ? { label: label!, value } : { label: label!, value: label! };
    });
  const options = configured.length ? configured : (defaultOptions[provider] ?? []);
  return [{ value: "auto", label: "Auto" }, ...options];
}

/** Request fields shared by every route that calls a model. */
export const modelRequestSchema = z.object({
  model: z.string().trim().min(1).max(200).optional(),
  effort: z.enum(["low", "medium", "high"]).optional(),
});

/** Only models on the configured list may be requested; anything else falls back to Auto. */
export function resolveModelOverrides(input: z.infer<typeof modelRequestSchema>): ModelOverrides {
  const allowed = new Set(getModelOptions().map((option) => option.value));
  return {
    model: input.model && allowed.has(input.model) ? input.model : "auto",
    effort: input.effort,
  };
}

export function getModelProvider(overrides: ModelOverrides = {}) {
  return createModelProvider(
    {
      MODEL_PROVIDER: process.env.MODEL_PROVIDER,
      MODEL_NAME: process.env.MODEL_NAME,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    },
    overrides,
  );
}
