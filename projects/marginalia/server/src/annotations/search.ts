import type Database from "better-sqlite3";
import { containsMatch, findAllOccurrences, type SearchHit, type SearchMatchMode } from "@marginalia/shared";
import { getResourceById, getResourceTextSections } from "../library/store.js";
import { listHighlightsWithThreadsForResource } from "./highlights.js";
import { listMessagesForThread } from "./threads.js";
import { buildSectionOffsetIndex, locateAnchor, type SectionOffsetIndex } from "./sectionOffsets.js";

// Matches the reader's own SELECTION_CONTEXT_MAX_LEN (ReaderView.tsx) — the
// anchor this produces is meant to be exactly as re-anchorable as one a live
// selection would have captured.
const ANCHOR_CONTEXT_MAX_LEN = 64;
const SNIPPET_RADIUS = 80;

function contextAround(
  text: string,
  start: number,
  end: number,
): { prefix: string; suffix: string } {
  return {
    prefix: text.slice(Math.max(0, start - ANCHOR_CONTEXT_MAX_LEN), start),
    suffix: text.slice(end, end + ANCHOR_CONTEXT_MAX_LEN),
  };
}

function snippetAround(text: string, start: number, end: number): string {
  const from = Math.max(0, start - SNIPPET_RADIUS);
  const to = Math.min(text.length, end + SNIPPET_RADIUS);
  const ellipsisBefore = from > 0 ? "…" : "";
  const ellipsisAfter = to < text.length ? "…" : "";
  return `${ellipsisBefore}${text.slice(from, to)}${ellipsisAfter}`;
}

/**
 * Book-text hits: every occurrence of `query` under the matching rule,
 * found by scanning `resource_text` directly — independent of whether any of
 * it is also highlighted (that's the annotation pass below; a phrase can
 * produce both).
 *
 * The occurrence scan itself is `@marginalia/shared`'s (M24.1 C): the reader
 * re-finds these same occurrences in the live rendered DOM, and a rule that
 * lived only here would mean the two counted different things.
 */
function textHits(index: SectionOffsetIndex, query: string, mode: SearchMatchMode): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const section of index.sections) {
    const preceding = index.precedingLength.get(section.spineIndex) ?? 0;
    for (const occurrence of findAllOccurrences(section.text, query, mode)) {
      const { prefix, suffix } = contextAround(section.text, occurrence.start, occurrence.end);
      const globalOffset = preceding + occurrence.start;
      hits.push({
        source: "text",
        spineIndex: section.spineIndex,
        offset: occurrence.start,
        percent: index.totalLength > 0 ? globalOffset / index.totalLength : 0,
        snippet: snippetAround(section.text, occurrence.start, occurrence.end),
        anchor: { prefix, exact: section.text.slice(occurrence.start, occurrence.end), suffix },
        highlightId: null,
      });
    }
  }
  return hits;
}

/**
 * Annotation hits: `query` found in a highlight's own quote, its note, or a
 * thread message. None of these anchor to *where the query sits* — a note or
 * a thread reply isn't book text — they anchor to the highlight itself, the
 * same anchor it already carries (settled decision 11: search produces
 * anchors, never a new anchoring model; decisions.md 2026-08-14 point 2).
 * A highlight whose own quote can no longer be found in the book (the same
 * "unanchored" outcome the Scan already accepts) is skipped rather than
 * guessing a position.
 */
function annotationHits(
  db: Database.Database,
  resourceId: string,
  index: SectionOffsetIndex,
  query: string,
  mode: SearchMatchMode,
): SearchHit[] {
  const hits: SearchHit[] = [];

  for (const highlight of listHighlightsWithThreadsForResource(db, resourceId)) {
    const located = locateAnchor(index, highlight.spineIndex, {
      exact: highlight.exact,
      prefix: highlight.prefix,
      suffix: highlight.suffix,
    });
    if (!located) continue;

    const base = {
      spineIndex: located.spineIndex,
      offset: located.offset,
      percent: located.percent,
      anchor: { prefix: highlight.prefix, exact: highlight.exact, suffix: highlight.suffix },
      highlightId: highlight.id,
    };

    if (containsMatch(highlight.exact, query, mode)) {
      hits.push({ ...base, source: "highlight", snippet: highlight.exact });
    }

    const noteMatch = highlight.note ? findAllOccurrences(highlight.note, query, mode)[0] : undefined;
    if (highlight.note && noteMatch) {
      hits.push({
        ...base,
        source: "note",
        snippet: snippetAround(highlight.note, noteMatch.start, noteMatch.end),
      });
    }

    if (highlight.thread) {
      // Full thread bodies, not just the first line — the M9 Scan filter's
      // real gap (TASKS.md M24 B): a question asked three messages deep was
      // never findable before.
      for (const message of listMessagesForThread(db, highlight.thread.id)) {
        const match = findAllOccurrences(message.content, query, mode)[0];
        if (!match) continue;
        hits.push({
          ...base,
          source: "thread",
          snippet: snippetAround(message.content, match.start, match.end),
        });
      }
    }
  }

  return hits;
}

/**
 * `GET /api/resources/:id/search?q=&mode=` (SPEC.md "HTTP API"): one book's
 * text and its annotations, ordered by position in the book, undefined when
 * the resource doesn't exist. Deliberately without FTS5 (M28's job, not this
 * milestone's — TASKS.md B) and without a new anchoring model.
 *
 * How a hit becomes a painted mark, amended by M24.1 C: an *annotation* hit
 * still round-trips through `findAnchorInText`, which is the forgiving
 * re-locate a highlight needs. A *text* hit no longer does — its anchor is
 * one occurrence among many identical ones, and a forgiving search collapses
 * every one of them onto the first. The reader re-finds text hits by
 * occurrence instead (web/src/search/hitLocation.ts), using the same
 * matching rule this scanned with, which is why `mode` travels with the
 * query rather than being a server-side preference.
 */
export function searchResource(
  db: Database.Database,
  resourceId: string,
  query: string,
  mode: SearchMatchMode = "word",
): SearchHit[] | undefined {
  const resource = getResourceById(db, resourceId);
  if (!resource) return undefined;

  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const sections = getResourceTextSections(db, resourceId);
  const index = buildSectionOffsetIndex(sections);

  const hits = [
    ...textHits(index, trimmed, mode),
    ...annotationHits(db, resourceId, index, trimmed, mode),
  ];
  hits.sort((a, b) => (a.spineIndex !== b.spineIndex ? a.spineIndex - b.spineIndex : a.offset - b.offset));
  return hits;
}
