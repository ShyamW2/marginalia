#!/usr/bin/env node
/**
 * `pnpm sync` — bring this machine up to date, correctly, without thinking (M22.6 F).
 *
 * Most of the time `git pull` alone is enough: tsx watch restarts the server, Vite
 * hot-reloads the client, and getDb() applies pending migrations at boot. Two changes
 * need more — a changed lockfile needs an install, and a changed Node major needs the
 * native modules rebuilt — and both announce themselves only by crashing at startup.
 *
 * The value here is not the typing saved. It is not having to work out *which* of those
 * four cases you are in, which is the part that actually costs twenty minutes.
 *
 * Everything is conditional and reported: run it twice and the second run tells you it
 * did nothing.
 *
 * Usage:
 *   pnpm sync              pull, then install/rebuild only if needed
 *   pnpm sync --no-pull    skip the pull (already pulled, or working offline)
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORKSPACE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCKFILE = path.join(WORKSPACE, "pnpm-lock.yaml");
const MODULES_DIR = path.join(WORKSPACE, "node_modules");
// The stamp lives inside node_modules on purpose: deleting node_modules must invalidate
// it, and it must never end up in data/ (which is the user's library, not build state).
const STAMP = path.join(MODULES_DIR, ".marginalia-sync.json");

const noPull = process.argv.includes("--no-pull");
const actions = [];

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
};

function step(message) {
  process.stdout.write(`${c.dim("→")} ${message}\n`);
}

function fail(message, detail) {
  process.stdout.write(`\n${c.red("✗")} ${c.bold(message)}\n`);
  if (detail) process.stdout.write(`\n${detail.trim()}\n`);
  process.exit(1);
}

/** Runs a command, streaming its output; returns false rather than throwing. */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: WORKSPACE,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  return result.status === 0;
}

function capture(command, args) {
  try {
    return execFileSync(command, args, { cwd: WORKSPACE, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function hashFile(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readStamp() {
  try {
    return JSON.parse(fs.readFileSync(STAMP, "utf8"));
  } catch {
    return null;
  }
}

function writeStamp(stamp) {
  // node_modules always exists by this point; if it somehow doesn't, a missing stamp
  // just means the next run reinstalls, which is the safe direction.
  try {
    fs.writeFileSync(STAMP, `${JSON.stringify(stamp, null, 2)}\n`);
  } catch {
    /* non-fatal: worst case the next run does redundant work */
  }
}

// ---------------------------------------------------------------------------
// 1. Pull
// ---------------------------------------------------------------------------

if (noPull) {
  step(c.dim("skipping git pull (--no-pull)"));
} else if (capture("git", ["rev-parse", "--is-inside-work-tree"]) !== "true") {
  step(c.dim("not a git repository — skipping pull"));
} else if (!capture("git", ["remote"])) {
  step(c.dim("no git remote configured — skipping pull"));
} else {
  const before = capture("git", ["rev-parse", "HEAD"]);

  // --ff-only rather than a merge: if the histories have diverged this should stop and
  // let a human look, not invent a merge commit halfway through an update.
  step("git pull --ff-only");
  if (!run("git", ["pull", "--ff-only"])) {
    const dirty = capture("git", ["status", "--porcelain"]);
    fail(
      "git pull failed — nothing else was changed.",
      dirty
        ? `You have uncommitted changes:\n\n${dirty}\n\nCommit or stash them, then run pnpm sync again.`
        : "The branch has probably diverged from its remote. Resolve that by hand, then run pnpm sync again.",
    );
  }

  const after = capture("git", ["rev-parse", "HEAD"]);
  if (before && after && before !== after) {
    const count = capture("git", ["rev-list", "--count", `${before}..${after}`]);
    actions.push(`pulled ${count ?? "new"} commit(s)`);
  }
}

// ---------------------------------------------------------------------------
// 2. Install, only if the lockfile actually moved
// ---------------------------------------------------------------------------

const lockHash = fs.existsSync(LOCKFILE) ? hashFile(LOCKFILE) : null;
const stamp = readStamp();
const modulesMissing = !fs.existsSync(MODULES_DIR);

if (modulesMissing) {
  step("node_modules is missing — installing");
  if (!run("pnpm", ["install"])) fail("pnpm install failed.");
  actions.push("installed dependencies");
} else if (!stamp || stamp.lockHash !== lockHash) {
  step(stamp ? "lockfile changed — installing" : "no sync stamp — installing");
  if (!run("pnpm", ["install"])) fail("pnpm install failed.");
  actions.push("installed dependencies");
} else {
  step(c.dim("dependencies already match the lockfile"));
}

// ---------------------------------------------------------------------------
// 3. Rebuild natives, only if the Node ABI moved
// ---------------------------------------------------------------------------

/**
 * The real test is not "is the file present" but "does opening a database work" —
 * better-sqlite3 binds lazily, so importing it succeeds even when the binding is
 * missing or built for the wrong ABI. Only constructing a Database proves it.
 */
function nativesWork() {
  const probe =
    "import D from 'better-sqlite3'; const db = new D(':memory:'); db.prepare('select 1').get();";
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
    cwd: path.join(WORKSPACE, "server"),
    encoding: "utf8",
  });
  return { ok: result.status === 0, output: `${result.stderr ?? ""}` };
}

const abiChanged = stamp && stamp.modulesAbi !== process.versions.modules;
if (abiChanged) {
  step(
    `Node changed since the last sync (ABI ${stamp.modulesAbi} → ${process.versions.modules}) — rebuilding native modules`,
  );
  if (!run("pnpm", ["rebuild", "-r", "better-sqlite3"])) fail("pnpm rebuild failed.");
  actions.push("rebuilt native modules");
}

const probe = nativesWork();
if (!probe.ok) {
  // Either the ABI check did not catch it (first ever sync, stamp lost) or the build was
  // skipped entirely. One rebuild attempt, then report honestly rather than looping.
  step(c.yellow("better-sqlite3 cannot open a database — rebuilding"));
  if (!run("pnpm", ["rebuild", "-r", "better-sqlite3"])) fail("pnpm rebuild failed.");
  const retry = nativesWork();
  if (!retry.ok) {
    fail(
      "better-sqlite3 still cannot open a database after a rebuild.",
      `${retry.output}\nTry: rm -rf node_modules && pnpm install`,
    );
  }
  actions.push("rebuilt native modules");
}

writeStamp({
  lockHash,
  modulesAbi: process.versions.modules,
  nodeVersion: process.versions.node,
  syncedAt: new Date().toISOString(),
});

// ---------------------------------------------------------------------------
// 4. Say what happened
// ---------------------------------------------------------------------------

process.stdout.write("\n");
if (actions.length === 0) {
  process.stdout.write(`${c.green("✓")} Already up to date — nothing to do.\n`);
} else {
  process.stdout.write(`${c.green("✓")} ${c.bold("Synced:")} ${actions.join(", ")}.\n`);
}
process.stdout.write(`${c.dim(`  Node ${process.versions.node} · run \`pnpm dev\` to start.`)}\n\n`);
