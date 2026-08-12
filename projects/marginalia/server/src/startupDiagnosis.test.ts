import { describe, expect, it } from "vitest";
import { diagnoseNativeFailure, formatNativeFailure } from "./startupDiagnosis.js";

/**
 * The error messages below are the real ones Node/better-sqlite3 produce, not
 * paraphrases — the whole point of this module is matching what actually arrives, so a
 * test against invented text would prove nothing.
 */
describe("diagnoseNativeFailure", () => {
  it("recognises an ABI mismatch from upgrading Node without rebuilding", () => {
    const error = new Error(
      "The module '/app/node_modules/better-sqlite3/build/Release/better_sqlite3.node'\n" +
        "was compiled against a different Node.js version using\n" +
        "NODE_MODULE_VERSION 115. This version of Node.js requires\n" +
        "NODE_MODULE_VERSION 137. Please try re-compiling or re-installing\n" +
        "the module (for instance, using `npm rebuild` or `npm install`).",
    );
    const failure = diagnoseNativeFailure(error);
    expect(failure?.kind).toBe("abi-mismatch");
    expect(failure?.fix).toBe("pnpm rebuild -r better-sqlite3");
  });

  it("recognises a skipped build — the onlyBuiltDependencies trap", () => {
    const error = new Error(
      "Could not locate the bindings file. Tried:\n" +
        " → /app/node_modules/better-sqlite3/build/better_sqlite3.node\n" +
        " → /app/node_modules/better-sqlite3/build/Release/better_sqlite3.node",
    );
    const failure = diagnoseNativeFailure(error);
    expect(failure?.kind).toBe("not-built");
    expect(failure?.fix).toBe("pnpm rebuild -r better-sqlite3");
    // This is the failure whose *cause* is least guessable, so it must be explained.
    expect(failure?.cause).toMatch(/onlyBuiltDependencies/);
  });

  it("recognises a node_modules copied between machines", () => {
    const error = new Error(
      "/app/node_modules/better-sqlite3/build/Release/better_sqlite3.node: invalid ELF header",
    );
    const failure = diagnoseNativeFailure(error);
    expect(failure?.kind).toBe("wrong-platform");
    // Rebuilding cannot fix a foreign binary tree; only a clean install can.
    expect(failure?.fix).toMatch(/rm -rf node_modules/);
  });

  it("recognises a generic dlopen failure by error code", () => {
    const error = Object.assign(new Error("dlopen failed"), {
      code: "ERR_DLOPEN_FAILED",
    });
    expect(diagnoseNativeFailure(error)?.kind).toBe("load-failed");
  });

  it("returns null for anything it cannot explain, so the caller re-throws", () => {
    expect(diagnoseNativeFailure(new Error("SQLITE_CORRUPT: database disk image is malformed"))).toBeNull();
    expect(diagnoseNativeFailure(new Error("EACCES: permission denied, open 'data/marginalia.sqlite'"))).toBeNull();
    expect(diagnoseNativeFailure(new TypeError("x is not a function"))).toBeNull();
    expect(diagnoseNativeFailure(undefined)).toBeNull();
  });

  it("does not mistake an unrelated error that merely mentions a .node path", () => {
    // A migration failing on a table name is not a native problem, even though the
    // stack it carries will be full of .node paths.
    expect(
      diagnoseNativeFailure(new Error('no such table: highlights')),
    ).toBeNull();
  });
});

describe("formatNativeFailure", () => {
  it("puts the fix command on its own line so it can be copied", () => {
    const failure = diagnoseNativeFailure(
      new Error("Could not locate the bindings file. Tried: ..."),
    )!;
    const banner = formatNativeFailure(failure);
    expect(banner).toContain("MARGINALIA COULD NOT START");
    expect(banner).toMatch(/\n {6}pnpm rebuild -r better-sqlite3\n/);
  });
});
