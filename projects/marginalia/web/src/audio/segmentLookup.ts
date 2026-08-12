import { findAnchorInText, type AudioSegment } from "@marginalia/shared";

/**
 * M22.6 C "play from here": resolves a selection to the manifest segment it
 * falls in, by re-finding each known segment's own sentence text in the
 * same DOM section text the selection itself was located in — the audio
 * tint effect's exact-text-search idiom (ReaderView.tsx), run in the
 * opposite direction. Segment text is server-extracted `resource_text`,
 * word-wrapped with real embedded newlines that essentially never line up
 * with the live DOM's own whitespace (confirmed live: segment 1's text
 * carried a mid-sentence `\n` a plain `indexOf` against `sectionText` never
 * matched, silently collapsing every lookup to segment 0) — `findAnchorInText`
 * is the whitespace-tolerant search built for exactly this mismatch, not a
 * plain string search. The boundary whitespace between two segments can
 * land on either side (segment N's trailing newline vs. segment N+1's
 * leading one, an `Intl.Segmenter` artifact) — advancing the cursor only
 * past each match's *start* (not its end) keeps the next search's window
 * intact rather than risking an off-by-one-space search that fails to
 * match at all. `segments` only covers what has rendered *so far*
 * (getPartialSectionManifest, AUDIO.md "listening starts in seconds") — a
 * section that's still rendering, or hasn't started, simply resolves to its
 * last known segment (or 0), which is exactly where a fresh render would
 * start playback anyway.
 */
export function resolveSegmentIndexForOffset(
  sectionText: string,
  targetStart: number,
  segments: AudioSegment[],
): number {
  let resolved = 0;
  let searchFrom = 0;
  for (const segment of segments) {
    const match = findAnchorInText(sectionText.slice(searchFrom), { exact: segment.text, prefix: "", suffix: "" });
    if (!match) break;
    const at = searchFrom + match.start;
    if (at > targetStart) break;
    resolved = segment.n;
    searchFrom = at + 1;
  }
  return resolved;
}
