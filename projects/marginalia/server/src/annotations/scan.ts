import type Database from "better-sqlite3";
import type { ScanBookChapter, ScanChapter, ScanData, ScanHighlight, ScanThemeZone } from "@marginalia/shared";
import { getReadingPosition, getResourceById, getResourceTextSections } from "../library/store.js";
import { listHighlightsWithThreadsForResource } from "./highlights.js";
import { isReaderOrigin } from "./highlightOrigin.js";
import { listMessagesForThread } from "./threads.js";
import { listTagsByHighlightId } from "./tags.js";
import { listThemesByHighlightId } from "./highlightThemes.js";
import { buildSectionOffsetIndex, locateAnchor } from "./sectionOffsets.js";
import { listChapterDigests } from "../digest/store.js";
import { listThematicDigests } from "../digest/thematicStore.js";
import { listBookThemes } from "../digest/canonicalThemes.js";
import { getLookahead } from "../digest/lookahead.js";
import { getShowThematicQuotes } from "../digest/thematicQuoteVisibility.js";
import { isChapterVisible } from "../digest/visibility.js";
import { computeThemeZone } from "../digest/themeZones.js";

function firstLine(text: string, maxLength = 140): string {
  const line = text.split("\n").find((l) => l.trim().length > 0) ?? "";
  return line.length > maxLength ? `${line.slice(0, maxLength - 1)}…` : line;
}

/**
 * Assembles everything the Scan (M9, DESIGN.md "Room 3") needs to render
 * without ever touching epub.js: chapter tick positions from spine-section
 * char lengths, and each highlight's true percent position (server-computed
 * — see position.ts), tags, importance, and a thread preview for the hover
 * ghost readout.
 */
export function buildScanData(db: Database.Database, resourceId: string): ScanData | undefined {
  const resource = getResourceById(db, resourceId);
  if (!resource) return undefined;

  const sections = getResourceTextSections(db, resourceId);
  // Built once and reused for every highlight below — computeHighlightPosition-
  // Percent used to re-fetch and re-sum the whole book's text per highlight
  // (M24 TASKS.md B).
  const offsetIndex = buildSectionOffsetIndex(sections);
  const totalLength = offsetIndex.totalLength;

  // M15 "real chapter axis": numbers are always available (a plain 1-based
  // sequence over spine order); names come from the EPUB's own NCX where its
  // import captured one for this spine index (library/epub.ts) — often not,
  // for front/back matter never listed in a table of contents.
  const chapterTitles = resource.metadata.chapterTitles ?? {};
  const chapters: ScanChapter[] = [];
  let cursor = 0;
  sections.forEach((section, index) => {
    chapters.push({
      spineIndex: section.spineIndex,
      chapterNumber: index + 1,
      title: chapterTitles[String(section.spineIndex)] ?? null,
      startPercent: totalLength > 0 ? cursor / totalLength : 0,
      lengthPercent: totalLength > 0 ? section.text.length / totalLength : 0,
    });
    cursor += section.text.length;
  });

  const allHighlightRows = listHighlightsWithThreadsForResource(db, resourceId);
  // M35 §C6/§C7: two different filters over the same rows, on purpose. The
  // reader-only set is what "how many highlights" ever means (§C6,
  // unconditional); the rendered set additionally includes thematic-origin
  // rows only when the reader has opted in (§C7's toggle, off by default) —
  // "only my own marks" is the reasonable expectation until then.
  const readerHighlightRows = allHighlightRows.filter(isReaderOrigin);
  const showThematicQuotes = getShowThematicQuotes(db, resourceId);
  const highlightRows = showThematicQuotes ? allHighlightRows : readerHighlightRows;
  const tagsByHighlight = listTagsByHighlightId(db, resourceId);
  const themesByHighlight = listThemesByHighlightId(db, resourceId);

  const highlights: ScanHighlight[] = highlightRows.map((h) => {
    const positionPercent =
      locateAnchor(offsetIndex, h.spineIndex, {
        exact: h.exact,
        prefix: h.prefix,
        suffix: h.suffix,
      })?.percent ?? null;

    let threadMessageCount = 0;
    let threadFirstLine: string | null = null;
    if (h.thread) {
      const messages = listMessagesForThread(db, h.thread.id);
      threadMessageCount = messages.length;
      const firstAnswer = messages.find((m) => m.role === "assistant");
      threadFirstLine = firstAnswer ? firstLine(firstAnswer.content) : null;
    }

    return {
      id: h.id,
      kind: h.kind,
      exact: h.exact,
      importance: h.importance,
      tags: tagsByHighlight.get(h.id) ?? [],
      themes: themesByHighlight.get(h.id) ?? [],
      note: h.note,
      positionPercent,
      threadId: h.thread?.id ?? null,
      hasAnswer: h.thread?.hasAnswer ?? false,
      threadMessageCount,
      threadFirstLine,
    };
  });

  const readingPosition = getReadingPosition(db, resourceId);

  // M19.5 "the semantic scan: two layers" — the Book layer. Chapter-
  // resolution, gated by the same bookmark signal as the digest page's
  // chapter entries (a theme label past the bookmark is a spoiler too).
  const bookmarkSpineIndex = readingPosition?.spineIndex ?? -1;
  const noMask = getLookahead(db, resourceId);
  const hasDigest = listChapterDigests(db, resourceId).length > 0;
  const thematicByIndex = new Map(listThematicDigests(db, resourceId).map((t) => [t.spineIndex, t]));
  const sectionTextByIndex = new Map(sections.map((s) => [s.spineIndex, s.text]));
  const bookChapters: ScanBookChapter[] = chapters.map((c) => {
    const t = thematicByIndex.get(c.spineIndex);
    const revealed = isChapterVisible(c.spineIndex, { bookmarkSpineIndex, noMask });
    const hasThematic = Boolean(t) && revealed;
    // M35 §E1-§E2: zones are located fresh here, against this chapter's own
    // full section text (never cached in thematic_digests.themes — same
    // "recompute wherever a quote actually becomes something" rule §C1's own
    // comment already settled) and converted from a chapter-local offset to
    // a book-wide percent the same way `locateAnchor` above does for the
    // Mine layer. Spoiler-gated by the same `revealed` check as `themes`
    // below — a precise sub-chapter span past the bookmark is exactly as
    // much of a spoiler as the chapter-wide band it would otherwise replace.
    const sectionText = hasThematic ? (sectionTextByIndex.get(c.spineIndex) ?? "") : "";
    const preceding = offsetIndex.precedingLength.get(c.spineIndex) ?? 0;
    const themeZones: ScanThemeZone[] = hasThematic
      ? (t?.themes ?? [])
          .map((theme): ScanThemeZone | null => {
            const zone = computeThemeZone(sectionText, theme);
            if (!zone) return null;
            return {
              name: theme.name,
              startPercent: totalLength > 0 ? (preceding + zone.startOffset) / totalLength : 0,
              lengthPercent: totalLength > 0 ? (zone.endOffset - zone.startOffset) / totalLength : 0,
              startQuote: zone.startQuote,
            };
          })
          .filter((z): z is ScanThemeZone => z !== null)
      : [];
    return {
      spineIndex: c.spineIndex,
      hasThematic,
      // M35 §C1: the Scan's Book layer still filters/legends by theme name
      // only — quotes are §E's job (sub-chapter zones), not this layer's.
      themes: hasThematic ? (t?.themes.map((theme) => theme.name) ?? []) : [],
      themeZones,
    };
  });
  // Vocabulary only draws from what's actually shown here — a theme that
  // exists solely in a past-the-bookmark chapter shouldn't appear as a
  // filterable option before the reader's read that far.
  const revealedThemes = new Set(bookChapters.flatMap((c) => c.themes));
  const themeVocabulary = [...revealedThemes].sort();
  // Same spoiler gate as bookChapters above, applied to the distilled layer:
  // a book-level theme whose every child sits past the bookmark is dropped
  // wholesale rather than shown as an empty, name-only legend entry — the
  // name itself ("Betrayal") is exactly the kind of spoiler M19.5 exists to
  // gate, so its mere presence in the list is withheld, not just its detail.
  const bookThemes = listBookThemes(db, resourceId)
    .map((t) => ({ ...t, children: t.children.filter((c) => revealedThemes.has(c)) }))
    .filter((t) => t.children.length > 0);

  return {
    resource,
    // §C6: always the reader-only count, independent of whether thematic
    // rows are currently being painted into `highlights` below.
    totalHighlights: readerHighlightRows.length,
    lastReadAt: readingPosition?.updatedAt ?? null,
    chapters,
    highlights,
    book: {
      hasDigest,
      themeVocabulary,
      bookThemes,
      chapters: bookChapters,
    },
  };
}
