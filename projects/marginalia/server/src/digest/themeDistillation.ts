// extract() requires zod/v4 schema instances — see llm/provider.ts's comment.
import { z } from "zod/v4";
import type Database from "better-sqlite3";
import type { Resource } from "@marginalia/shared";
import type { LLMProvider } from "../llm/provider.js";
import { sectionLabel } from "../llm/context.js";
import { levenshteinSimilarity, slugify } from "../vault/concepts.js";
import { listThematicDigests } from "./thematicStore.js";
import { resolveCanonicalThemes, replaceBookThemes, listBookThemes, type BookTheme } from "./canonicalThemes.js";

const DistillationSchema = z.object({
  themes: z
    .array(
      z.object({
        name: z.string(),
        children: z.array(z.string()),
      }),
    )
    .min(1)
    .max(8),
});

function instructions(): string {
  return (
    `You are distilling a book's per-chapter themes into a small set of book-level themes a ` +
    `reader could hold in their head — not a list of everything the book touches on, but the ` +
    `handful of large ideas the specific chapter-level themes below are all instances of.\n\n` +
    `Group the chapter-level themes under 6 to 8 broader book-level themes. Each book-level name ` +
    `should read as a genuinely broader idea, not just a copy of one chapter's own theme name ` +
    `(unless that name already IS the broad idea). Aim to cover every chapter-level theme, but do ` +
    `not force an obvious outlier under a group it doesn't belong in.\n\n` +
    `Respond with a single JSON object:\n` +
    `{"themes": [{"name": "a broad book-level theme name", "children": ["chapter-level theme name", "..."]}]}\n\n` +
    `"children" entries must be copied VERBATIM from the chapter-level themes given below — do not ` +
    `paraphrase or invent one. Return 6 to 8 top-level entries. Return only the JSON object, no ` +
    `other text.`
  );
}

function buildInput(
  title: string,
  author: string | null,
  chapters: { label: string; analysis: string; themes: string[] }[],
): string {
  const header = author ? `${title} by ${author}` : title;
  const body = chapters
    .map((c) => `${c.label}\nAnalysis: ${c.analysis}\nThemes: ${c.themes.join(", ")}`)
    .join("\n\n");
  return `${header}\n\n${body}`;
}

export interface ThemeDistillationOutcome {
  bookThemes: BookTheme[];
}

/**
 * Runs the M24.5 distillation pass: reads every chapter's already-stored
 * thematic analysis and theme list — never the book text again (TASKS.md
 * M24.5 §1's "a small call over material already paid for") — and asks the
 * model to fold them under 6-8 book-level themes, each carrying the
 * chapter-level themes it's the parent of.
 *
 * "LLM proposes, code disposes" (settled decision 2): every returned child
 * name is checked against the resource's real chapter-level vocabulary
 * before anything is persisted, and a chapter theme the model dropped (or
 * whose reply got filtered out) is assigned in code, to the book-level name
 * it's textually nearest to — TASKS.md's "every chapter theme is assigned a
 * parent" is a guarantee this function keeps, not something left to the
 * model's thoroughness.
 */
export async function runThemeDistillation(
  db: Database.Database,
  provider: LLMProvider,
  resource: Resource,
  signal?: AbortSignal,
): Promise<ThemeDistillationOutcome> {
  const thematicDigests = listThematicDigests(db, resource.id);
  const chapters = thematicDigests
    .filter((t) => t.themes.length > 0)
    .map((t) => ({
      label: sectionLabel(t.spineIndex, resource.metadata.chapterTitles),
      analysis: t.analysis,
      themes: t.themes,
    }));

  const allChapterThemes = [...new Set(chapters.flatMap((c) => c.themes))];
  if (allChapterThemes.length === 0) {
    replaceBookThemes(db, resource.id, [], new Map());
    return { bookThemes: [] };
  }

  const result = await provider.extract({
    instructions: instructions(),
    input: buildInput(resource.title, resource.author, chapters),
    schema: DistillationSchema,
    signal,
  });

  const allowedChildren = new Set(allChapterThemes);
  const proposed = result.themes
    .map((t) => ({ name: t.name.trim(), children: t.children.filter((c) => allowedChildren.has(c)) }))
    .filter((t) => t.name.length > 0);

  const parents = resolveCanonicalThemes(
    db,
    proposed.map((t) => t.name),
  );

  const childrenByParentId = new Map<string, string[]>();
  for (let i = 0; i < parents.length; i++) {
    const parentId = parents[i].id;
    const list = childrenByParentId.get(parentId) ?? [];
    list.push(...proposed[i].children);
    childrenByParentId.set(parentId, list);
  }

  if (parents.length > 0) {
    const assignedThemes = new Set<string>();
    for (const list of childrenByParentId.values()) for (const theme of list) assignedThemes.add(theme);

    for (const theme of allChapterThemes) {
      if (assignedThemes.has(theme)) continue;
      let bestIndex = 0;
      let bestScore = -1;
      for (let i = 0; i < parents.length; i++) {
        const score = levenshteinSimilarity(slugify(theme), slugify(parents[i].name));
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }
      const parentId = parents[bestIndex].id;
      const list = childrenByParentId.get(parentId) ?? [];
      list.push(theme);
      childrenByParentId.set(parentId, list);
    }
  }

  replaceBookThemes(db, resource.id, parents, childrenByParentId);
  return { bookThemes: listBookThemes(db, resource.id) };
}
