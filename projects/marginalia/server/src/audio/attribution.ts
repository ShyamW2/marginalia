// extract() requires zod/v4 schema instances — see llm/provider.ts's comment.
import { z } from "zod/v4";
import type { LLMProvider } from "../llm/provider.js";
import type { BookCastMemberRow } from "./castStore.js";
import type { Sentence } from "./segment.js";

/**
 * Pass 2 of the audio cast scan (AUDIO.md "Casting"): per-section speaker
 * attribution, on demand and cached (implicitly — a section is only ever
 * rendered once per `castHash`, so a re-render under the same cast never
 * re-attributes). One call per spine section.
 *
 * The model never returns offsets (CLAUDE.md settled decision 2, and
 * "settled decision 11: the model never returns positions"). It returns the
 * quoted string; code locates it by exact search.
 */
export const AttributionSchema = z.object({
  spans: z.array(
    z.object({
      quote: z.string(),
      speaker: z.string(),
    }),
  ),
});
export type AttributionSpan = z.infer<typeof AttributionSchema>["spans"][number];

const ATTRIBUTION_INSTRUCTIONS = `You are identifying who speaks each line of dialogue in a section of a book, for a
text-to-speech narrator that gives each character a distinct voice.

Respond with a single JSON object with exactly this key:
{
  "spans": [ { "quote": "...", "speaker": "..." } ]
}

For every directly quoted line of dialogue in the section text, add one entry:
- "quote": the spoken text VERBATIM, copied exactly from the section — same words,
  same punctuation, same quotation marks. Do not paraphrase, trim, or fix anything.
- "speaker": the speaking character's name, exactly as given in the cast list below
  (or one of their listed aliases). Use "narrator" if the narrator is the one being
  quoted (e.g. reported speech folded into narration). Use "unknown" if the section
  gives no way to tell who is speaking. If you are not confident, prefer "unknown" or
  "narrator" over guessing a specific character — a wrong guess is worse than none.

Do not add an entry for plain narration (text with no dialogue). Return only the JSON
object, no other text.`;

export async function extractAttribution(
  provider: LLMProvider,
  sectionText: string,
  cast: { name: string; aliases: string[] }[],
  signal?: AbortSignal,
): Promise<AttributionSpan[]> {
  const castList = cast
    .map((c) => (c.aliases.length > 0 ? `${c.name} (also: ${c.aliases.join(", ")})` : c.name))
    .join("\n");
  const result = await provider.extract({
    instructions: ATTRIBUTION_INSTRUCTIONS,
    input: `Cast:\n${castList || "(none named)"}\n\nSection text:\n${sectionText}`,
    schema: AttributionSchema,
    signal,
  });
  return result.spans;
}

export interface LocatedSpan {
  charStart: number;
  charEnd: number;
  speaker: string;
}

// Confirmed live against Metamorphosis (Project-Gutenberg-sourced HTML, which
// uses typographic quotes): the model "cleans up" “curly” quotes/apostrophes
// to straight ASCII ones in its JSON output even when told to copy verbatim,
// so every single span failed exact-match until this normalization existed
// — not a rare edge case, a total failure on any Gutenberg-style text. Each
// mapping is exactly one character for one character, so normalizing never
// changes string length.
const QUOTE_NORMALIZATION: [RegExp, string][] = [
  [/[“”]/g, '"'], // “ ” -> "
  [/[‘’]/g, "'"], // ' ' -> '
];

function normalizeQuotePunctuation(s: string): string {
  return QUOTE_NORMALIZATION.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), s);
}

/**
 * Locates each span's quote verbatim in `text`, in array order. Matching
 * happens against a quote-punctuation-normalized copy of both `text` and
 * each quote (see `normalizeQuotePunctuation`) — because that normalization
 * is a straight character-for-character swap, the offsets found are still
 * valid offsets into the original `text` (same trick `segment.ts`'s
 * isolated-newline fix uses). A per-quote-text cursor (not a single global
 * one) means two spans with *different* quote text can still be found in
 * any order, while repeated *identical* quotes resolve to successive
 * occurrences rather than all collapsing onto the first (AUDIO.md testing:
 * "repeated identical quotes resolving in order"). A quote that can't be
 * found from its cursor onward is dropped (AUDIO.md: "unlocatable quote →
 * dropped, logged, narrator voice") — never throws, since one bad span must
 * not fail the whole section.
 */
export function locateAttributionSpans(text: string, spans: AttributionSpan[]): LocatedSpan[] {
  const searchable = normalizeQuotePunctuation(text);
  const cursorByQuote = new Map<string, number>();
  const located: LocatedSpan[] = [];
  for (const span of spans) {
    if (span.quote.length === 0) continue;
    const needle = normalizeQuotePunctuation(span.quote);
    const from = cursorByQuote.get(needle) ?? 0;
    const charStart = searchable.indexOf(needle, from);
    if (charStart === -1) {
      // eslint-disable-next-line no-console
      console.error(`[audio-attribution] unlocatable quote, dropped: ${JSON.stringify(span.quote.slice(0, 80))}`);
      continue;
    }
    const charEnd = charStart + needle.length;
    cursorByQuote.set(needle, charEnd);
    located.push({ charStart, charEnd, speaker: span.speaker });
  }
  return located;
}

function resolveSpeaker(speaker: string, cast: BookCastMemberRow[]): BookCastMemberRow | null {
  return cast.find((c) => c.name === speaker || c.aliases.includes(speaker)) ?? null;
}

export interface SentenceVoice {
  voiceId: string;
  speakerId: string | null;
}

function narratorVoice(voiceId: string): SentenceVoice {
  return { voiceId, speakerId: null };
}

/**
 * One voice per sentence — never per sub-sentence span, since a segment is
 * one audio file (AUDIO.md: "sync is sentence-level by construction"). A
 * sentence gets a cast member's voice only when a located quote starts
 * inside it *and* resolves to a known, voiced cast member; everything else —
 * no quote, an unlocatable one, "narrator", "unknown", or an unrecognized
 * name — stays the narrator (AUDIO.md: "ambiguity always resolves to the
 * narrator. A wrong voice is worse than one voice."). A sentence whose
 * quotes name two different speakers keeps whichever was found first,
 * rather than invent a third state.
 */
export function assignSentenceVoices(
  sectionText: string,
  sentences: Sentence[],
  spans: AttributionSpan[],
  cast: BookCastMemberRow[],
  narratorVoiceId: string,
): SentenceVoice[] {
  const fallback = narratorVoice(narratorVoiceId);
  const voices: SentenceVoice[] = sentences.map(() => fallback);

  for (const span of locateAttributionSpans(sectionText, spans)) {
    const member = resolveSpeaker(span.speaker, cast);
    if (!member || !member.voiceId) continue;
    const sentenceIndex = sentences.findIndex((s) => span.charStart >= s.charStart && span.charStart < s.charEnd);
    if (sentenceIndex === -1 || voices[sentenceIndex] !== fallback) continue;
    voices[sentenceIndex] = { voiceId: member.voiceId, speakerId: member.id };
  }
  return voices;
}

/**
 * The whole pass-2-then-assign pipeline for one section, with every failure
 * mode folded into "this section is narrator-only" — never a thrown error
 * that would block rendering (AUDIO.md: "a whole failed section degrades to
 * single-voice ... it never blocks playback"). The one exception is a real
 * cancellation: an aborted `signal` rethrows so the render job's own abort
 * handling takes over, rather than being masked as an attribution failure
 * and rendering anyway.
 */
export async function resolveSectionVoices(
  provider: LLMProvider | null,
  sectionText: string,
  sentences: Sentence[],
  cast: BookCastMemberRow[],
  narratorVoiceId: string,
  signal?: AbortSignal,
): Promise<SentenceVoice[]> {
  const allNarrator = () => sentences.map(() => narratorVoice(narratorVoiceId));
  if (!provider || cast.length === 0) return allNarrator();

  try {
    const spans = await extractAttribution(provider, sectionText, cast, signal);
    return assignSentenceVoices(sectionText, sentences, spans, cast, narratorVoiceId);
  } catch (err) {
    if (signal?.aborted) throw err;
    // eslint-disable-next-line no-console
    console.error("[audio-attribution] section failed, degrading to single-voice:", err);
    return allNarrator();
  }
}
