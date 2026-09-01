import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { homedir } from "node:os";
import { sep } from "node:path";
import {
  lastAgentMessage,
  mapCodexErrorMessage,
  parseCodexEvents,
  scratchDir,
  toDraft7JsonSchema,
  usageFromEvents,
} from "./codexCli.js";

describe("scratchDir", () => {
  it("never contains a dot-directory segment under home — verified live 2026-08-25 (NOTES.md 'M26' addendum): codex's snap confinement denies reading a file from inside one", () => {
    const dir = scratchDir();
    expect(dir.startsWith(homedir())).toBe(true);
    const relative = dir.slice(homedir().length);
    expect(relative.split(sep).some((segment) => segment.startsWith("."))).toBe(false);
  });

  it("is not under the OS temp dir — verified live 2026-08-25 (NOTES.md 'M26'): codex exec -C fails ENOENT on this machine's tmpfs /tmp", () => {
    expect(scratchDir()).not.toContain("/tmp/");
  });
});

describe("parseCodexEvents", () => {
  it("parses one JSON object per line", () => {
    const stdout = [
      '{"type":"thread.started","thread_id":"abc"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"hi"}}',
      '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":2}}',
      "",
    ].join("\n");
    expect(parseCodexEvents(stdout).map((e) => e.type)).toEqual([
      "thread.started",
      "turn.started",
      "item.completed",
      "turn.completed",
    ]);
  });

  it("drops lines that aren't a JSON object with a string type — the CLI's own stderr log noise", () => {
    // Verified live 2026-08-25 (NOTES.md "M26"): a models-refresh warning
    // this account's build always logs lands on stderr, never stdout — but
    // this is defensive in case a future build's stdout ever carries
    // something similar, or a stray blank/partial line.
    const stdout = [
      "not json at all",
      '{"no_type_field": true}',
      '{"type":"turn.started"}',
    ].join("\n");
    expect(parseCodexEvents(stdout).map((e) => e.type)).toEqual(["turn.started"]);
  });
});

describe("lastAgentMessage", () => {
  it("returns null when no agent_message item ever completed", () => {
    expect(lastAgentMessage([{ type: "turn.started" }])).toBeNull();
  });

  it("returns the one agent_message on a plain answer", () => {
    const events = [
      { type: "thread.started" },
      { type: "turn.started" },
      { type: "item.completed", item: { id: "item_0", type: "agent_message", text: "hello" } },
      { type: "turn.completed" },
    ];
    expect(lastAgentMessage(events)).toBe("hello");
  });

  it("takes the LAST agent_message, not the first — verified live 2026-08-25 (NOTES.md 'M26'): a turn where the model attempts a blocked tool call narrates first, then answers", () => {
    const events = [
      { type: "item.completed", item: { id: "item_0", type: "agent_message", text: "Running the command now…" } },
      { type: "item.completed", item: { id: "item_1", type: "agent_message", text: "Failed" } },
    ];
    expect(lastAgentMessage(events)).toBe("Failed");
  });

  it("ignores item.completed events of a different item type", () => {
    const events = [
      { type: "item.completed", item: { id: "item_0", type: "reasoning", text: "thinking…" } },
      { type: "item.completed", item: { id: "item_1", type: "agent_message", text: "answer" } },
    ];
    expect(lastAgentMessage(events)).toBe("answer");
  });
});

describe("usageFromEvents", () => {
  it("reads turn.completed's usage block — verified live 2026-08-25 (NOTES.md 'M26'): no cost_usd field, ever", () => {
    const events = [
      { type: "turn.completed", usage: { input_tokens: 7540, cached_input_tokens: 6528, output_tokens: 22 } },
    ];
    expect(usageFromEvents(events)).toEqual({
      inputTokens: 7540,
      outputTokens: 22,
      cacheReadTokens: 6528,
    });
  });

  it("returns null when the turn never completed (e.g. it failed instead)", () => {
    expect(usageFromEvents([{ type: "turn.failed", error: { message: "boom" } }])).toBeNull();
  });
});

describe("mapCodexErrorMessage", () => {
  it("classifies an unsupported-model failure (verified live 2026-08-25, NOTES.md 'M26') as unknown, not auth — wrong model, not a bad login", () => {
    expect(
      mapCodexErrorMessage("The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account").code,
    ).toBe("unknown");
  });

  it("classifies an auth failure", () => {
    expect(mapCodexErrorMessage("Not logged in").code).toBe("auth");
  });

  it("classifies a rate limit", () => {
    expect(mapCodexErrorMessage("429 rate limit exceeded").code).toBe("rate_limit");
  });

  it("classifies a spawn-level network failure (e.g. ENOENT if the binary is missing)", () => {
    expect(mapCodexErrorMessage("spawn codex ENOENT").code).toBe("network");
  });

  it("falls back to unknown for an unrecognized message", () => {
    expect(mapCodexErrorMessage("something unexpected").code).toBe("unknown");
  });
});

describe("toDraft7JsonSchema", () => {
  it("emits a draft-7 schema without zod v4's default $schema marker — the CLI's --output-schema validator rejects it", () => {
    const schema = z.object({ greeting: z.string(), count: z.number().int() });
    const json = toDraft7JsonSchema(schema);
    expect(json.$schema).toBeUndefined();
    expect(json.type).toBe("object");
  });

  it("lists every property in `required`, including optional/nullable ones — codex's strict output-schema mode rejects a schema whose `required` omits a declared property", () => {
    const schema = z.object({
      name: z.string(),
      zoneStart: z.string().nullable().optional(),
      nested: z.object({ inner: z.string().optional() }),
    });
    const json = toDraft7JsonSchema(schema) as { required: string[]; properties: { nested: { required: string[] } } };
    expect(json.required.sort()).toEqual(["name", "nested", "zoneStart"]);
    expect(json.properties.nested.required).toEqual(["inner"]);
  });
});
