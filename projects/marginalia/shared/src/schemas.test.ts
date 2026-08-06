import { describe, expect, it } from "vitest";
import {
  CreateHighlightBodySchema,
  HighlightSchema,
  ResourceSummarySchema,
  SettingsSchema,
  ThreadStreamEventSchema,
  UpdateHighlightNoteBodySchema,
  UpdateHighlightPanelOffsetBodySchema,
  UpdateHighlightPanelSizeBodySchema,
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
        contextNote: null,
        contextUsage: null,
        contextDepth: "full",
        contextChapters: [],
        // M22.5 H: the byline the reader shows without a second round trip.
        // Nullable, but required — a done event that omits it is a bug.
        provenance: {
          profileName: "Default",
          provider: "anthropic",
          model: "claude-opus-4-8",
          endpointHost: null,
        },
      }).success,
    ).toBe(true);
    expect(
      ThreadStreamEventSchema.safeParse({
        done: true,
        messageId: "m1",
        threadId: "t1",
        contextNote: null,
        contextUsage: null,
        contextDepth: "full",
        contextChapters: [],
        provenance: null,
      }).success,
    ).toBe(true);
    expect(
      ThreadStreamEventSchema.safeParse({ error: "boom" }).success,
    ).toBe(true);
  });

  // M19 moved provider configuration out of Settings into provider *profiles*;
  // M21 merged AudioSettingsSchema in. Settings is now "everything that isn't
  // about which LLM answers what", plus the audio block.
  it("parses settings carrying the merged audio block", () => {
    const result = SettingsSchema.safeParse({
      vaultPath: "",
      cursorStyle: "custom",
      cursorTrailEnabled: true,
      spreadMode: "single",
      pageTransition: "slide",
      readerMargin: "normal",
      readerFontScale: 1,
      scanCrtIntensity: 0.6,
      pageNumberMode: "off",
      readerPaneWidth: 0,
      digestTokenBudget: 0,
      ttsEngine: "kokoro",
      ttsModelPath: "/tmp/models",
      audioDefaultVoice: "af_heart",
      audioAutoTurnPages: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects settings missing the audio block", () => {
    const result = SettingsSchema.safeParse({
      vaultPath: "",
      cursorStyle: "custom",
      cursorTrailEnabled: true,
      spreadMode: "single",
      pageTransition: "slide",
      readerMargin: "normal",
      readerFontScale: 1,
      scanCrtIntensity: 0.6,
      pageNumberMode: "off",
      readerPaneWidth: 0,
      digestTokenBudget: 0,
    });
    expect(result.success).toBe(false);
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
      panelDx: 0,
      panelDy: 0,
      panelWidth: null,
      panelHeight: null,
      createdAt: new Date().toISOString(),
    };
    expect(HighlightSchema.safeParse({ ...base, note: "" }).success).toBe(true);
    expect(HighlightSchema.safeParse(base).success).toBe(false);
  });

  it("accepts an UpdateHighlightNoteBody", () => {
    expect(UpdateHighlightNoteBodySchema.safeParse({ note: "a thought" }).success).toBe(true);
  });

  it("rejects a highlight missing the M14 panel offset fields", () => {
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
      note: "",
      createdAt: new Date().toISOString(),
    };
    expect(HighlightSchema.safeParse(base).success).toBe(false);
    expect(
      HighlightSchema.safeParse({
        ...base,
        panelDx: 3,
        panelDy: -2,
        panelWidth: null,
        panelHeight: null,
      }).success,
    ).toBe(true);
  });

  it("accepts an UpdateHighlightPanelSizeBody, and a highlight with resized panel dimensions", () => {
    expect(
      UpdateHighlightPanelSizeBodySchema.safeParse({ panelWidth: 420, panelHeight: 560 }).success,
    ).toBe(true);
  });

  it("accepts an UpdateHighlightPanelOffsetBody", () => {
    expect(
      UpdateHighlightPanelOffsetBodySchema.safeParse({ panelDx: 10.5, panelDy: -4 }).success,
    ).toBe(true);
  });
});
