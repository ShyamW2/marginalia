import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { Resource } from "@marginalia/shared";
import { DIGEST_DIR } from "../paths.js";
import { getResourceTextSections } from "../library/store.js";
import { sectionLabel } from "../llm/context.js";
import { getBookDigest, listChapterDigests } from "./store.js";

export function digestMarkdownPath(resourceId: string): string {
  return path.join(DIGEST_DIR, `${resourceId}.md`);
}

/**
 * SQLite stays the source of truth; this is a deterministically regenerated
 * projection — same pattern the vault compiler uses, and for the same
 * reason (settled decision 6: never parsed back). A pure function of the
 * digest rows currently in the DB, so regenerating with nothing changed
 * produces a byte-identical file — no `Date.now()`/wall-clock reads here,
 * only the digests' own stored `generatedAt` timestamps.
 */
export function renderDigestMarkdown(db: Database.Database, resource: Resource): string {
  const chapters = listChapterDigests(db, resource.id);
  const book = getBookDigest(db, resource.id);
  const allSections = getResourceTextSections(db, resource.id).sort(
    (a, b) => a.spineIndex - b.spineIndex,
  );
  const coveredIndices = new Set(chapters.map((c) => c.spineIndex));
  const chapterByIndex = new Map(chapters.map((c) => [c.spineIndex, c]));

  const lastGeneratedAt = [book?.generatedAt, ...chapters.map((c) => c.generatedAt)]
    .filter((d): d is string => Boolean(d))
    .sort()
    .at(-1);

  const lines: string[] = [];
  lines.push(`# ${resource.title}`);
  if (resource.author) lines.push(`*by ${resource.author}*`);
  lines.push("");
  lines.push(
    lastGeneratedAt
      ? `*Digest generated ${lastGeneratedAt}. This page is a regenerated projection of the SQLite digest — hand-edits are overwritten on the next run, never read back.*`
      : `*Not yet digested. Start a digest from the Scan's spotlight or the reader's "digest this chapter" shortcut.*`,
  );

  if (book) {
    lines.push("", "## Synopsis", "", book.synopsis);
    if (book.cast.length > 0) {
      lines.push("", "## Cast", "");
      for (const member of book.cast) {
        lines.push(`- **${member.name}** — ${member.description}`);
      }
    }
    if (book.themes.length > 0) {
      lines.push("", "## Themes", "", book.themes.join(", "));
    }
  }

  lines.push("", "## Chapters", "");
  if (allSections.length === 0) {
    lines.push("_No chapters extracted for this book._");
  }
  for (const section of allSections) {
    const label = sectionLabel(section.spineIndex, resource.metadata.chapterTitles);
    const chapter = chapterByIndex.get(section.spineIndex);
    if (!chapter) {
      lines.push(`### ${label} — not yet digested`, "");
      continue;
    }
    lines.push(`### ${label}`, "", chapter.summary);
    const meta: string[] = [];
    if (chapter.characters.length > 0) meta.push(`Characters: ${chapter.characters.join(", ")}`);
    if (chapter.themes.length > 0) meta.push(`Themes: ${chapter.themes.join(", ")}`);
    if (meta.length > 0) lines.push("", `*${meta.join(" · ")}*`);
    lines.push("");
  }

  const uncoveredCount = allSections.filter((s) => !coveredIndices.has(s.spineIndex)).length;
  if (uncoveredCount > 0) {
    lines.push(`_${uncoveredCount} of ${allSections.length} chapters not yet digested._`);
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export function writeDigestMarkdown(db: Database.Database, resource: Resource): string {
  const content = renderDigestMarkdown(db, resource);
  fs.mkdirSync(DIGEST_DIR, { recursive: true });
  fs.writeFileSync(digestMarkdownPath(resource.id), content, "utf-8");
  return content;
}
