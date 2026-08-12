/**
 * Translating native-module startup failures into an instruction (M22.6 F).
 *
 * `getDb()` runs at import time, so anything wrong with better-sqlite3's compiled
 * binding kills the server before it listens. That is the right behaviour — a server
 * with no database should not limp on — but the *default* presentation of it is a bare
 * stack trace interleaved into `concurrently`'s output while Vite, a separate process,
 * keeps happily serving the UI. The app looks like it is running and every API call
 * fails.
 *
 * These failures are boring and finite: the build was skipped, Node changed major
 * underneath an existing build, or a `node_modules` was copied between machines. Each
 * has exactly one fix. This module maps error → fix so the crash costs ten seconds.
 *
 * Kept as a pure function over the error so it can be tested against real error shapes
 * rather than by deliberately breaking an install.
 */

/** The distinguishable ways better-sqlite3's binding fails to load. */
export type NativeFailureKind =
  | "abi-mismatch"
  | "not-built"
  | "wrong-platform"
  | "load-failed";

export interface NativeFailure {
  kind: NativeFailureKind;
  /** One-line statement of what is wrong. */
  problem: string;
  /** The command that fixes it. */
  fix: string;
  /** Why it happened, when that is not obvious from the problem. */
  cause?: string;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return `${error.message}\n${error.stack ?? ""}`;
  return String(error);
}

function codeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "";
}

/**
 * Classifies a startup error as a known native-module failure, or returns `null` if it
 * is anything else — in which case the caller must re-throw rather than dress it up as
 * a rebuild problem. A wrong diagnosis is worse than none.
 */
export function diagnoseNativeFailure(error: unknown): NativeFailure | null {
  const message = messageOf(error);
  const code = codeOf(error);

  // Node was upgraded (or downgraded) across a major without rebuilding. The binary is
  // present and valid, just compiled against a different ABI. Node names both versions
  // in the message, which is worth surfacing verbatim.
  if (/NODE_MODULE_VERSION/i.test(message)) {
    return {
      kind: "abi-mismatch",
      problem:
        "better-sqlite3 was built for a different version of Node than the one running.",
      cause: `Node is v${process.versions.node} (module ABI ${process.versions.modules}). Upgrading Node does not rebuild native modules.`,
      fix: "pnpm rebuild -r better-sqlite3",
    };
  }

  // node_modules carried across an OS or CPU boundary — the classic "I copied the
  // folder from the Mac" or a Docker mount from the host.
  if (/invalid ELF header|not a valid Win32 application|wrong architecture|mach-o/i.test(message)) {
    return {
      kind: "wrong-platform",
      problem:
        "better-sqlite3's binary was built for a different platform or CPU architecture.",
      cause: `This machine is ${process.platform}/${process.arch}. node_modules is not portable between machines — it is never copied, only installed.`,
      fix: "rm -rf node_modules && pnpm install",
    };
  }

  // pnpm skipped the build script entirely. This is the onlyBuiltDependencies trap:
  // the package is installed and resolvable, so it imports fine and only fails when
  // something actually opens a database.
  if (/Could not locate the bindings file|bindings\.node|MODULE_NOT_FOUND.*better_sqlite3/i.test(message)) {
    return {
      kind: "not-built",
      problem: "better-sqlite3 is installed but was never compiled.",
      cause:
        "pnpm only runs build scripts for packages listed in onlyBuiltDependencies (pnpm-workspace.yaml). If that list moved or was overridden, the build is skipped silently.",
      fix: "pnpm rebuild -r better-sqlite3",
    };
  }

  // Generic dynamic-link failure — the shared library is there but will not load.
  // Less specific, but still unambiguously a native problem rather than a bug.
  if (code === "ERR_DLOPEN_FAILED" || /dlopen|\.node['"]?\)?: cannot open/i.test(message)) {
    return {
      kind: "load-failed",
      problem: "better-sqlite3's native binding failed to load.",
      fix: "pnpm rebuild -r better-sqlite3",
    };
  }

  return null;
}

/**
 * Renders a failure as a banner that survives being interleaved with another process's
 * output — which is the condition it is actually read under, since `pnpm dev` runs the
 * server alongside Vite.
 */
export function formatNativeFailure(failure: NativeFailure): string {
  const rule = "─".repeat(72);
  const lines = [
    "",
    rule,
    "  MARGINALIA COULD NOT START",
    "",
    `  ${failure.problem}`,
  ];
  if (failure.cause) lines.push("", `  ${failure.cause}`);
  lines.push(
    "",
    "  Fix, from projects/marginalia:",
    "",
    `      ${failure.fix}`,
    "",
    "  Then start again with `pnpm dev`. `pnpm sync` does both for you.",
    rule,
    "",
  );
  return lines.join("\n");
}
