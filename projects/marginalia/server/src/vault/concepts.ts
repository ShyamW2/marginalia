import fs from "node:fs";
import path from "node:path";

export interface ExistingConcept {
  name: string;
  aliases: string[];
  /** Path relative to the vault root, e.g. "Concepts/Bildungsroman.md". */
  relPath: string;
}

export interface ConceptProposal {
  name: string;
  aliases: string[];
}

/** Lowercase, alphanumeric-only, hyphen-separated — comparable across casing/punctuation. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Levenshtein edit distance similarity in [0, 1], normalized by the longer string's length. */
export function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }

  const distance = prev[b.length];
  return 1 - distance / maxLen;
}

const SIMILARITY_THRESHOLD = 0.85;

/**
 * SPEC concept-matching rule: slug-normalized names equal, OR any alias
 * equals an existing name/alias, OR normalized Levenshtein similarity of the
 * (slugified) names is >= 0.85. Returns the first matching existing concept,
 * or null if this is a genuinely new concept.
 */
export function matchConcept(
  existing: ExistingConcept[],
  proposal: ConceptProposal,
): ExistingConcept | null {
  const proposedSlug = slugify(proposal.name);
  const proposedAliasSlugs = proposal.aliases.map(slugify);
  const proposedAllSlugs = [proposedSlug, ...proposedAliasSlugs];

  for (const candidate of existing) {
    const candidateSlug = slugify(candidate.name);
    if (candidateSlug === proposedSlug) return candidate;

    const candidateAllSlugs = [candidateSlug, ...candidate.aliases.map(slugify)];
    if (candidateAllSlugs.some((s) => proposedAllSlugs.includes(s))) return candidate;

    if (levenshteinSimilarity(candidateSlug, proposedSlug) >= SIMILARITY_THRESHOLD) {
      return candidate;
    }
  }

  return null;
}

// SPEC-GAP: no YAML library is in the stack (SPEC's table doesn't name one),
// and the compiler is the only writer of this frontmatter, so a minimal
// hand-rolled parser for exactly the shape we generate (a flat `aliases:`
// list + `created:` scalar) is the boring choice over adding a dependency.
// Logged in NOTES.md.
function parseFrontmatter(content: string): { aliases: string[]; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!match) return { aliases: [], body: content };
  const [, frontmatter, body] = match;

  const aliases: string[] = [];
  let inAliases = false;
  for (const line of frontmatter.split(/\r?\n/)) {
    if (/^aliases:\s*$/.test(line)) {
      inAliases = true;
      continue;
    }
    const item = /^\s*-\s*(.+)$/.exec(line);
    if (inAliases && item) {
      aliases.push(item[1].trim());
      continue;
    }
    inAliases = false;
  }

  return { aliases, body };
}

/**
 * Lists every concept note currently in `<vaultPath>/Concepts/`. Returns an
 * empty list if the vault or the Concepts folder doesn't exist yet (a fresh
 * vault, or the very first publish).
 */
export function listExistingConcepts(vaultPath: string): ExistingConcept[] {
  const conceptsDir = path.join(vaultPath, "Concepts");
  let entries: string[];
  try {
    entries = fs.readdirSync(conceptsDir).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }

  return entries.map((filename) => {
    const relPath = path.join("Concepts", filename);
    const name = filename.slice(0, -".md".length);
    let aliases: string[] = [];
    try {
      const content = fs.readFileSync(path.join(conceptsDir, filename), "utf8");
      aliases = parseFrontmatter(content).aliases;
    } catch {
      // unreadable file — treat as a concept with no aliases rather than failing the publish
    }
    return { name, aliases, relPath };
  });
}

/** Characters invalid (or awkward) in filenames across Windows/macOS/Linux. */
export function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "-").replace(/\s+/g, " ").trim();
}
