import { describe, expect, it } from "vitest";
import { extractVerification, linesFrom, redactSecrets, stripAnsi } from "./authFlows.js";

// Built via fromCharCode rather than typed inline — a literal escape
// character embedded directly in source is easy to mangle by accident.
const ESC = String.fromCharCode(27);
function ansi(code: string, text: string): string {
  return `${ESC}[${code}m${text}${ESC}[0m`;
}

describe("stripAnsi", () => {
  it("removes colour escape codes, leaving the text intact", () => {
    expect(stripAnsi(ansi("94", "https://auth.openai.com/codex/device"))).toBe(
      "https://auth.openai.com/codex/device",
    );
  });

  it("passes plain text through unchanged", () => {
    expect(stripAnsi("Not logged in")).toBe("Not logged in");
  });
});

describe("linesFrom", () => {
  it("drops blank separator lines and strips colour codes, matching the real device-auth prompt's shape", () => {
    // Shape captured live from `codex login --device-auth` (codex-cli
    // 0.114.0, 2026-08-25) — see decisions.md and NOTES.md's M26 lead-in
    // entry. Colour placement reconstructed for the regex, not a
    // byte-for-byte transcript.
    const raw = [
      "",
      ansi("1", "Welcome to Codex"),
      ansi("90", "OpenAI's command-line coding agent"),
      "",
      "Follow these steps to sign in with ChatGPT using device code authorization:",
      "",
      "1. Open this link in your browser and sign in to your account",
      `   ${ansi("94", "https://auth.openai.com/codex/device")}`,
      "",
      `2. Enter this one-time code ${ansi("90", "(expires in 15 minutes)")}`,
      `   ${ansi("94", "B5D1-XQI8F")}`,
      "",
    ].join("\n");

    expect(linesFrom(raw)).toEqual([
      "Welcome to Codex",
      "OpenAI's command-line coding agent",
      "Follow these steps to sign in with ChatGPT using device code authorization:",
      "1. Open this link in your browser and sign in to your account",
      "https://auth.openai.com/codex/device",
      "2. Enter this one-time code (expires in 15 minutes)",
      "B5D1-XQI8F",
    ]);
  });

  it("redacts a credential-shaped line rather than passing it through to the API", () => {
    expect(linesFrom("refresh_token: abcdef1234567890abcdef1234567890")).toEqual([
      "[redacted — line mentioned a credential]",
    ]);
  });
});

describe("redactSecrets", () => {
  it("hides a whole line that names a credential, not just the value", () => {
    expect(redactSecrets("access_token: sk-abc123")).toBe("[redacted — line mentioned a credential]");
    expect(redactSecrets("Authorization: Bearer sometoken")).toBe(
      "[redacted — line mentioned a credential]",
    );
  });

  it("partially redacts every long opaque segment even with no label", () => {
    // A JWT-shaped string — each dot-separated segment is its own 24+ char
    // blob, and each gets caught independently (the `.` breaks the match).
    const jwtLike = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0";
    expect(redactSecrets(jwtLike)).toBe("eyJh…[redacted].eyJz…[redacted]");
  });

  it("partially redacts a single long opaque blob", () => {
    expect(redactSecrets("session=abcdef1234567890abcdef1234567890xyz")).toBe(
      "session=abcd…[redacted]",
    );
  });

  it("leaves a real device code and URL alone — both are meant to be shown", () => {
    expect(redactSecrets("B5D1-XQI8F")).toBe("B5D1-XQI8F");
    expect(redactSecrets("https://auth.openai.com/codex/device")).toBe(
      "https://auth.openai.com/codex/device",
    );
  });

  it("leaves ordinary prose alone", () => {
    expect(redactSecrets("OpenAI's command-line coding agent")).toBe(
      "OpenAI's command-line coding agent",
    );
  });
});

describe("extractVerification", () => {
  it("finds the URL and code from the real Codex device-auth output", () => {
    const lines = linesFrom(
      [
        "1. Open this link in your browser and sign in to your account",
        `   ${ansi("94", "https://auth.openai.com/codex/device")}`,
        "2. Enter this one-time code (expires in 15 minutes)",
        `   ${ansi("94", "B5D1-XQI8F")}`,
      ].join("\n"),
    );
    expect(extractVerification(lines)).toEqual({
      verificationUrl: "https://auth.openai.com/codex/device",
      code: "B5D1-XQI8F",
    });
  });

  it("returns nulls rather than throwing when nothing matches yet", () => {
    expect(extractVerification(["Starting…"])).toEqual({ verificationUrl: null, code: null });
    expect(extractVerification([])).toEqual({ verificationUrl: null, code: null });
  });

  it("doesn't mistake an ordinary word for a code", () => {
    expect(extractVerification(["Not logged in"])).toEqual({ verificationUrl: null, code: null });
  });
});
