import { describe, expect, it } from "vitest";
import type { LLMExtractRequest, LLMProvider } from "../llm/provider.js";
import { LLMError } from "../llm/provider.js";
import type { BookCastMemberRow } from "./castStore.js";
import type { Sentence } from "./segment.js";
import { assignSentenceVoices, locateAttributionSpans, resolveSectionVoices, type AttributionSpan } from "./attribution.js";

function member(overrides: Partial<BookCastMemberRow> = {}): BookCastMemberRow {
  return {
    id: "cast-alice",
    resourceId: "res-1",
    name: "Alice",
    aliases: [],
    gender: "female",
    ageHint: "young",
    description: "",
    voiceId: "af_alpha",
    voiceLocked: false,
    sortOrder: 0,
    ...overrides,
  };
}

function sentence(text: string, charStart: number): Sentence {
  return { charStart, charEnd: charStart + text.length, text };
}

describe("locateAttributionSpans", () => {
  it("locates a verbatim quote", () => {
    const text = 'Alice said, "Follow me." Then she left.';
    const located = locateAttributionSpans(text, [{ quote: '"Follow me."', speaker: "Alice" }]);
    expect(located).toHaveLength(1);
    expect(text.slice(located[0].charStart, located[0].charEnd)).toBe('"Follow me."');
  });

  it("resolves repeated identical quotes to successive occurrences, in order", () => {
    const text = '"Yes." he said. Later, "Yes." she agreed.';
    const spans: AttributionSpan[] = [
      { quote: '"Yes."', speaker: "Bob" },
      { quote: '"Yes."', speaker: "Carol" },
    ];
    const located = locateAttributionSpans(text, spans);
    expect(located).toHaveLength(2);
    expect(located[0].charStart).toBe(0);
    expect(located[1].charStart).toBe(text.indexOf('"Yes."', 1));
    expect(located[0].charStart).not.toBe(located[1].charStart);
  });

  it("drops an unlocatable quote rather than throwing or guessing", () => {
    const text = "Nothing is quoted here at all.";
    const located = locateAttributionSpans(text, [{ quote: '"Never said."', speaker: "Alice" }]);
    expect(located).toEqual([]);
  });

  it("locates a quote despite curly-vs-straight quote/apostrophe mismatch (confirmed live against real Gutenberg text)", () => {
    // Source text: real typographic punctuation. Model output: the same
    // words, but straightened — the exact, total-failure pattern found
    // live against Metamorphosis before this normalization existed.
    const text = "“Gregor, Gregor”, he called, “what’s wrong?” And after a short while he called again.";
    const located = locateAttributionSpans(text, [
      { quote: '"Gregor, Gregor"', speaker: "Mr. Samsa" },
      { quote: '"what\'s wrong?"', speaker: "Mr. Samsa" },
    ]);
    expect(located).toHaveLength(2);
    expect(text.slice(located[0].charStart, located[0].charEnd)).toBe("“Gregor, Gregor”");
    expect(text.slice(located[1].charStart, located[1].charEnd)).toBe("“what’s wrong?”");
  });

  it("a third occurrence of the same quote with only two in the text is dropped, not misattributed", () => {
    const text = '"Hi." "Hi."';
    const spans: AttributionSpan[] = [
      { quote: '"Hi."', speaker: "A" },
      { quote: '"Hi."', speaker: "B" },
      { quote: '"Hi."', speaker: "C" },
    ];
    const located = locateAttributionSpans(text, spans);
    expect(located).toHaveLength(2);
    expect(located.map((l) => l.speaker)).toEqual(["A", "B"]);
  });
});

describe("assignSentenceVoices", () => {
  const alice = member({ id: "cast-alice", name: "Alice", aliases: ["Al"], voiceId: "af_alpha" });
  const bob = member({ id: "cast-bob", name: "Bob", voiceId: "am_beta" });
  const narratorVoiceId = "af_narrator";

  it("gives a sentence with a located, resolved quote that character's voice", () => {
    const text = '"Follow me," Alice said. It was raining.';
    const sentences = [sentence('"Follow me," Alice said.', 0), sentence(" It was raining.", 25)];
    const spans: AttributionSpan[] = [{ quote: '"Follow me,"', speaker: "Alice" }];
    const voices = assignSentenceVoices(text, sentences, spans, [alice, bob], narratorVoiceId);
    expect(voices[0]).toEqual({ voiceId: "af_alpha", speakerId: "cast-alice" });
    expect(voices[1]).toEqual({ voiceId: narratorVoiceId, speakerId: null });
  });

  it("matches a cast member by alias, not just canonical name", () => {
    const text = '"Hi there." Al waved.';
    const sentences = [sentence('"Hi there." Al waved.', 0)];
    const voices = assignSentenceVoices(text, sentences, [{ quote: '"Hi there."', speaker: "Al" }], [alice], narratorVoiceId);
    expect(voices[0].speakerId).toBe("cast-alice");
  });

  it("an unrecognized speaker name falls back to the narrator", () => {
    const text = '"Who said that?"';
    const sentences = [sentence(text, 0)];
    const voices = assignSentenceVoices(text, sentences, [{ quote: text, speaker: "Some Stranger" }], [alice], narratorVoiceId);
    expect(voices[0]).toEqual({ voiceId: narratorVoiceId, speakerId: null });
  });

  it('an explicit "narrator" or "unknown" speaker stays the narrator voice', () => {
    const text = '"Reported speech." More text.';
    const sentences = [sentence(text, 0)];
    for (const speaker of ["narrator", "unknown"]) {
      const voices = assignSentenceVoices(text, sentences, [{ quote: '"Reported speech."', speaker }], [alice], narratorVoiceId);
      expect(voices[0].speakerId).toBeNull();
    }
  });

  it("an unlocatable quote leaves its sentence on the narrator voice", () => {
    const text = "Plain narration, no quotes at all.";
    const sentences = [sentence(text, 0)];
    const voices = assignSentenceVoices(text, sentences, [{ quote: '"never here"', speaker: "Alice" }], [alice], narratorVoiceId);
    expect(voices[0]).toEqual({ voiceId: narratorVoiceId, speakerId: null });
  });

  it("a sentence quoting two different speakers keeps the first one located", () => {
    const text = '"Hello," said Alice. "Hi," said Bob, in the same breath.';
    const sentences = [sentence(text, 0)];
    const spans: AttributionSpan[] = [
      { quote: '"Hello,"', speaker: "Alice" },
      { quote: '"Hi,"', speaker: "Bob" },
    ];
    const voices = assignSentenceVoices(text, sentences, spans, [alice, bob], narratorVoiceId);
    expect(voices[0].speakerId).toBe("cast-alice");
  });

  it("a cast member with no assigned voice yet cannot be assigned (stays narrator)", () => {
    const unvoiced = member({ id: "cast-carol", name: "Carol", voiceId: "" });
    const text = '"Test."';
    const sentences = [sentence(text, 0)];
    const voices = assignSentenceVoices(text, sentences, [{ quote: text, speaker: "Carol" }], [unvoiced], narratorVoiceId);
    expect(voices[0]).toEqual({ voiceId: narratorVoiceId, speakerId: null });
  });
});

describe("resolveSectionVoices", () => {
  const alice = member({ id: "cast-alice", name: "Alice", voiceId: "af_alpha" });
  const narratorVoiceId = "af_narrator";
  const text = '"Hi," Alice said.';
  const sentences = [sentence(text, 0)];

  function provider(extract: (req: LLMExtractRequest<unknown>) => unknown): LLMProvider {
    return {
      id: "openai-compatible",
      capabilities: () => ({ contextTokens: 100_000, supportsCaching: false }),
      async *stream() {
        yield { text: "" };
      },
      async extract<T>(req: LLMExtractRequest<T>): Promise<T> {
        return extract(req) as T;
      },
    };
  }

  it("with no provider configured, every sentence stays the narrator", async () => {
    const voices = await resolveSectionVoices(null, text, sentences, [alice], narratorVoiceId);
    expect(voices).toEqual([{ voiceId: narratorVoiceId, speakerId: null }]);
  });

  it("with an empty cast, every sentence stays the narrator (no provider call needed)", async () => {
    let called = false;
    const p = provider(() => {
      called = true;
      return { spans: [] };
    });
    const voices = await resolveSectionVoices(p, text, sentences, [], narratorVoiceId);
    expect(voices).toEqual([{ voiceId: narratorVoiceId, speakerId: null }]);
    expect(called).toBe(false);
  });

  it("attributes correctly on a successful call", async () => {
    const p = provider(() => ({ spans: [{ quote: '"Hi,"', speaker: "Alice" }] }));
    const voices = await resolveSectionVoices(p, text, sentences, [alice], narratorVoiceId);
    expect(voices[0]).toEqual({ voiceId: "af_alpha", speakerId: "cast-alice" });
  });

  it("a provider failure degrades the whole section to single-voice rather than throwing", async () => {
    const p = provider(() => {
      throw new LLMError("network", "connection refused");
    });
    const voices = await resolveSectionVoices(p, text, sentences, [alice], narratorVoiceId);
    expect(voices).toEqual([{ voiceId: narratorVoiceId, speakerId: null }]);
  });

  it("a malformed/unparseable response also degrades to single-voice, not a crash", async () => {
    const p = provider(() => {
      throw new LLMError("extract_parse_failed", "bad json");
    });
    const voices = await resolveSectionVoices(p, text, sentences, [alice], narratorVoiceId);
    expect(voices).toEqual([{ voiceId: narratorVoiceId, speakerId: null }]);
  });

  it("a genuine cancellation is not masked as a section failure — it rethrows", async () => {
    const controller = new AbortController();
    const p = provider(() => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });
    await expect(resolveSectionVoices(p, text, sentences, [alice], narratorVoiceId, controller.signal)).rejects.toThrow();
  });
});
