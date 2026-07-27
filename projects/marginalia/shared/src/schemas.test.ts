import { describe, expect, it } from "vitest";
import {
  CreateHighlightBodySchema,
  HighlightSchema,
  ResourceSummarySchema,
  SettingsSchema,
  ThreadStreamEventSchema,
  UpdateHighlightNoteBodySchema,
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
      lastReadAt: null,
      shelf: null,
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
      claudeAgentModel: "claude-sonnet-5",
      openaiBaseUrl: "",
      openaiModel: "",
      openaiApiKey: "",
      openaiContextTokens: 32768,
      vaultPath: "",
      cursorStyle: "custom",
      cursorTrailEnabled: true,
      spreadMode: "single",
    });
    expect(result.success).toBe(true);
  });

  it("parses a highlight with an empty note (M13 default) and rejects a missing one", () => {
    const base = {
      id: "h1",
      resourceId: "abc123",
      exact: "a passage",
      prefix: "",
      suffix: "",
      cfi: "epubcfi(/6/4!/4/2)",
      spineIndex: 0,
      kind: "rose" as const,
      importance: 0 as const,
      createdAt: new Date().toISOString(),
    };
    expect(HighlightSchema.safeParse({ ...base, note: "" }).success).toBe(true);
    expect(HighlightSchema.safeParse(base).success).toBe(false);
  });

  it("accepts an UpdateHighlightNoteBody", () => {
    expect(UpdateHighlightNoteBodySchema.safeParse({ note: "a thought" }).success).toBe(true);
  });
});
