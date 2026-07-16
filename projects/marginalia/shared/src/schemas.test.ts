import { describe, expect, it } from "vitest";
import {
  CreateHighlightBodySchema,
  ResourceSummarySchema,
  SettingsSchema,
  ThreadStreamEventSchema,
} from "./schemas.js";

describe("schemas smoke test", () => {
  it("parses a valid resource summary", () => {
    const result = ResourceSummarySchema.safeParse({
      id: "abc123",
      title: "Test Book",
      author: "Jane Doe",
      format: "epub",
      metadata: {},
      importedAt: new Date().toISOString(),
      highlightCount: 0,
      threadCount: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a highlight body missing required anchor fields", () => {
    const result = CreateHighlightBodySchema.safeParse({
      resourceId: "abc123",
      exact: "a passage",
    });
    expect(result.success).toBe(false);
  });

  it("accepts every ThreadStreamEvent variant", () => {
    expect(ThreadStreamEventSchema.safeParse({ text: "hi" }).success).toBe(
      true,
    );
    expect(
      ThreadStreamEventSchema.safeParse({
        done: true,
        messageId: "m1",
        threadId: "t1",
      }).success,
    ).toBe(true);
    expect(
      ThreadStreamEventSchema.safeParse({ error: "boom" }).success,
    ).toBe(true);
  });

  it("requires numeric openaiContextTokens on settings", () => {
    const result = SettingsSchema.safeParse({
      provider: "anthropic",
      anthropicModel: "claude-opus-4-8",
      anthropicApiKey: "***",
      openaiBaseUrl: "",
      openaiModel: "",
      openaiApiKey: "",
      openaiContextTokens: 32768,
      vaultPath: "",
    });
    expect(result.success).toBe(true);
  });
});
