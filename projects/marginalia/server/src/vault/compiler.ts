// The extract() schema must be zod/v4 (see llm/provider.ts's comment) —
// @anthropic-ai/sdk's zodOutputFormat() requires a zod/v4 schema instance,
// structurally distinct from the classic "zod" (v3) used at the HTTP
// boundary in shared/.
import { z } from "zod/v4";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { HighlightWithThread, Message, PublishResult, Resource } from "@marginalia/shared";
import { listHighlightsWithThreadsForResource } from "../annotations/highlights.js";
import { listMessagesForThread } from "../annotations/threads.js";
import { getResourceById } from "../library/store.js";
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

function buildDistillInput(highlight: HighlightWithThread, messages: Message[]): string {
  const transcript = messages
    .map((m) => {
      const text = m.role === "user" ? displayableQuestion(m.content) : m.content;
      return `${m.role === "user" ? "Reader" : "Assistant"}: ${text}`;
    })
    .join("\n\n");
  return `Highlighted passage:\n> ${highlight.exact}\n\nConversation:\n${transcript}`;
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

function renderReadingNote(
  resource: Resource,
  highlight: HighlightWithThread,
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

> ${highlight.exact}

${distillation.summary}
${conceptLines ? `\n${conceptLines}\n` : ""}
Sources: ${resource.title} by ${author}
`;
}

function writeBookOverview(
  db: Database.Database,
  vaultPath: string,
  resource: Resource,
): void {
  const notes = listPublishedNotesForResource(db, resource.id);
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
 * column — so a thread with a row is treated as up to date and never
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

  const answeredHighlights = listHighlightsWithThreadsForResource(db, resourceId).filter(
    (h): h is HighlightWithThread & { thread: NonNullable<HighlightWithThread["thread"]> } =>
      h.thread !== null && h.thread.hasAnswer,
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

    if (getPublishRecord(db, threadId)) continue;

    const nn = String(i + 1).padStart(2, "0");
    const messages = listMessagesForThread(db, threadId);
    const distillation = await provider.extract({
      instructions: DISTILL_INSTRUCTIONS,
      input: buildDistillInput(highlight, messages),
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

    const noteContent = renderReadingNote(resource, highlight, threadId, distillation, conceptNames);
    const contentHash = crypto.createHash("sha256").update(noteContent).digest("hex");
    writeVaultFile(vaultPath, noteRelPath, noteContent);
    recordPublish(db, threadId, noteRelPath, contentHash);
    notes++;
  }

  writeBookOverview(db, vaultPath, resource);

  return { notes, conceptsCreated, conceptsLinked };
}
