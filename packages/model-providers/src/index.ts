import OpenAI from "openai";
import { z, type ZodType } from "zod";

export type ModelMessage = {
  role: "user" | "assistant";
  content: string;
};

export type GenerateRequest = {
  instructions?: string;
  messages: ModelMessage[];
};

export type StructuredRequest<T> = GenerateRequest & {
  name: string;
  schema: ZodType<T>;
  jsonSchema: Record<string, unknown>;
};

export type ModelUsage = {
  model: string;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  totalTokens?: number | undefined;
  cost?: number | undefined;
  latencyMs: number;
};

/** Reasoning effort hint. Ignored by models that do not reason. */
export type ReasoningEffort = "low" | "medium" | "high";

export type ModelOptions = {
  effort?: ReasoningEffort | undefined;
};

function parseStructuredContent<T>(content: string, schema: ZodType<T>) {
  const candidate = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return schema.parse(JSON.parse(candidate));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Model returned malformed structured JSON${error.message.match(/position \d+/)?.[0] ? ` (${error.message.match(/position \d+/)![0]})` : ""}. Please retry with a shorter request.`);
    throw error;
  }
}

export interface ModelProvider {
  readonly name: "openai" | "openrouter";
  readonly model: string;
  getLastUsage(): ModelUsage | null;
  generateText(request: GenerateRequest): Promise<string>;
  generateStructured<T>(request: StructuredRequest<T>): Promise<T>;
}

type OpenAIResponsesClient = Pick<OpenAI, "responses">;

export class OpenAIProvider implements ModelProvider {
  readonly name = "openai" as const;
  private lastUsage: ModelUsage | null = null;
  private readonly client: OpenAIResponsesClient;

  private readonly options: ModelOptions;

  constructor(
    readonly model: string,
    apiKey: string,
    client?: OpenAIResponsesClient,
    options: ModelOptions = {},
  ) {
    this.client = client ?? new OpenAI({ apiKey });
    this.options = options;
  }

  private reasoning() {
    return this.options.effort ? { reasoning: { effort: this.options.effort } } : {};
  }

  async generateText(request: GenerateRequest) {
    const started = Date.now();
    const response = await this.client.responses.create({
      model: this.model,
      ...this.reasoning(),
      ...(request.instructions ? { instructions: request.instructions } : {}),
      input: request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      store: false,
    });
    this.lastUsage = { model: this.model, inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens, totalTokens: response.usage?.total_tokens, latencyMs: Date.now() - started };

    return response.output_text;
  }

  async generateStructured<T>(request: StructuredRequest<T>) {
    const started = Date.now();
    const response = await this.client.responses.create({
      model: this.model,
      ...this.reasoning(),
      ...(request.instructions ? { instructions: request.instructions } : {}),
      input: request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: request.name,
          schema: request.jsonSchema,
          strict: true,
        },
      },
    });
    this.lastUsage = { model: this.model, inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens, totalTokens: response.usage?.total_tokens, latencyMs: Date.now() - started };

    return parseStructuredContent(response.output_text, request.schema);
  }

  getLastUsage() { return this.lastUsage; }
}

const openRouterResponse = z.object({
  choices: z.array(
    z.object({
      message: z.object({ content: z.string() }),
    }),
  ).min(1),
  usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional(), total_tokens: z.number().optional(), cost: z.number().optional() }).optional(),
});

export class OpenRouterProvider implements ModelProvider {
  readonly name = "openrouter" as const;
  private lastUsage: ModelUsage | null = null;

  constructor(
    readonly model: string,
    private readonly apiKey: string,
    private readonly request: typeof fetch = fetch,
    private readonly options: ModelOptions = {},
  ) {}

  private async complete(
    request: GenerateRequest,
    responseFormat?: Record<string, unknown>,
  ) {
    const started = Date.now();
    const response = await this.request(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            ...(request.instructions
              ? [{ role: "system", content: request.instructions }]
              : []),
            ...request.messages,
          ],
          ...(this.options.effort ? { reasoning: { effort: this.options.effort } } : {}),
          ...(responseFormat ? { response_format: responseFormat } : {}),
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`OpenRouter request failed with status ${response.status}`);
    }

    const parsed = openRouterResponse.parse(await response.json());
    this.lastUsage = { model: this.model, inputTokens: parsed.usage?.prompt_tokens, outputTokens: parsed.usage?.completion_tokens, totalTokens: parsed.usage?.total_tokens, cost: parsed.usage?.cost, latencyMs: Date.now() - started };
    return parsed.choices[0]!.message.content;
  }

  getLastUsage() { return this.lastUsage; }

  generateText(request: GenerateRequest) {
    return this.complete(request);
  }

  async generateStructured<T>(request: StructuredRequest<T>) {
    const content = await this.complete(request, {
      type: "json_schema",
      json_schema: {
        name: request.name,
        strict: true,
        schema: request.jsonSchema,
      },
    });

    return parseStructuredContent(content, request.schema);
  }
}

export type ModelProviderEnvironment = {
  MODEL_PROVIDER?: string | undefined;
  MODEL_NAME?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
  OPENROUTER_API_KEY?: string | undefined;
};

export type ModelOverrides = ModelOptions & {
  /** A specific model id, or "auto" to use MODEL_NAME from the environment. */
  model?: string | undefined;
};

export function createModelProvider(
  environment: ModelProviderEnvironment,
  overrides: ModelOverrides = {},
): ModelProvider {
  const provider = environment.MODEL_PROVIDER ?? "openai";
  const model = overrides.model && overrides.model !== "auto" ? overrides.model : environment.MODEL_NAME;
  if (!model) throw new Error("MODEL_NAME is required");
  const options: ModelOptions = { effort: overrides.effort };

  if (provider === "openai") {
    if (!environment.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required when MODEL_PROVIDER=openai");
    }
    return new OpenAIProvider(model, environment.OPENAI_API_KEY, undefined, options);
  }

  if (provider === "openrouter") {
    if (!environment.OPENROUTER_API_KEY) {
      throw new Error(
        "OPENROUTER_API_KEY is required when MODEL_PROVIDER=openrouter",
      );
    }
    return new OpenRouterProvider(model, environment.OPENROUTER_API_KEY, fetch, options);
  }

  throw new Error(`Unsupported MODEL_PROVIDER: ${provider}`);
}
