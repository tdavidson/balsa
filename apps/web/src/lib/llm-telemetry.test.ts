import { describe, expect, it, vi } from "vitest";
import { recordLlmRun } from "./llm-telemetry";

describe("recordLlmRun", () => {
  it("stores request shape and lengths, never request content", async () => {
    const values = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: "run" }]) });
    const db = { insert: vi.fn().mockReturnValue({ values }) } as never;
    const provider = { name: "openai", model: "test", getLastUsage: () => null } as never;
    await recordLlmRun({ db, provider, operation: "test", request: { message: "private bank detail", nested: { content: "sensitive" } }, response: "ok" });
    const payload = values.mock.calls[0]?.[0] as { requestJson: string };
    expect(payload.requestJson).not.toContain("private bank detail");
    expect(payload.requestJson).not.toContain("sensitive");
    expect(payload.requestJson).toContain("characters");
  });
});
