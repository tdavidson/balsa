import "server-only";
import { z } from "zod";
import { createModelProvider, type ModelOverrides } from "@finance/model-providers";

export type ModelOption = { value: string; label: string };

// Ids verified against the OpenRouter catalog and OpenAI model list on 2026-09-05.
// Keep this provider-neutral so every compatible OpenAI model remains selectable
// when requests are routed through OpenRouter.
const openAiOptions: ModelOption[] = [
  { value: "gpt-6-astra", label: "GPT-6 Astra" },
  { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { value: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { value: "gpt-5.2", label: "GPT-5.2" },
  { value: "gpt-5.1", label: "GPT-5.1" },
  { value: "gpt-5", label: "GPT-5" },
  { value: "gpt-5-mini", label: "GPT-5 mini" },
  { value: "gpt-4.1", label: "GPT-4.1" },
  { value: "o3", label: "o3" },
  { value: "o4-mini", label: "o4-mini" },
];

const openRouterOpenAiOptions = openAiOptions.map((option) => ({
  ...option,
  value: `openai/${option.value}`,
}));

const defaultOptions: Record<string, ModelOption[]> = {
  openrouter: [
    { value: "anthropic/claude-opus-5", label: "Claude Opus 5" },
    { value: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5" },
    { value: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5" },
    ...openRouterOpenAiOptions,
    { value: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
    { value: "google/gemini-3.5-flash", label: "Gemini 3.5 Flash" },
    { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { value: "deepseek/deepseek-v3.2", label: "DeepSeek V3.2" },
    { value: "deepseek/deepseek-r1", label: "DeepSeek R1" },
    { value: "moonshotai/kimi-k2", label: "Kimi K2" },
    { value: "qwen/qwen3-235b-a22b", label: "Qwen3 235B" },
    { value: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick" },
  ],
  openai: openAiOptions,
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
