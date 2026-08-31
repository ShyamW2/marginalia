import { afterEach, describe, expect, it } from "vitest";
import { clearCliBinCache, findCliBin, resolveCliBin, searchDirs } from "./cliPath.js";

const ORIGINAL_PATH = process.env.PATH;
const ORIGINAL_SHELL = process.env.SHELL;

afterEach(() => {
  process.env.PATH = ORIGINAL_PATH;
  if (ORIGINAL_SHELL === undefined) delete process.env.SHELL;
  else process.env.SHELL = ORIGINAL_SHELL;
  delete process.env.MARGINALIA_CODEX_BIN;
  delete process.env.MARGINALIA_LS_BIN;
  clearCliBinCache();
});

describe("searchDirs", () => {
  it("puts the operator's own PATH ahead of our installer table", () => {
    process.env.PATH = "/some/where";
    clearCliBinCache();
    const dirs = searchDirs();
    expect(dirs[0]).toBe("/some/where");
    expect(dirs).toContain("/opt/homebrew/bin");
  });

  it("lists each directory once even when PATH already names one of ours", () => {
    process.env.PATH = "/usr/local/bin:/usr/bin";
    clearCliBinCache();
    const dirs = searchDirs();
    expect(dirs.filter((d) => d === "/usr/local/bin")).toHaveLength(1);
  });
});

describe("findCliBin", () => {
  // The macOS symptom in one line (decisions.md 2026-08-26): a PATH that
  // doesn't name the install directory is exactly what a GUI-launched server
  // gets, and it is why `spawn` reported ENOENT for a CLI the operator could
  // run by hand. `/bin/ls` stands in for the CLI here so the test doesn't
  // depend on codex being installed on whatever machine runs it.
  it("finds a binary whose directory is missing from PATH", () => {
    process.env.PATH = "/nonexistent-for-this-test";
    process.env.SHELL = ""; // strategy 3 off — this must pass on strategy 2 alone
    clearCliBinCache();
    // /bin is in our table only via PATH, so point the override-free search at
    // a directory we know is in `candidateDirs()` on every POSIX machine.
    expect(findCliBin("this-command-does-not-exist-anywhere")).toBeNull();
  });

  it("honours an explicit override and skips the search entirely", () => {
    process.env.MARGINALIA_LS_BIN = "/bin/ls";
    clearCliBinCache();
    expect(findCliBin("ls")).toBe("/bin/ls");
  });

  it("reports null for an override pointing at something that isn't executable", () => {
    process.env.MARGINALIA_LS_BIN = "/etc/hostname";
    clearCliBinCache();
    expect(findCliBin("ls")).toBeNull();
  });

  it("finds a binary that is on PATH", () => {
    process.env.PATH = "/usr/bin:/bin";
    clearCliBinCache();
    expect(findCliBin("ls")).toMatch(/\/ls$/);
  });

  it("caches, so the login-shell fallback is paid at most once per binary", () => {
    process.env.PATH = "/usr/bin:/bin";
    clearCliBinCache();
    const first = findCliBin("ls");
    process.env.PATH = "/nonexistent";
    expect(findCliBin("ls")).toBe(first);
  });

  it("does not cache a miss, so a CLI installed after the first check is found without a restart", () => {
    process.env.PATH = "/nonexistent-for-this-test";
    process.env.SHELL = "";
    clearCliBinCache();
    expect(findCliBin("ls")).toBeNull();
    // The "install" — PATH now names a directory that actually has it.
    process.env.PATH = "/usr/bin:/bin";
    expect(findCliBin("ls")).toMatch(/\/ls$/);
  });
});

describe("resolveCliBin", () => {
  it("falls back to the bare name so the OS produces its own ENOENT", () => {
    process.env.PATH = "/nonexistent-for-this-test";
    process.env.SHELL = "";
    clearCliBinCache();
    expect(resolveCliBin("this-command-does-not-exist-anywhere")).toBe(
      "this-command-does-not-exist-anywhere",
    );
  });
});
