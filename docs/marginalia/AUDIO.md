# Marginalia — Audio Mode Spec

*Prescriptive implementation spec for the audio subsystem (M21–M22, renumbered from
M17–M18 on 2026-07-28). **Binding**, the
same way SPEC.md is binding for the core: don't re-decide what's settled here; if it's
wrong or silent, make the most boring choice that satisfies it, mark it `// SPEC-GAP`,
and log a line in NOTES.md.*

Design rationale for every decision below lives in `docs/decisions.md`, 2026-07-27
("Audio mode"). Read that entry first. This document says *how*.

## What it is

The app reads a book aloud with a **local** TTS model — no cloud, no API, consistent
with "local-first" (CLAUDE.md). Two listening modes:

- **Single voice** — one narrator reads everything. Works with zero setup.
- **Multi-voice** — a user-initiated *cast scan* uses the LLM to identify characters,
  code assigns each a distinct voice, and dialogue is spoken in character.

Audio plays **inside the reader**, not in a separate player: the spoken sentence is
tinted on the page, pages turn themselves, position saves as normal, and highlighting
or asking mid-listen pauses playback. It is a *mode of the Book room*, not a fourth
room (DESIGN.md has three).

## Stack (fixed)

| Concern | Choice | Why |
|---|---|---|
| Engine (first impl) | **Kokoro-82M** via `kokoro-js` (ONNX, Apache-2.0) | Only option fast enough on **both** machines (Mac + Linux box); ~50 preset voices, which is what casting needs; runs in Node — no Python toolchain to diverge across machines |
| Runtime | `onnxruntime-node` (bundled by `kokoro-js`) | Keeps the server one process; no sidecar in M17 |
| Encoding | Opus via `ffmpeg` if present, WAV otherwise | ffmpeg is already on the Linux box; WAV fallback means audio never hard-depends on it |
| Playback | Browser `<audio>` + Media Source-free sequential segment playback | Boring; segments are short and pre-rendered |

Model weights are a large first-run download. They live under `data/models/` (already
gitignored, per-machine like the rest of `data/`), fetched on first use with visible
progress and a designed failure state — never bundled in git, never silently blocking.

**A second, more expressive GPU engine (Chatterbox/Orpheus-class, Linux-only) is a
later implementation behind the same seam.** Do not build it in M21/M22. The seam is
what makes it a new file rather than new call sites.

⚠️ **Native-binding hazard (this project has already been bitten once).**
`onnxruntime-node` is a native module, exactly like `better-sqlite3` — whose ABI
mismatch across the Mac (Node 20) and Linux (Node 24) machines crashed the server at
startup in a way that was easy to miss, because `tsx watch` stayed alive and the only
symptom was Vite proxying ECONNREFUSED (NOTES.md, 2026-07-20). Expect the same class of
failure here, and make it loud: a failed engine load must surface as
`model_unavailable` in the UI, not as a dead `/api/audio/*` route.

## The seam

```ts
// server/src/audio/engine.ts — the ONLY types the rest of the server may import.
// Same contract style as LLMProvider: nothing engine-specific escapes this file.
export interface TTSEngine {
  readonly id: 'kokoro';
  /** Voices this engine can speak in. Stable ids — they're persisted in the cast. */
  voices(): Promise<Voice[]>;
  /** Synthesize ONE sentence. Returns raw PCM/WAV bytes plus its measured duration. */
  synthesize(req: {
    text: string;
    voiceId: string;
    speed?: number;          // 1.0 default; playback rate is a player concern, this is engine-level
    signal?: AbortSignal;
  }): Promise<{ audio: Uint8Array; format: 'wav'; durationMs: number }>;
}

export interface Voice {
  id: string;                // engine-stable, e.g. 'af_heart'
  label: string;             // human name for the casting UI
  gender: 'female' | 'male' | 'neutral';
  accent?: string;           // 'american' | 'british' | ...
}

export class TTSError extends Error {
  constructor(
    readonly code: 'model_unavailable' | 'model_download_failed' | 'synthesis_failed' | 'unsupported_voice',
    message: string,
  ) { super(message); }
}
```

Engine selection reads settings the same way `llm/provider.ts` does. One registry
function, one place that knows which implementation is live.

## The pipeline

```
resource_text (immutable, already extracted at import)
   → segment into sentences, per spine section, with char offsets
   → assign a voice per sentence  (narrator, or a cast member in multi-voice)
   → synthesize sentence-by-sentence via TTSEngine
   → encode + write to data/audio/<resourceId>/<castHash>/<spineIndex>/<n>.opus
   → manifest row per sentence: file, durationMs, charStart, charEnd, voiceId, speakerId
   → browser plays segments in order; the current sentence's char range is
     resolved to a DOM range in the reader and tinted
```

### Sentence segmentation is the unit of everything

**Sync is sentence-level by construction, not derived from timestamps.** Do not build
follow-along highlighting on per-word timings the engine may or may not expose. One
audio file per sentence means the mapping from "what is playing" to "what is on screen"
is exact and free. Word-level highlighting is a stretch goal, attempted only if the
engine yields reliable phoneme durations, and never a prerequisite for shipping.

Segmentation rules (`server/src/audio/segment.ts`, unit-tested):

- Operates on `resource_text` per `spine_index`, and **must return char offsets into
  that exact string** — those offsets are what the reader resolves back to a DOM range,
  and what `annotations/position.ts` already uses as its coordinate system.
- Use `Intl.Segmenter('…', { granularity: 'sentence' })` — in Node and in every browser
  we target, no dependency. Handle the cases it gets wrong for books: abbreviations
  ("Mr.", "Dr.", "St."), initials, and ellipses must not split a sentence.
- Merge sentences under ~15 chars into their neighbour (a lone "Yes." is a wasteful
  synthesis call and a jumpy highlight), and hard-split anything over ~400 chars at a
  clause boundary so no single segment takes forever to render.
- Preserve the quotation marks in the segment text — pass 2 attribution needs them.

### Rendering strategy: chapter-ahead, on demand

Never render a whole book up front. On play, render the current spine section, then
keep **one section ahead** warm in the background. Rationale (decisions.md): listening
starts in seconds, and a book abandoned after a chapter costs one chapter of compute.

- Rendering is cancellable; navigating away or stopping aborts in-flight synthesis.
- A section already on disk with a matching cast hash is a no-op — the cache is the
  idempotency ledger, checked by file existence (the same lesson as the vault
  compiler's vault-path bug: a ledger row is not proof the file is there).
- Progress is streamed to the client (SSE) so the UI can show "preparing chapter 3…"
  rather than a dead spinner.

### Cache layout

```
data/audio/<resourceId>/<castHash>/<spineIndex>/<n>.opus   -- one file per sentence
data/audio/<resourceId>/<castHash>/<spineIndex>.json       -- manifest for that section
```

`castHash` = sha256 of the ordered (speakerId → voiceId) mapping plus the narrator
voice and engine id. Re-casting or switching engine therefore writes to a new path and
cannot serve stale audio; the old tree is safe to delete at any time. Nothing here is
library data — it is a cache, and the app must work correctly (just slower) with the
whole `data/audio/` tree deleted mid-session.

## Casting (multi-voice)

User-initiated, never automatic. Both passes claim the **`digest` provider role** (M19
provider roles) rather than the global provider — casting a long book is batch analysis
and belongs on whichever model the reader chose for that. Two passes, both through the
**existing** LLM seam
(`extract`, zod-validated) and the existing context builder — no new provider code.

**Pass 1 — the cast.** ⚠️ **Amended 2026-07-28: do not build a second scanner.** This was
originally specified as one call over whole-book context, which does not survive a novel
that exceeds the window. The cast now comes from **M17's book digest** — its map step
already records characters seen per chapter, and its reduce step already produces the
cast. Running a cast scan on an undigested book runs (or resumes) the digest first. The
schema below is the shape the digest's reduce step must produce for this consumer; it is
one pipeline with two consumers, not two pipelines.

```ts
const CastSchema = z.object({
  characters: z.array(z.object({
    name: z.string(),                       // canonical name as it appears in the book
    aliases: z.array(z.string()),           // "Mr. Samsa", "the father", "he" is NOT an alias
    gender: z.enum(['female', 'male', 'unknown']),
    ageHint: z.enum(['child', 'young', 'adult', 'old', 'unknown']),
    description: z.string(),                // one line, informs voice choice
    lineCountHint: z.enum(['many', 'few']), // majors get distinct voices first
  })),
  narratorGender: z.enum(['female', 'male', 'unknown']),
});
```

**Pass 2 — attribution** (one call per spine section, on demand, cached):

```ts
const AttributionSchema = z.object({
  spans: z.array(z.object({
    quote: z.string(),        // the quoted text, VERBATIM from the section
    speaker: z.string(),      // a cast `name`, or "narrator", or "unknown"
  })),
});
```

**The model never returns offsets.** It returns the quoted string; **code** locates
that string in the section text by exact search (first unmatched occurrence, in order).
A model asked to count characters hallucinates positions, and "LLM proposes, code
disposes" (CLAUDE.md settled decision 2) already forbids trusting it with them. Rules:

- A quote that can't be located verbatim → dropped, logged, narrator voice.
- `speaker` that doesn't match a cast name/alias → narrator voice.
- Ambiguity always resolves to the narrator. **A wrong voice is worse than one voice.**
- Attribution failure for a whole section degrades to single-voice for that section —
  it never blocks playback.

**Voice assignment is code, not the model.** Given the cast and `engine.voices()`,
assign deterministically: narrator first, then characters by `lineCountHint` then
appearance order, matching `gender`/`ageHint` and never reusing a voice while an
unused compatible one remains. The user can override any assignment in the casting UI;
overrides persist and win over re-scans.

## Data model (additive migrations)

```sql
CREATE TABLE book_cast (                   -- one row per character per resource
  id            TEXT PRIMARY KEY,          -- uuid v4
  resource_id   TEXT NOT NULL REFERENCES resources(id),
  name          TEXT NOT NULL,
  aliases       TEXT NOT NULL DEFAULT '[]',-- JSON array
  gender        TEXT NOT NULL,             -- 'female' | 'male' | 'unknown'
  age_hint      TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  voice_id      TEXT NOT NULL DEFAULT '',  -- assigned by code, overridable by the user
  voice_locked  INTEGER NOT NULL DEFAULT 0,-- 1 = user chose it; a re-scan must not clobber
  sort_order    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (resource_id, name)
);

CREATE TABLE audio_state (                 -- per-resource listening state
  resource_id   TEXT PRIMARY KEY REFERENCES resources(id),
  narrator_voice TEXT NOT NULL DEFAULT '',
  voice_mode    TEXT NOT NULL DEFAULT 'single' CHECK (voice_mode IN ('single','multi')),
  speed         REAL NOT NULL DEFAULT 1.0,
  cast_scanned_at TEXT,                    -- null = never scanned
  updated_at    TEXT NOT NULL
);
```

Attribution results are **not** a table — they live in the on-disk section manifest
alongside the audio they produced, because they're only meaningful for the cast that
produced them and must be invalidated by the same `castHash`.

Settings additions: `ttsEngine`, `ttsModelPath`, `audioDefaultVoice`,
`audioAutoTurnPages`.

## HTTP API

| Method & path | Purpose |
|---|---|
| `GET /api/audio/voices` | available voices from the live engine (for casting UI) |
| `GET /api/resources/:id/audio` | audio state: voice mode, narrator, speed, cast scanned?, which sections are cached |
| `PUT /api/resources/:id/audio` | update voice mode / narrator / speed |
| `POST /api/resources/:id/cast/scan` | **SSE**: run pass 1, assign voices, persist cast. Streams progress, ends `{done:true, characters:n}` |
| `GET /api/resources/:id/cast` | the cast + assignments |
| `PUT /api/cast/:castId` | override one character's voice (sets `voice_locked`) |
| `POST /api/resources/:id/audio/sections/:spineIndex` | **SSE**: ensure that section is rendered. Streams `{sentence: i, total: n}`, ends `{done:true}`. No-op (immediate done) if cached |
| `GET /api/resources/:id/audio/sections/:spineIndex/manifest` | sentence manifest: `[{n, charStart, charEnd, durationMs, voiceId, speakerId, text}]` |
| `GET /api/resources/:id/audio/sections/:spineIndex/:n` | one audio segment (Range-supporting static file serve) |
| `DELETE /api/resources/:id/audio` | drop the rendered cache for this book |

SSE contract is the same as threads (`SPEC.md`): flush per event, abort work on client
disconnect, `data: {"error": "..."}` then end on failure — never a partial success
reported as done.

## Reader integration

- **The tint.** The playing sentence gets its own mark style, visually distinct from
  the four highlight kinds and quieter than all of them — it moves every few seconds
  and must not compete with the reader's own annotations. It resolves through the
  existing anchor machinery (`web/src/reader/anchorResolution.ts`): the manifest's
  char range → text search in the section contents → DOM range → epub.js mark. **A
  sentence that can't be resolved is skipped silently** — audio keeps playing; a
  missing tint is a blemish, a stall is a broken product.
- **Auto page turn** when the playing sentence is outside the visible page. Use the
  **slide**, not M10's snapshot curl: capture costs main-thread time on every turn and
  audio must never stutter (decisions.md). Honour `audioAutoTurnPages`.
- **Interaction pauses playback.** Making a selection, opening a thread, or opening the
  annotations overview pauses; it does not stop. You cannot read an answer while being
  talked at.
- **Transport controls** are reader chrome (not a new room): play/pause (`space` — must
  respect the existing `isTyping` guard used by `f`/`[`/`]`), skip sentence
  (`shift+←/→`), skip chapter (reuse `[`/`]`), speed, and the voice-mode toggle.
  In fullscreen mode (M14) they join the proximity-revealed bottom chrome.
- **Position.** Audio position saves through the existing reading-position path — stop
  listening at 40% and open the book with your eyes and you are at 40%. One position
  per book, not two.
- **Focus mode still governs.** The tint is an annotation-layer effect and `f` hides it
  (DESIGN.md's guard rail: any new effect must be inside focus mode's jurisdiction).

## The desk tool

A tactile object on the desk (deck/gramophone — art direction is DESIGN.md's) that
toggles **listening mode**. While lit, opening any book opens it in audio mode; the
tool reads as engaged (warm glow, needle down) so the mode is never invisible. Escape
or clicking it again disengages.

Per DESIGN.md accessibility, **the tool is the charm, not the gate**: a plain "Listen"
action also lives in the book hover strip and in the list view, which remains the
canonical keyboard/screen-reader path. The tool itself must be a real focusable button
with an accessible name and pressed state, not a div with a click handler.

## Testing & verification

Unit (must exist, not optional):

- `segment.ts` — sentence splitting against real fixture text: abbreviation and initial
  cases don't split, short sentences merge, long ones split at a clause, and offsets
  round-trip exactly (`text.slice(charStart, charEnd) === segment.text`).
- Quote location — verbatim match, repeated identical quotes resolve in order,
  unlocatable quote returns null (and the caller falls back to narrator).
- Voice assignment — deterministic, no duplicate voice while an unused compatible one
  exists, `voice_locked` survives a re-scan.
- Cast + attribution schema parsing, including a malformed-output failure path.
- Cache keying — a changed cast produces a different `castHash`; an existing file with
  the current hash is a no-op.

Live verification (the real bar — drive the app, per CLAUDE.md):

- Listen to a real chapter of a fixture book end to end in single-voice mode: the tint
  tracks the audio, pages turn, no stutter at a chapter boundary.
- Run a cast scan on Metamorphosis, check the cast is sane, override one voice, confirm
  the override survives a re-scan and changes the audio.
- Kill the LLM provider mid-attribution → that section falls back to single voice and
  keeps playing.
- Delete `data/audio/` mid-session → playback re-renders rather than erroring.
- Reduced motion / focus mode / both themes, as with every other surface.
