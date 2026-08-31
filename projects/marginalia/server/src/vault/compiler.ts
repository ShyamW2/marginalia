// The extract() schema must be zod/v4 (see llm/provider.ts's comment) —
// @anthropic-ai/sdk's zodOutputFormat() requires a zod/v4 schema instance,
// structurally distinct from the classic "zod" (v3) used at the HTTP
// boundary in shared/.
import { z } from "zod/v4";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { Highlight, HighlightWithThread, Message, PublishResult, Resource } from "@marginalia/shared";
import { listHighlightsForThread, listHighlightsWithThreadsForResource } from "../annotations/highlights.js";
import { isReaderOrigin } from "../annotations/highlightOrigin.js";
import { listMessagesForThread } from "../annotations/threads.js";
import { sectionLabel } from "../llm/context.js";
import { getResourceById } from "../library/store.js";
import { getNotepadForPublish, recordNotepadPublish } from "../notepad/store.js";
import type { LLMProvider } from "../llm/provider.js";
import {
  listExistingConcepts,
  matchConcept,
  sanitizeFilename,
  type ExistingConcept,
} from "./concepts.js";
import { writeVaultFile } from "./writeVaultFile.js";
import {
  getPublishRecord,
  listPublishedNotesForResource,
  recordPublish,
} from "./publishStore.js";

const ThreadDistillationSchema = z.object({
  title: z.string(),
  summary: z.string(),
  concepts: z
    .array(
      z.object({
        name: z.string(),
        aliases: z.array(z.string()),
        gloss: z.string(),
      }),
    )
    .max(5),
});
type ThreadDistillation = z.infer<typeof ThreadDistillationSchema>;

const DISTILL_INSTRUCTIONS = `You distill a reader's inline conversation about a highlighted book
passage into a short note for their personal knowledge vault.

Respond with a single JSON object with exactly these keys:
{
  "title": "a short note title, a few words, not a full sentence",
  "summary": "a 2-6 sentence distilled insight in markdown, not a transcript",
  "concepts": [ { "name": "Canonical Title Case concept name", "aliases": ["alternate names"], "gloss": "one-line definition" } ]
}

Include at most 5 concepts worth tracking as personal knowledge-graph nodes.
If none are worth tracking, use an empty array. Return only the JSON
object, no other text.`;

// The first user message in a thread carries the SPEC-templated highlight
// framing ("The reader highlighted this passage: ... Their question: ...");
// the transcript we feed to distillation should read as a plain
// conversation, matching the same stripping ThreadPanel.tsx does for display.
function displayableQuestion(content: string): string {
  const match = /Their question: ([\s\S]*)$/.exec(content);
  return match ? match[1] : content;
}

/**
 * M35 §D5a: a thread can now anchor several passages, so the distillation
 * call sees all of them (reading order, from `listHighlightsForThread`) —
 * one quote is still the common case and reads exactly as before; more than
 * one is labelled by chapter so the model doesn't run them together.
 */
function passagesBlock(sources: Highlight[], chapterTitles: Record<string, string> | undefined): string {
  if (sources.length <= 1) {
    return `Highlighted passage:\n> ${sources[0]?.exact ?? ""}`;
  }
  const list = sources
    .map((s) => `> ${s.exact}\n(${sectionLabel(s.spineIndex, chapterTitles)})`)
    .join("\n\n");
  return `Highlighted passages:\n${list}`;
}

function buildDistillInput(
  sources: Highlight[],
  chapterTitles: Record<string, string> | undefined,
  messages: Message[],
): string {
  const transcript = messages
    .map((m) => {
      const text = m.role === "user" ? displayableQuestion(m.content) : m.content;
      return `${m.role === "user" ? "Reader" : "Assistant"}: ${text}`;
    })
    .join("\n\n");
  return `${passagesBlock(sources, chapterTitles)}\n\nConversation:\n${transcript}`;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function stripMdExt(relPath: string): string {
  return relPath.replace(/\.md$/, "");
}

function mentionLine(noteRelPath: string, threadId: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `- [[${stripMdExt(noteRelPath)}]] — ${date} <!-- thread:${threadId} -->`;
}

function createConceptNote(
  vaultPath: string,
  proposed: { name: string; aliases: string[]; gloss: string },
  noteRelPath: string,
  threadId: string,
): ExistingConcept {
  // The canonical name must match the filename exactly (minus ".md") — it's
  // what reading notes link to via `[[Name]]`. sanitizeFilename can change
  // the proposed name (e.g. strip a "/"), so re-derive it from the sanitized
  // filename rather than keeping the model's raw, unsanitized proposal —
  // otherwise the wikilink and the file on disk disagree and Obsidian can't
  // resolve it.
  const canonicalName = sanitizeFilename(proposed.name);
  const relPath = path.join("Concepts", `${canonicalName}.md`);
  const created = new Date().toISOString();
  const aliasLines = proposed.aliases.map((a) => `  - ${yamlString(a)}`).join("\n");
  const content = `---
aliases:
${aliasLines}
created: ${yamlString(created)}
---

${proposed.gloss}

## Mentions

${mentionLine(noteRelPath, threadId)}
`;
  writeVaultFile(vaultPath, relPath, content);
  return { name: canonicalName, aliases: proposed.aliases, relPath };
}

/** Idempotent: skips if a mention line for this thread id already exists. */
function appendMention(
  vaultPath: string,
  concept: ExistingConcept,
  noteRelPath: string,
  threadId: string,
): void {
  const absolutePath = path.join(path.resolve(vaultPath), concept.relPath);
  const existingContent = fs.readFileSync(absolutePath, "utf8");
  if (existingContent.includes(`<!-- thread:${threadId} -->`)) return;

  const updated = `${existingContent.trimEnd()}\n${mentionLine(noteRelPath, threadId)}\n`;
  writeVaultFile(vaultPath, concept.relPath, updated);
}

/**
 * M35 §D5a: "one note with its sources listed in reading order" — a
 * multi-anchor annotation is one thought about several passages, so
 * splitting it at publish time (one note per anchor) would undo the feature
 * in the projection. A single anchor renders exactly as before (a bare
 * blockquote, no chapter label) — the common case's output doesn't change
 * shape just because the mechanism now supports more.
 */
function quoteBlock(sources: Highlight[], chapterTitles: Record<string, string> | undefined): string {
  if (sources.length <= 1) return `> ${sources[0]?.exact ?? ""}`;
  return sources
    .map((s) => `> ${s.exact}\n> — *${sectionLabel(s.spineIndex, chapterTitles)}*`)
    .join("\n\n");
}

function renderReadingNote(
  resource: Resource,
  sources: Highlight[],
  chapterTitles: Record<string, string> | undefined,
  threadId: string,
  distillation: ThreadDistillation,
  conceptNames: string[],
): string {
  const author = resource.author ?? "Unknown";
  const conceptLines = conceptNames.map((name) => `- [[${name}]]`).join("\n");
  return `---
book: ${yamlString(resource.title)}
author: ${yamlString(author)}
thread: ${yamlString(threadId)}
date: ${yamlString(new Date().toISOString())}
---

${quoteBlock(sources, chapterTitles)}

${distillation.summary}
${conceptLines ? `\n${conceptLines}\n` : ""}
Sources: ${resource.title} by ${author}
`;
}

/** A note the ledger remembers publishing, but that isn't actually on disk
 * at this vault path — e.g. the vault path setting changed since the ledger
 * row was written. Filtering these out keeps _Book.md from linking to files
 * that don't exist. */
function existsInVault(vaultPath: string, notePath: string): boolean {
  return fs.existsSync(path.join(path.resolve(vaultPath), notePath));
}

function writeBookOverview(
  db: Database.Database,
  vaultPath: string,
  resource: Resource,
): void {
  const notes = listPublishedNotesForResource(db, resource.id).filter((n) =>
    existsInVault(vaultPath, n.notePath),
  );
  if (notes.length === 0) return;

  const author = resource.author ?? "Unknown";
  const noteLines = notes.map((n) => `- [[${stripMdExt(n.notePath)}]]`).join("\n");
  const content = `---
title: ${yamlString(resource.title)}
author: ${yamlString(author)}
---

# ${resource.title}

*${author}*

## Notes

${noteLines}
`;
  writeVaultFile(
    vaultPath,
    path.join("Readings", sanitizeFilename(resource.title), "_Book.md"),
    content,
  );
}

/**
 * Compiles every not-yet-published thread of a resource into the vault
 * (SPEC vault/compiler.ts). "Up to date" has no cheap staleness signal
 * beyond a publishes row existing — the ledger has no message-count/version
 * column — so a thread with a row (and whose note is still actually present
 * at this vault path — see existsInVault) is treated as up to date and never
 * re-extracted. Re-running extract() unconditionally on identical input
 * isn't guaranteed byte-identical (LLM output varies run to run), which
 * would break the "publish again -> no changes" idempotency contract; the
 * row-existence check sidesteps that entirely. SPEC-GAP logged in NOTES.md.
 */
export async function publishResource(
  db: Database.Database,
  provider: LLMProvider,
  resourceId: string,
  vaultPath: string,
): Promise<PublishResult> {
  const resource = getResourceById(db, resourceId);
  if (!resource) {
    throw new Error("resource_not_found");
  }

  // M35 §C6: unconditional, regardless of §C7's toggle — a thematic-origin
  // primary highlight (§C5) never reaches the vault, even in the edge case
  // where a reader started and answered a conversation on one.
  const answeredHighlights = listHighlightsWithThreadsForResource(db, resourceId).filter(
    (h): h is HighlightWithThread & { thread: NonNullable<HighlightWithThread["thread"]> } =>
      h.thread !== null && h.thread.hasAnswer && isReaderOrigin(h),
  );

  let notes = 0;
  let conceptsCreated = 0;
  let conceptsLinked = 0;
  // Concepts already on disk, plus any created earlier in this same run —
  // so a second thread in this run can match a concept the first just made.
  const knownConcepts = listExistingConcepts(vaultPath);

  for (let i = 0; i < answeredHighlights.length; i++) {
    const highlight = answeredHighlights[i];
    const threadId = highlight.thread.id;

    // A ledger row alone isn't enough — if the vault path changed since this
    // thread was published (a different vault, or the same vault re-created
    // elsewhere), the note it points at may no longer exist. Re-publish in
    // that case rather than silently leaving the new vault without it.
    const existingRecord = getPublishRecord(db, threadId);
    if (existingRecord && existsInVault(vaultPath, existingRecord.notePath)) continue;

    const nn = String(i + 1).padStart(2, "0");
    // M35 §D5a: every anchor of this thread, reading-order — falls back to
    // the primary highlight alone if `thread_anchors` somehow has nothing
    // (shouldn't happen; createThread/migration 34 both guarantee coverage).
    const sources = listHighlightsForThread(db, threadId);
    const effectiveSources = sources.length > 0 ? sources : [highlight];
    const chapterTitles = resource.metadata.chapterTitles;
    const messages = listMessagesForThread(db, threadId);
    const distillation = await provider.extract({
      instructions: DISTILL_INSTRUCTIONS,
      input: buildDistillInput(effectiveSources, chapterTitles, messages),
      schema: ThreadDistillationSchema,
    });

    const noteRelPath = path.join(
      "Readings",
      sanitizeFilename(resource.title),
      `${nn} - ${sanitizeFilename(distillation.title.toLowerCase().replace(/\s+/g, "-"))}.md`,
    );

    const conceptNames: string[] = [];
    for (const proposed of distillation.concepts) {
      const match = matchConcept(knownConcepts, proposed);
      if (match) {
        appendMention(vaultPath, match, noteRelPath, threadId);
        conceptNames.push(match.name);
        conceptsLinked++;
      } else {
        const created = createConceptNote(vaultPath, proposed, noteRelPath, threadId);
        knownConcepts.push(created);
        conceptNames.push(created.name);
        conceptsCreated++;
      }
    }

    const noteContent = renderReadingNote(
      resource,
      effectiveSources,
      chapterTitles,
      threadId,
      distillation,
      conceptNames,
    );
    const contentHash = crypto.createHash("sha256").update(noteContent).digest("hex");
    writeVaultFile(vaultPath, noteRelPath, noteContent);
    recordPublish(db, threadId, noteRelPath, contentHash);
    notes++;
  }

  writeBookOverview(db, vaultPath, resource);

  return { notes, conceptsCreated, conceptsLinked };
}

const NOTEPAD_DISTILLATION_SCHEMA = z.object({
  concepts: z
    .array(
      z.object({
        name: z.string(),
        aliases: z.array(z.string()),
        gloss: z.string(),
      }),
    )
    .max(5),
});

const NOTEPAD_DISTILL_INSTRUCTIONS = `You review a reader's freeform scratch notes and identify
concepts worth tracking as personal knowledge-graph nodes.

Respond with a single JSON object with exactly this key:
{
  "concepts": [ { "name": "Canonical Title Case concept name", "aliases": ["alternate names"], "gloss": "one-line definition" } ]
}

Include at most 5 concepts worth tracking. If none are worth tracking, use an
empty array. Return only the JSON object, no other text.`;

const NOTEPAD_NOTE_PATH = "Notes/Desk Notepad.md";
// Fixed pseudo-thread id: the notepad is a single mutable note, not a
// per-thread one, but concept-mention idempotency (appendMention) keys off
// a stable id so republishing an unchanged concept list doesn't duplicate
// its "## Mentions" line.
const NOTEPAD_MENTION_ID = "desk-notepad";

function renderNotepadNote(content: string, conceptNames: string[]): string {
  const conceptLines = conceptNames.map((name) => `- [[${name}]]`).join("\n");
  return `---
title: "Desk Notepad"
updated: ${yamlString(new Date().toISOString())}
---

${content}
${conceptLines ? `\n## Concepts\n\n${conceptLines}\n` : ""}`;
}

/**
 * Publishes the desk notepad (M8, DESIGN.md "The notepad") through the same
 * vault/concept-linking machinery as thread publishing, but keyed on content
 * hash instead of a per-thread ledger row — the notepad is one mutable note,
 * republished in place each time its content changes (see notepad/store.ts).
 */
export async function publishNotepad(
  db: Database.Database,
  provider: LLMProvider,
  vaultPath: string,
): Promise<PublishResult> {
  const { content, upToDate } = getNotepadForPublish(db);
  if (upToDate) {
    return { notes: 0, conceptsCreated: 0, conceptsLinked: 0 };
  }

  let conceptsCreated = 0;
  let conceptsLinked = 0;
  const knownConcepts = listExistingConcepts(vaultPath);

  const distillation = await provider.extract({
    instructions: NOTEPAD_DISTILL_INSTRUCTIONS,
    input: content,
    schema: NOTEPAD_DISTILLATION_SCHEMA,
  });

  const conceptNames: string[] = [];
  for (const proposed of distillation.concepts) {
    const match = matchConcept(knownConcepts, proposed);
    if (match) {
      appendMention(vaultPath, match, NOTEPAD_NOTE_PATH, NOTEPAD_MENTION_ID);
      conceptNames.push(match.name);
      conceptsLinked++;
    } else {
      const created = createConceptNote(vaultPath, proposed, NOTEPAD_NOTE_PATH, NOTEPAD_MENTION_ID);
      knownConcepts.push(created);
      conceptNames.push(created.name);
      conceptsCreated++;
    }
  }

  writeVaultFile(vaultPath, NOTEPAD_NOTE_PATH, renderNotepadNote(content, conceptNames));
  recordNotepadPublish(db, content);

  return { notes: 1, conceptsCreated, conceptsLinked };
}
