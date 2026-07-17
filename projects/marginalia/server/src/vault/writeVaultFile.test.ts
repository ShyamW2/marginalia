import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeVaultFile } from "./writeVaultFile.js";

describe("writeVaultFile", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "marginalia-vault-"));
  });

  afterEach(() => {
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  it("writes a file, creating parent directories", () => {
    const target = writeVaultFile(vaultPath, "Readings/My Book/01 - note.md", "hello");
    expect(fs.readFileSync(target, "utf8")).toBe("hello");
    expect(target.startsWith(path.resolve(vaultPath))).toBe(true);
  });

  it("rejects a relative path that escapes the vault root", () => {
    expect(() => writeVaultFile(vaultPath, "../../etc/passwd", "pwned")).toThrow();
  });

  it("rejects an absolute path outside the vault", () => {
    expect(() => writeVaultFile(vaultPath, "/etc/passwd", "pwned")).toThrow();
  });

  it("rejects a path that traverses out and back in to a sibling", () => {
    expect(() => writeVaultFile(vaultPath, "Concepts/../../outside.md", "pwned")).toThrow();
  });
});
