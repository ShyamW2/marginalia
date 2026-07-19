import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { ClaudeAgentProvider, renderTranscript } from "./claudeAgent.js";

describe("renderTranscript", () => {
  it("passes a single user message through verbatim", () => {
    expect(renderTranscript([{ role: "user", content: "What is a raven?" }])).toBe(
      "What is a raven?",
    );
  });

  it("labels roles in multi-turn threads", () => {
    const out = renderTranscript([
      { role: "user", content: "Q1" },
      { role: "assistant", content: "A1" },
      { role: "user", content: "Q2" },
    ]);
    expect(out).toBe("[User]\nQ1\n\n[Assistant]\nA1\n\n[User]\nQ2");
  });
});

describe("ClaudeAgentProvider.capabilities", () => {
  it("defaults to the 200K subscription window", () => {
    expect(new ClaudeAgentProvider("claude-sonnet-5").capabilities()).toEqual({
      contextTokens: 200_000,
      supportsCaching: true,
    });
  });

  it("uses 1M for [1m] model variants", () => {
    expect(
      new ClaudeAgentProvider("claude-sonnet-5[1m]").capabilities().contextTokens,
    ).toBe(1_000_000);
  });
});

describe("extract schema conversion", () => {
  it("zod v4 emits a draft-7 schema without a $schema marker", () => {
    // Mirrors toAgentJsonSchema (private): the CLI's draft-07 validator
    // rejects zod's default 2020-12 $schema marker — caught live 2026-07-19.
    const schema = z.object({ name: z.string(), tags: z.array(z.string()) });
    const json = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
    delete json.$schema;
    expect(json.$schema).toBeUndefined();
    expect(json.type).toBe("object");
  });
});
