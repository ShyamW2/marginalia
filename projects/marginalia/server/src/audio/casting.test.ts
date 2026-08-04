import { describe, expect, it } from "vitest";
import type { Voice } from "@marginalia/shared";
import { assignVoices, type AssignableCharacter } from "./casting.js";

const VOICES: Voice[] = [
  { id: "af_alpha", label: "Alpha", gender: "female" },
  { id: "af_beta", label: "Beta", gender: "female" },
  { id: "am_gamma", label: "Gamma", gender: "male" },
  { id: "am_delta", label: "Delta", gender: "male" },
  { id: "an_epsilon", label: "Epsilon", gender: "neutral" },
];

function character(overrides: Partial<AssignableCharacter> = {}): AssignableCharacter {
  return { name: "Alice", gender: "unknown", ageHint: "unknown", lineCountHint: "few", ...overrides };
}

describe("assignVoices", () => {
  it("gives each character a gender-compatible voice", () => {
    const characters = [
      character({ name: "Alice", gender: "female" }),
      character({ name: "Bob", gender: "male" }),
    ];
    const assignments = assignVoices(characters, VOICES);
    const byId = new Map(VOICES.map((v) => [v.id, v]));
    expect(byId.get(assignments.get("Alice")!)?.gender).toBe("female");
    expect(byId.get(assignments.get("Bob")!)?.gender).toBe("male");
  });

  it("never reuses a voice while an unused compatible one remains", () => {
    const characters = [
      character({ name: "Alice", gender: "female" }),
      character({ name: "Beatrice", gender: "female" }),
    ];
    const assignments = assignVoices(characters, VOICES);
    expect(assignments.get("Alice")).not.toBe(assignments.get("Beatrice"));
  });

  it("falls back to reuse once every compatible voice is taken, rather than leaving a character unassigned", () => {
    const femaleOnly = VOICES.filter((v) => v.gender === "female"); // exactly two
    const characters = [
      character({ name: "A", gender: "female" }),
      character({ name: "B", gender: "female" }),
      character({ name: "C", gender: "female" }),
    ];
    const assignments = assignVoices(characters, femaleOnly);
    expect(assignments.size).toBe(3);
    expect(["af_alpha", "af_beta"]).toContain(assignments.get("C"));
  });

  it("assigns majors (many lines) before minors, so majors get first pick of unused voices", () => {
    const characters = [
      character({ name: "Minor", gender: "unknown", lineCountHint: "few" }),
      character({ name: "Major", gender: "unknown", lineCountHint: "many" }),
    ];
    // Reserve every voice except one so only the processing order decides
    // who gets the sole remaining unused voice.
    const reserved = VOICES.slice(1).map((v) => v.id);
    const assignments = assignVoices(characters, VOICES, reserved);
    expect(assignments.get("Major")).toBe(VOICES[0].id);
  });

  it("avoids an already-used voice (e.g. the narrator's) while an unused compatible one remains", () => {
    const characters = [character({ name: "Alice", gender: "female" })];
    const assignments = assignVoices(characters, VOICES, ["af_alpha"]);
    expect(assignments.get("Alice")).toBe("af_beta");
  });

  it("is deterministic: identical input always produces the identical assignment", () => {
    const characters = [
      character({ name: "Alice", gender: "female", lineCountHint: "many" }),
      character({ name: "Bob", gender: "male", lineCountHint: "few" }),
      character({ name: "Charlie", gender: "unknown", lineCountHint: "few" }),
    ];
    const first = assignVoices(characters, VOICES);
    const second = assignVoices(characters, VOICES);
    expect([...second.entries()]).toEqual([...first.entries()]);
  });

  it("an unknown-gender character can take a neutral voice or any other", () => {
    const characters = [character({ name: "Narrator's foil", gender: "unknown" })];
    const assignments = assignVoices(characters, VOICES);
    expect(VOICES.map((v) => v.id)).toContain(assignments.get("Narrator's foil"));
  });

  it("returns no assignments when there are no voices at all", () => {
    expect(assignVoices([character()], [])).toEqual(new Map());
  });
});
