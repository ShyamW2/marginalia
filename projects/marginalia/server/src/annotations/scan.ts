import type Database from "better-sqlite3";
import type { ScanBookChapter, ScanChapter, ScanData, ScanHighlight } from "@marginalia/shared";
import { getReadingPosition, getResourceById, getResourceTextSections } from "../library/store.js";
import { listHighlightsWithThreadsForResource } from "./highlights.js";
import { listMessagesForThread } from "./threads.js";
import { listTagsByHighlightId } from "./tags.js";
import { listThemesByHighlightId } from "./highlightThemes.js";
import { computeHighlightPositionPercent } from "./position.js";
import { listChapterDigests } from "../digest/store.js";
import { listThematicDigests } from "../digest/thematicStore.js";

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
  const totalLength = sections.reduce((sum, s) => sum + s.text.length, 0);

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

  const highlightRows = listHighlightsWithThreadsForResource(db, resourceId);
  const tagsByHighlight = listTagsByHighlightId(db, resourceId);
  const themesByHighlight = listThemesByHighlightId(db, resourceId);

  const highlights: ScanHighlight[] = highlightRows.map((h) => {
    const positionPercent = computeHighlightPositionPercent(db, resourceId, h.spineIndex, {
      exact: h.exact,
      prefix: h.prefix,
      suffix: h.suffix,
    });

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
  const hasDigest = listChapterDigests(db, resourceId).length > 0;
  const thematicByIndex = new Map(listThematicDigests(db, resourceId).map((t) => [t.spineIndex, t]));
  const bookChapters: ScanBookChapter[] = chapters.map((c) => {
    const t = thematicByIndex.get(c.spineIndex);
    const revealed = c.spineIndex <= bookmarkSpineIndex;
    const hasThematic = Boolean(t) && revealed;
    return {
      spineIndex: c.spineIndex,
      hasThematic,
      themes: hasThematic ? (t?.themes ?? []) : [],
    };
  });
  // Vocabulary only draws from what's actually shown here — a theme that
  // exists solely in a past-the-bookmark chapter shouldn't appear as a
  // filterable option before the reader's read that far.
  const themeVocabulary = [...new Set(bookChapters.flatMap((c) => c.themes))].sort();

  return {
    resource,
    totalHighlights: highlights.length,
    lastReadAt: readingPosition?.updatedAt ?? null,
    chapters,
    highlights,
    book: {
      hasDigest,
      themeVocabulary,
      chapters: bookChapters,
    },
  };
}
