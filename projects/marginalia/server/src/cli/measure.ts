/**
 * Dev CLI: M34 §0c — report §0a and §0b back to the operator.
 *
 *   pnpm --filter server measure
 *
 * §0c asks a question that cannot be answered by argument: *the suspected
 * cause of a failed quote is provider-dependent.* On a hosted model a chapter
 * never splits and a quote comes from text the model just read; on a small
 * local model nearly every chapter splits and every quote passes through
 * `mergeThematicParts`, which is handed the parts' summaries and never the
 * chapter's text. Whether M35 §B is a footnote or a headline turns entirely
 * on which of those this operator's digest role actually is — so this reads
 * the configured role, the real books, and the data §0a/§0b accrue, and
 * prints the answer rather than an estimate.
 *
 * Read-only by construction: it opens the same database the server does and
 * only ever SELECTs. Re-run it as data accrues; the numbers move.
 */
import { getDb } from "../db.js";
import {
  getResourceTextSections,
  listResourceSummaries,
} from "../library/store.js";
import { getRoleProfileRaw } from "../settings/providers.js";
import { listThematicDigests } from "../digest/thematicStore.js";
import { locateQuoteAnchor, chapterStartAnchor } from "../digest/chapterAnchor.js";
import { contextTokensForModel } from "../llm/anthropic.js";

// Mirrors thematicBuild.ts's budget arithmetic. Duplicated deliberately —
// this is a *report on* that code, and a report that imports the number it is
// checking cannot catch the two drifting apart.
const CHARS_PER_TOKEN = 3.5;
const MAP_BUDGET_FRACTION = 0.25;

function pct(n: number, of: number): string {
  return of === 0 ? "—" : `${((100 * n) / of).toFixed(0)}%`;
}

/** The context window the digest role's provider will actually report. */
function digestRoleContextTokens(profile: {
  provider: string;
  anthropicModel: string;
  claudeAgentModel: string;
  openaiContextTokens: number;
}): number | null {
  switch (profile.provider) {
    case "anthropic":
      return contextTokensForModel(profile.anthropicModel);
    case "claude-agent":
      return profile.claudeAgentModel.includes("[1m]") ? 1_000_000 : 200_000;
    case "openai-compatible":
      return profile.openaiContextTokens;
    case "codex-cli":
      return 272_000;
    default:
      return null;
  }
}

function main(): void {
  const db = getDb();

  // -- The fork §0c turns on ------------------------------------------------
  const profile = getRoleProfileRaw(db, "digest");
  if (!profile) {
    console.log("No provider is assigned to the digest role — nothing to measure.");
    return;
  }
  const contextTokens = digestRoleContextTokens(profile);
  const model =
    profile.provider === "openai-compatible"
      ? profile.openaiModel
      : profile.provider === "anthropic"
        ? profile.anthropicModel
        : profile.provider === "claude-agent"
          ? profile.claudeAgentModel
          : profile.codexModel;

  console.log("=== M34 §0c — the digest role ===");
  console.log(`profile      ${profile.name} (${profile.provider})`);
  console.log(`model        ${model || "—"}`);
  console.log(`context      ${contextTokens === null ? "unknown" : `${contextTokens.toLocaleString()} tok`}`);
  if (contextTokens === null) {
    console.log("Cannot compute a map budget for this provider; the split table is skipped.");
  }
  const budgetChars = contextTokens === null ? null : contextTokens * MAP_BUDGET_FRACTION * CHARS_PER_TOKEN;
  if (budgetChars !== null) {
    console.log(`map budget   ${Math.round(budgetChars).toLocaleString()} chars per thematic call`);
  }
  console.log();

  const resources = listResourceSummaries(db);

  // -- Does a chapter split? -----------------------------------------------
  // Projected from the real section lengths rather than waiting for a run:
  // splitIntoChunks is a pure function of the text and the budget, so this is
  // the same answer a run would give, available now.
  if (budgetChars !== null) {
    console.log("=== Chapters that exceed the map budget (i.e. split, and merge) ===");
    for (const r of resources) {
      const lengths = getResourceTextSections(db, r.id).map((s) => s.text.length);
      if (lengths.length === 0) continue;
      const over = lengths.filter((n) => n > budgetChars).length;
      const sorted = [...lengths].sort((a, b) => a - b);
      console.log(
        `${r.title}\n` +
          `  sections=${lengths.length}  median=${sorted[Math.floor(sorted.length / 2)].toLocaleString()}` +
          `  max=${Math.max(...lengths).toLocaleString()}` +
          `  split=${over}/${lengths.length} (${pct(over, lengths.length)})`,
      );
    }
    console.log();
  }

  // -- §0b, read back off what has already been generated -------------------
  // The live log line is per-run; this is the standing tally over every
  // thematic digest in the library, so the report is useful before the next
  // run as well as after it.
  console.log("=== M34 §0b — the shape of stored thematic results ===");
  let anyThematic = false;
  for (const r of resources) {
    const digests = listThematicDigests(db, r.id);
    if (digests.length === 0) continue;
    anyThematic = true;
    const sections = new Map(getResourceTextSections(db, r.id).map((s) => [s.spineIndex, s.text]));
    let themes = 0;
    let atThemeCeiling = 0;
    let questions = 0;
    let atQuestionCeiling = 0;
    let located = 0;
    for (const d of digests) {
      themes += d.themes.length;
      if (d.themes.length >= 8) atThemeCeiling++;
      questions += d.questions.length;
      if (d.questions.length >= 3) atQuestionCeiling++;
      const text = sections.get(d.spineIndex) ?? "";
      for (const q of d.questions) {
        if (locateQuoteAnchor(text, q.quote) !== null) located++;
      }
    }
    console.log(
      `${r.title}\n` +
        `  chapters=${digests.length}` +
        `  themes=${(themes / digests.length).toFixed(1)} avg (${atThemeCeiling} at the ceiling of 8)\n` +
        `  questions=${(questions / digests.length).toFixed(1)} avg (${atQuestionCeiling} at the ceiling of 3)\n` +
        `  quotes located=${located}/${questions} (${pct(located, questions)})  ` +
        `— the rest anchor at the chapter's opening line`,
    );
  }
  if (!anyThematic) console.log("No thematic digests generated yet.");
  console.log();

  // -- §0a, plus a retroactive read of rows created before migration 28 -----
  console.log("=== M34 §0a — how machine-made anchors landed ===");
  const tally = db
    .prepare(
      `SELECT anchor_source, COUNT(*) AS n FROM highlights GROUP BY anchor_source ORDER BY anchor_source`,
    )
    .all() as { anchor_source: string; n: number }[];
  for (const row of tally) {
    console.log(`  ${row.anchor_source === "" ? "'' (reader-made)" : row.anchor_source}: ${row.n}`);
  }

  // Rows created before migration 28 all carry ''. A machine-made one is
  // still identifiable — it has the unresolvable CFI — and a chapter-start
  // fallback is exactly reproducible from the chapter text, so the pre-
  // instrumentation history is recoverable rather than lost.
  const legacy = db
    .prepare(
      `SELECT resource_id, spine_index, exact, prefix FROM highlights
       WHERE anchor_source = '' AND cfi = 'epubcfi(unresolvable-chapter-anchor)'`,
    )
    .all() as { resource_id: string; spine_index: number; exact: string; prefix: string }[];
  if (legacy.length > 0) {
    const textCache = new Map<string, Map<number, string>>();
    let fellBack = 0;
    for (const h of legacy) {
      if (!textCache.has(h.resource_id)) {
        textCache.set(
          h.resource_id,
          new Map(getResourceTextSections(db, h.resource_id).map((s) => [s.spineIndex, s.text])),
        );
      }
      const text = textCache.get(h.resource_id)!.get(h.spine_index) ?? "";
      if (h.prefix === "" && text !== "" && chapterStartAnchor(text).exact === h.exact) fellBack++;
    }
    console.log(
      `  before migration 28: ${legacy.length} machine-made, of which ${fellBack} ` +
        `(${pct(fellBack, legacy.length)}) fell back to the chapter's opening line`,
    );
  }
}

main();
