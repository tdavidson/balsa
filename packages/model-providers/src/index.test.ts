import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createModelProvider, OpenAIProvider, OpenRouterProvider } from "./index";

describe("model providers", () => {
  it("uses the OpenAI Responses API without provider leakage", async () => {
    const create = vi.fn().mockResolvedValue({ output_text: "Ready" });
    const provider = new OpenAIProvider("test-model", "test-key", {
      responses: { create } as never,
    });

    await expect(
      provider.generateText({ messages: [{ role: "user", content: "Hello" }] }),
    ).resolves.toBe("Ready");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "test-model", store: false }),
    );
  });

  it("validates structured OpenRouter output at the boundary", async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }),
        { status: 200 },
      ),
    );
    const provider = new OpenRouterProvider("test-model", "test-key", request);

    await expect(
      provider.generateStructured({
        name: "result",
        messages: [{ role: "user", content: "Return JSON" }],
        schema: z.object({ ok: z.boolean() }),
        jsonSchema: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
          additionalProperties: false,
        },
      }),
    ).resolves.toEqual({ ok: true });
  });
});

describe("reasoning effort", () => {
  it("passes reasoning effort to the OpenAI Responses API", async () => {
    const create = vi.fn().mockResolvedValue({ output_text: "Ready" });
    const provider = new OpenAIProvider("test-model", "test-key", { responses: { create } as never }, { effort: "high" });
    await provider.generateText({ messages: [{ role: "user", content: "Hello" }] });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ reasoning: { effort: "high" } }));
  });

  it("omits reasoning when no effort is chosen", async () => {
    const create = vi.fn().mockResolvedValue({ output_text: "Ready" });
    const provider = new OpenAIProvider("test-model", "test-key", { responses: { create } as never });
    await provider.generateText({ messages: [{ role: "user", content: "Hello" }] });
    expect(create.mock.calls[0]![0]).not.toHaveProperty("reasoning");
  });

  it("passes reasoning effort to OpenRouter", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }));
    const provider = new OpenRouterProvider("test-model", "test-key", request, { effort: "low" });
    await provider.generateText({ messages: [{ role: "user", content: "Hello" }] });
    const body = JSON.parse((request.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.reasoning).toEqual({ effort: "low" });
  });

  it("lets a request override the configured model", () => {
    const provider = createModelProvider({ MODEL_PROVIDER: "openrouter", MODEL_NAME: "auto", OPENROUTER_API_KEY: "k" }, { model: "openai/gpt-5", effort: "medium" });
    expect(provider.model).toBe("openai/gpt-5");
    const fallback = createModelProvider({ MODEL_PROVIDER: "openrouter", MODEL_NAME: "auto", OPENROUTER_API_KEY: "k" }, { model: "auto" });
    expect(fallback.model).toBe("auto");
  });
});
