#!/usr/bin/env node
// M47 (DESKTOP.md §2.1 / §5): `better-sqlite3` is compiled from source and its
// ABI is *not* stable across Node versions the way the N-API modules
// (`onnxruntime-node`, `@napi-rs/canvas`) are — it must be rebuilt against the
// exact Electron/V8 ABI it will actually run under, or it fails lazily
// (`import` resolves fine; `new Database()` throws) per DESKTOP.md §2.1's own
// warning. Run this after `stage.mjs` and before `electron-builder`.
import { nodeFileTrace } from "@vercel/nft";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(here, "..", "..");
const ELECTRON_DIR = path.join(PROJECT_ROOT, "electron");
const STAGE_SERVER_DIR = path.join(PROJECT_ROOT, "build", "stage", "server");
const STAGE_SERVER_MODULES = path.join(STAGE_SERVER_DIR, "node_modules");

function fail(message) {
  console.error(`[rebuild-native] ${message}`);
  process.exit(1);
}

function pathExistsLstat(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Idempotent recursive copy that preserves symlinks-as-symlinks-with-their-
 * original-target-string (see `stage.mjs`'s matching helper for why: pnpm's
 * symlinks are relative, and Node's own `fs.cpSync` silently rewrites them
 * to absolute paths when recreating them — fine on the machine that built
 * them, broken the moment the tree moves).
 */
function copyPreservingSymlinks(src, dest) {
  const stat = fs.lstatSync(src);
  if (stat.isSymbolicLink()) {
    if (pathExistsLstat(dest)) return;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.symlinkSync(fs.readlinkSync(src), dest);
    return;
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) copyPreservingSymlinks(path.join(src, entry), path.join(dest, entry));
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

/**
 * `better-sqlite3` lands in the stage tree as a symlink into the shared pnpm
 * store (same as every other dependency — see `stage.mjs`'s own doc comment
 * on why symlinks are preserved rather than dereferenced everywhere else).
 * Rebuilding through that symlink would recompile the *shared store copy*
 * in place — the same one the ordinary dev server (`pnpm dev`) uses — and
 * leave every other Node process on this machine holding an
 * Electron-ABI-compiled binary the next time it runs.
 *
 * Copying just `better-sqlite3`'s own directory isn't enough (verified live,
 * twice): pnpm resolves a package's dependencies into a *private* sibling
 * scope one level up (`.pnpm/<pkg>@X/node_modules/` — `stage.mjs` documents
 * the same pattern for `onnxruntime-node`), and `bindings` (better-sqlite3's
 * own dependency) has that same private scope *again* for its own
 * `file-uri-to-path` dependency — the nesting is only as deep as the real
 * graph happens to be. So this traces the real transitive closure with the
 * same tool `stage.mjs` uses for the whole server, then hoists every traced
 * file flat into `server/node_modules/<package>/…`, replacing the symlink.
 */
async function isolate(name) {
  const link = path.join(STAGE_SERVER_MODULES, name);
  if (!fs.existsSync(link)) fail(`${link} not found — run stage.mjs first.`);
  if (!fs.lstatSync(link).isSymbolicLink()) return; // already an isolated real copy

  // Captured before the trace loop below replaces the symlink with a real
  // (but nft-traced, JS-only) directory at this same path.
  const realPackageDir = fs.realpathSync(link);

  // Traced *before* touching anything — the symlink this whole function is
  // about to remove is exactly what nft needs in place to resolve `name` at
  // all (removing it first was tried and made the trace itself fail to find
  // the package).
  const entryFile = path.join(STAGE_SERVER_DIR, ".rebuild-trace-entry.cjs");
  fs.writeFileSync(entryFile, `require(${JSON.stringify(name)});\n`);
  // Absolute path — see stage.mjs's matching comment: nft resolves its entry
  // list against process.cwd(), not `base`.
  const { fileList } = await nodeFileTrace([entryFile], { base: PROJECT_ROOT });
  fs.rmSync(entryFile);

  const marker = `node_modules${path.sep}`;
  for (const rel of fileList) {
    const lastIndex = rel.lastIndexOf(marker);
    if (lastIndex === -1) continue; // the synthetic entry file itself
    const flatRel = rel.slice(lastIndex + marker.length); // last node_modules/ segment collapses "…/.pnpm/bindings@X/node_modules/file-uri-to-path/index.js" to "file-uri-to-path/index.js"
    const src = path.join(PROJECT_ROOT, rel);
    if (!pathExistsLstat(src)) continue; // nft can list files that turned out not to exist (peer-dep probes etc.)
    // Resolve *before* touching dest: for the top-level package symlink
    // itself (e.g. "…/server/node_modules/better-sqlite3"), src and dest
    // are the literal same path once flattened, so deleting dest first
    // would delete src out from under the copy that follows.
    const resolvedSrc = fs.lstatSync(src).isSymbolicLink() ? fs.realpathSync(src) : src;
    const dest = path.join(STAGE_SERVER_MODULES, flatRel);
    // `existsSync` follows symlinks — `dest` can read as "already there" via
    // the very symlink this loop means to replace, so check the link itself
    // (lstat) rather than what it resolves to.
    let destStat = null;
    try {
      destStat = fs.lstatSync(dest);
    } catch {
      /* doesn't exist yet */
    }
    if (destStat && !destStat.isSymbolicLink()) continue; // a real copy already landed here from an earlier iteration
    if (destStat) fs.rmSync(dest, { recursive: true, force: true });
    copyPreservingSymlinks(resolvedSrc, dest);
  }

  // nft traces the JS `require`/`import` graph — it has no way to know
  // `binding.gyp` needs its sibling `deps/` directory (bundled SQLite
  // amalgamation source, `common.gypi`), since nothing in JS ever
  // `require`s them; gyp reads them directly off disk once building starts.
  // Found live: the trace-only copy built fine as *code* but failed to
  // rebuild with "deps/common.gypi not found". A full merge-copy of the
  // package directory (idempotent — copyPreservingSymlinks skips anything
  // the trace loop above already placed) closes that gap the same way
  // `stage.mjs`'s `copyWholePackage` does for `wordnet-db`'s data.
  copyPreservingSymlinks(realPackageDir, path.join(STAGE_SERVER_MODULES, name));
}

function findSharedStoreBinary() {
  const pnpmDir = path.join(PROJECT_ROOT, "node_modules", ".pnpm");
  if (!fs.existsSync(pnpmDir)) return null;
  const entry = fs.readdirSync(pnpmDir).find((name) => name.startsWith("better-sqlite3@"));
  if (!entry) return null;
  const binary = path.join(pnpmDir, entry, "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node");
  return fs.existsSync(binary) ? binary : null;
}

function hashFile(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

/**
 * ⚠️ Incident, live, this session, three separate times before landing on
 * this: `electron-rebuild`'s **CLI** rebuilt the *shared pnpm store's*
 * `better-sqlite3` in place instead of (or as well as) the isolated copy —
 * discovered only because it broke `pnpm test` and the ordinary dev server
 * (`ERR_DLOPEN_FAILED`, `NODE_MODULE_VERSION` mismatch), fixed each time with
 * `pnpm rebuild --recursive better-sqlite3`.
 *
 * The CLI (`@electron/rebuild/lib/cli.js`) computes its own "project root"
 * via `getProjectRootPath(process.cwd())`, entirely independent of
 * `--module-dir` — it walks *up from `process.cwd()`* hunting for
 * `yarn.lock`, then `package-lock.json`, then `pnpm-lock.yaml`, unbounded,
 * all the way to `/`, and a stray `package-lock.json` sitting directly in
 * this machine's `$HOME` (unrelated to this project, found live while
 * tracing the bug with `strace`) matched before a decoy `pnpm-lock.yaml`
 * dropped into the stage tree ever got a chance to. That resolved
 * `projectRootPath` then feeds `ModuleWalker`'s own module discovery, which
 * — even set up correctly and traced with `strace -e trace=openat` to watch
 * it — still ended up invoking node-gyp with `cwd` set to the real store's
 * `better-sqlite3` directory rather than the isolated one, in a way this
 * investigation could reproduce and fix around but not fully explain from
 * reading the CLI's source alone.
 *
 * The actual fix: **use the programmatic API, not the CLI, with an explicit
 * `projectRootPath`.** `rebuild()`'s own options accept `projectRootPath`
 * directly (`rebuild.js`'s `new ModuleWalker(this.buildPath,
 * options.projectRootPath, …)`) — passing it here skips
 * `getProjectRootPath`'s cwd-walking auto-detection entirely, which is the
 * actual source of every failure mode above, CLI-only behavior that has no
 * bearing on the library underneath it. A hash check on the shared store's
 * own binary, before and after, stays in as an independent guard regardless
 * — this failure mode was invisible for three fix attempts in a row until it
 * broke something else, so this function no longer trusts its own reasoning
 * about *why* a given approach is safe without also verifying it didn't
 * touch what it shouldn't have.
 */
async function runElectronRebuild() {
  const electronPkg = JSON.parse(
    fs.readFileSync(path.join(ELECTRON_DIR, "node_modules", "electron", "package.json"), "utf8"),
  );
  const rebuildLibPath = path.join(ELECTRON_DIR, "node_modules", "@electron", "rebuild", "lib", "main.js");
  if (!fs.existsSync(rebuildLibPath)) fail(`${rebuildLibPath} not found — run "pnpm install" first.`);
  const { rebuild } = await import(pathToFileURL(rebuildLibPath).href);

  const sharedStoreBinary = findSharedStoreBinary();
  const before = sharedStoreBinary ? hashFile(sharedStoreBinary) : null;

  console.log(`[rebuild-native] rebuilding better-sqlite3 for Electron ${electronPkg.version}...`);
  await rebuild({
    buildPath: STAGE_SERVER_DIR,
    projectRootPath: STAGE_SERVER_DIR,
    electronVersion: electronPkg.version,
    onlyModules: ["better-sqlite3"],
    force: true,
  });

  if (sharedStoreBinary && hashFile(sharedStoreBinary) !== before) {
    fail(
      `the shared pnpm store's better-sqlite3 binary changed during this rebuild (${sharedStoreBinary}). ` +
        `This is the exact incident this function's doc comment describes — run ` +
        `"pnpm rebuild --recursive better-sqlite3" to fix the dev environment, then fix this script before rerunning.`,
    );
  }
}

await isolate("better-sqlite3");
await runElectronRebuild();
console.log("[rebuild-native] done.");
