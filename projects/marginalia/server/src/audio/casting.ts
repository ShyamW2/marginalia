import type { CastAgeHint, CastCharacterGender, CastLineCountHint, Voice } from "@marginalia/shared";

/**
 * Voice assignment (AUDIO.md "Casting": "Voice assignment is code, not the
 * model"). Deterministic: narrator first (the caller reserves its voice via
 * `alreadyUsedVoiceIds`, before calling this), then characters by
 * `lineCountHint` (majors first) then appearance order, matching gender,
 * never reusing a voice while an unused compatible one remains.
 *
 * // SPEC-GAP: AUDIO.md also says "matching gender/ageHint", but `Voice`
 * // (engine.ts, kokoro.ts) carries no age dimension at all — kokoro's own
 * // voice metadata is just id/name/gender/language. There is nothing to
 * // match `ageHint` against, so it's informational only here (surfaced to
 * // the casting UI, not consumed by assignment). Logged in NOTES.md.
 */
export interface AssignableCharacter {
  name: string;
  gender: CastCharacterGender;
  ageHint: CastAgeHint;
  lineCountHint: CastLineCountHint;
}

/** A voice is compatible with a character if the character's gender is
 * unspecified, the voice itself is gender-neutral, or the two match
 * outright. `'unknown'`/`'neutral'` are the wildcards on their respective
 * sides. */
function isCompatible(voice: Voice, gender: CastCharacterGender): boolean {
  return gender === "unknown" || voice.gender === "neutral" || voice.gender === gender;
}

/**
 * Returns `name -> voiceId`. `alreadyUsedVoiceIds` seeds the usage count so
 * voices already spoken for (the narrator, or a user's locked override on
 * another character) are avoided while any unused compatible voice remains,
 * without ever making them literally unpickable — if the pool is smaller
 * than the cast, reuse is the honest fallback, not a crash.
 */
export function assignVoices(
  characters: AssignableCharacter[],
  voices: Voice[],
  alreadyUsedVoiceIds: Iterable<string> = [],
): Map<string, string> {
  const assignments = new Map<string, string>();
  if (voices.length === 0) return assignments;

  const usage = new Map<string, number>(voices.map((v) => [v.id, 0]));
  for (const id of alreadyUsedVoiceIds) {
    if (usage.has(id)) usage.set(id, (usage.get(id) ?? 0) + 1);
  }

  // Majors (many lines) before minors (few), stable within each tier so
  // "appearance order" (the order the digest's cast array already lists
  // them in) breaks ties — never re-sorted by name or any other key.
  const ordered = characters
    .map((c, index) => ({ c, index }))
    .sort((a, b) => {
      if (a.c.lineCountHint !== b.c.lineCountHint) return a.c.lineCountHint === "many" ? -1 : 1;
      return a.index - b.index;
    });

  for (const { c } of ordered) {
    const compatible = voices.filter((v) => isCompatible(v, c.gender));
    // Falls back to the whole pool only if literally no voice matches this
    // character's stated gender — never leaves a character unassigned.
    const candidates = compatible.length > 0 ? compatible : voices;
    const best = candidates.reduce((best, v) => {
      const vUsage = usage.get(v.id) ?? 0;
      const bestUsage = usage.get(best.id) ?? 0;
      if (vUsage !== bestUsage) return vUsage < bestUsage ? v : best;
      // Deterministic tie-break so identical input always produces the
      // identical assignment (AUDIO.md testing: "re-running it is stable").
      return v.id < best.id ? v : best;
    });
    assignments.set(c.name, best.id);
    usage.set(best.id, (usage.get(best.id) ?? 0) + 1);
  }

  return assignments;
}
