#!/usr/bin/env node
// M47 (DESKTOP.md §5 "M47 — Packaging and the native matrix"). Produces a
// self-contained `build/stage/` tree that electron-builder ships verbatim as
// `extraResources` (see `electron-builder.yml`), landing at `resourcesPath/`
// in the packaged app exactly as `main.ts`'s `resolveServerEntry()` and
// `paths.ts`'s `resolveResourceDir()` already expect.
//
// SPEC-GAP (DESKTOP.md §3.3 / TASKS.md M47): the doc names `asarUnpack` + an
// `app.asar.unpacked` rewrite as the fix for `@napi-rs/canvas`'s `.node` and
// `wordnet-db`'s dataset. That assumes those two live inside `app.asar`. They
// don't: `main.ts` (M45) already resolves the server's entry via
// `resourcesPath/server/...` — an `extraResources` path, sibling to
// `app.asar`, not inside it. Given that, the whole server (and everything it
// requires) ships as plain files on disk, never asar-packed, so the asar trap
// DESKTOP.md describes cannot occur by construction, and `resolveUnpackedPath`
// (`paths.ts`) stays the harmless no-op it already is today. Noted in
// NOTES.md's M47 entry — this is a simpler mechanism satisfying the same
// underlying requirement (native modules and data files load correctly from
// a packaged app), not a reversal of it.
//
// Why not `pnpm deploy`: it's the first tool this milestone reached for (it's
// built for exactly this), but pnpm 10.14's `--legacy` deploy hits a real bin
// dylinking bug in this environment (`mkdir '/home/tmp'`, traced to a bad
// relative-path computation in `_linkBins`), and the modern injected-deploy
// mode refuses to run without rewriting the shared lockfile's
// `injectWorkspacePackages` setting — a workspace-wide config change this
// milestone has no reason to make. `@vercel/nft` (Vercel's own tool for this
// exact problem — Next.js `output: standalone` is built on it) traces the
// real `require`/`import` graph from the server's compiled entry point and
// hands back the exact file set actually reachable, correctly resolving
// pnpm's nested per-package dependency scopes (the mechanism that made a
// naive `cp -rL server/node_modules` silently miss `onnxruntime-node` —
// verified live, see NOTES.md).
//
// Two known gaps in nft's *static* trace, both handled explicitly below
// rather than left to chance:
//   1. `wordnet-db`'s dataset is opened via `fs.open` on a path string
//      (`wordnet.ts`), never `require`d as code, so nft cannot see it. Every
//      *direct* dependency of `@marginalia/server` is force-copied wholesale
//      as a second pass, which covers this (and is cheap insurance against
//      any other data-only direct dependency down the line).
//   2. Native platform binaries reached through a runtime
//      `process.platform`/`process.arch` branch (`onnxruntime-node`, and
//      `sharp`'s per-platform packages pulled in by `@huggingface/transformers`)
//      get traced *broadly* — nft can't evaluate the branch, so it keeps
//      every platform it can find rather than guessing wrong. Pruned
//      explicitly below, which is also where the M47 task's own
//      "prune foreign platforms" and "exclude sharp" bullets are done.

import { nodeFileTrace } from "@vercel/nft";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(here, "..", "..");
const STAGE_ROOT = path.join(PROJECT_ROOT, "build", "stage");

const [, , platformArg, archArg] = process.argv;
const TARGET_PLATFORM = platformArg;
const TARGET_ARCH = archArg;
if (!["darwin", "linux"].includes(TARGET_PLATFORM) || !["arm64", "x64"].includes(TARGET_ARCH)) {
  console.error(`Usage: stage.mjs <darwin|linux> <arm64|x64>`);
  process.exit(1);
}

function fail(message) {
  console.error(`[stage] ${message}`);
  process.exit(1);
}

function dirSizeMB(dir) {
  let total = 0;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full);
      else total += fs.statSync(full).size;
    }
  };
  walk(dir);
  return (total / 1024 / 1024).toFixed(1);
}

/** Copies a file, directory, or symlink from `src` to `dest`, preserving
 * symlinks *as symlinks with their original relative target string* rather
 * than dereferencing them or (`fs.cpSync`'s actual behaviour, found live)
 * silently rewriting them to an absolute path.
 *
 * pnpm's whole node_modules layout is relative symlinks into its
 * content-addressable store, and mirroring the exact same relative
 * directory structure under `STAGE_ROOT` means those relative targets keep
 * resolving correctly, with nothing copied twice. Two things were tried and
 * rejected first, both live-verified: `{dereference: true}` duplicated every
 * package that more than one scope privately depends on (`kokoro-js` and
 * `@marginalia/server` both depend on `@huggingface/transformers`, for
 * example), inflating the staged tree from ~350MB to 1.4GB before pruning
 * even ran; and plain `fs.cpSync` *without* `dereference`, which looks like
 * the right call, turned out to resolve each relative symlink to an absolute
 * path anchored at this machine's checkout when recreating it — invisible
 * locally (the target still exists), fatal the moment the staged tree is
 * unpacked on a different machine, and only caught by actually reading the
 * copied symlinks back afterward.
 */
function existsAtAll(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Idempotent by design — the whole-package backfill pass (`copyWholePackage`)
 * runs over a tree nft has already partially populated, so re-visiting an
 * entry nft already placed must be a safe no-op rather than an `EEXIST`
 * crash, and a directory nft only partially populated must still pick up
 * whatever files this second pass finds that the first one didn't. */
function copyPreservingSymlinks(src, dest) {
  const stat = fs.lstatSync(src);
  if (stat.isSymbolicLink()) {
    if (existsAtAll(dest)) return;
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

/** Copies one traced file into the stage tree at its identical relative path. */
function copyOne(relPath) {
  const src = path.join(PROJECT_ROOT, relPath);
  const dest = path.join(STAGE_ROOT, relPath);
  if (!fs.existsSync(src)) return; // nft can list files that turned out not to exist (peer-dep probes etc.)
  copyPreservingSymlinks(src, dest);
}

/** Force-copies a whole package directory (not just the files nft's static
 * trace found), used for server's own direct dependencies so a data-only
 * package like `wordnet-db` — never `require`d as code, so invisible to a
 * static tracer — still ships complete.
 *
 * `server/node_modules/<name>` is itself a symlink into the pnpm store, so
 * copying *it* alone (as `copyPreservingSymlinks` does for everything nft
 * already found) only recreates the pointer — the real content it points to
 * was never in nft's fileList and so was never staged, which resolves fine
 * on this machine (the original store is still sitting right there) and
 * fails on every other one. Both the pointer *and* the real target it
 * resolves to need to land in the stage tree, at their own original
 * positions relative to `PROJECT_ROOT`, exactly as nft's own entries do.
 */
function copyWholePackage(name) {
  const link = path.join(PROJECT_ROOT, "server", "node_modules", name);
  if (!fs.existsSync(link)) fail(`server/node_modules/${name} not found — run "pnpm install" first.`);

  // Merge, not skip-if-present: nft may have already placed some of this
  // package's files (following a static require it could see) while missing
  // others (data directories, alternate module-format entry points) — both
  // copyPreservingSymlinks branches below are idempotent over that partial
  // state (see its own doc comment).
  const real = fs.realpathSync(link);
  copyPreservingSymlinks(real, path.join(STAGE_ROOT, path.relative(PROJECT_ROOT, real)));

  if (fs.lstatSync(link).isSymbolicLink()) {
    const stagedLink = path.join(STAGE_ROOT, path.relative(PROJECT_ROOT, link));
    if (!existsAtAll(stagedLink)) {
      fs.mkdirSync(path.dirname(stagedLink), { recursive: true });
      fs.symlinkSync(fs.readlinkSync(link), stagedLink);
    }
  }
}

function rmIfExists(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

/** DESKTOP.md §2.1 / TASKS.md M47: `onnxruntime-node` ships every platform
 * in one package. Keep only the target platform+arch, expressed as which
 * platforms to KEEP rather than an imperative delete list, so adding
 * Windows later (§8) is a one-line addition here. Within the kept dir,
 * also drop the CUDA/TensorRT provider libraries — Kokoro always runs
 * `device: "cpu"` (`audio/kokoro.ts`), and on linux/x64 those two files
 * alone account for ~327MB of the ~370MB directory (measured live).
 */
function pruneOnnxPlatforms(stageRoot) {
  const KEEP = { darwin: ["arm64", "x64"], linux: ["x64"] }; // both mac arches ship from the same nft trace; linux only ships x64 (§1 table).
  const bases = findAll(stageRoot, (p) => p.endsWith(path.join("onnxruntime-node", "bin", "napi-v3")));
  for (const base of bases) {
    for (const platform of fs.readdirSync(base)) {
      const platformDir = path.join(base, platform);
      if (!fs.statSync(platformDir).isDirectory()) continue;
      if (platform !== TARGET_PLATFORM) {
        rmIfExists(platformDir);
        continue;
      }
      for (const arch of fs.readdirSync(platformDir)) {
        const archDir = path.join(platformDir, arch);
        if (!(KEEP[platform] ?? []).includes(arch)) {
          rmIfExists(archDir);
          continue;
        }
        for (const file of fs.readdirSync(archDir)) {
          if (/cuda|tensorrt/i.test(file)) rmIfExists(path.join(archDir, file));
        }
      }
    }
  }
}

/** DESKTOP.md §2.1: `@napi-rs/canvas` ships every OS/arch as a separate
 * optional package (`@napi-rs/canvas-linux-x64-gnu`, `-darwin-arm64`, …,
 * eleven of them). The loader picks one at runtime by `process.platform`/
 * `process.arch`, which nft can't evaluate, so — same as onnxruntime-node —
 * it traces all eleven. Keep only the target's. Linux keeps the `gnu`
 * (glibc) variant: `AppImage` targets a standard Ubuntu-based build, not
 * musl.
 */
function pruneCanvasPlatforms(stageRoot) {
  const KEEP_SUFFIX = { "darwin-arm64": "darwin-arm64", "darwin-x64": "darwin-x64", "linux-x64": "linux-x64-gnu" };
  const keep = KEEP_SUFFIX[`${TARGET_PLATFORM}-${TARGET_ARCH}`];
  const dirs = findAll(stageRoot, (p) => /node_modules[/\\]\.pnpm[/\\]@napi-rs\+canvas-/.test(p));
  for (const d of dirs) {
    if (!d.endsWith(`@napi-rs+canvas-${keep}@1.0.8`) && !path.basename(d).startsWith(`@napi-rs+canvas-${keep}@`)) {
      rmIfExists(d);
    }
  }
}

/** A packaged app must never contain the operator's own library, highlights,
 * or live database (DESKTOP.md §3.1: "every existing install is the
 * operator's own"). nft's `path.join(__dirname, …)` heuristic doesn't know
 * `paths.ts`'s `LEGACY_DATA_DIR` names a *user data* directory rather than a
 * bundled asset, and pulled the real `data/` tree (150MB of the operator's
 * actual reading library and SQLite database, WAL included) straight into
 * the staged output the first time this script ran — caught before ever
 * reaching a packaged build. Excluded from the trace itself (`ignore`,
 * below) and re-checked here so a future change that defeats the ignore
 * pattern fails the build loudly instead of shipping it.
 */
function assertNoUserData(stageRoot) {
  const hit = findAll(stageRoot, (p) => path.basename(p) === "data" && fs.existsSync(path.join(p, "marginalia.sqlite")));
  if (hit.length > 0) fail(`refusing to package: found the operator's own data directory at ${hit.join(", ")}`);
}

/** CORRECTS an earlier finding (NOTES.md's M47 entry has the full story):
 * TASKS.md M47 named `sharp` as excludable, on the strength of a test that
 * turned out to be invalid. `sharp` cannot be excluded — it is a hard,
 * *unconditional* dependency of `@huggingface/transformers`, in both its
 * CJS and ESM Node entry points. `transformers`'s image-utilities module
 * does `require`/`import` "sharp" at that module's own top level, and that
 * module is itself pulled in unconditionally by transformers' main barrel
 * export, so merely `require`-ing or `import`-ing `@huggingface/transformers`
 * at all — which `kokoro-js` does, for audio, regardless of whether any
 * image code ever runs — fails outright without it. (The first attempt to
 * verify this hid one copy of `sharp` and saw it keep working; that result
 * was a false negative caused by pnpm's ambient `node_modules/.pnpm/node_modules/`
 * fallback directory still resolving it. Re-tested against this script's own
 * pruned, symlink-preserving stage output — which has no such ambient
 * fallback — both entry points threw `Cannot find module 'sharp'`.)
 *
 * So `sharp` ships, pruned to the target platform exactly like
 * `onnxruntime-node` and `@napi-rs/canvas` above (its own package plus
 * `@img/sharp-<platform>-<arch>` and `@img/sharp-libvips-<platform>-<arch>`,
 * both of which its own top-level `require` loads eagerly by platform,
 * same failure mode as the other two). **This reopens the LGPL-3.0 question
 * TASKS.md's own bullet named as the contingency** ("if it does [get
 * required], the obligation is real and gets its own decisions.md entry") —
 * recorded as a blocker in NOTES.md rather than decided here, since it's a
 * licensing call, not an implementation one.
 */
function pruneSharpPlatforms(stageRoot) {
  const KEEP = { "darwin-arm64": "darwin-arm64", "darwin-x64": "darwin-x64", "linux-x64": "linux-x64" };
  const keep = KEEP[`${TARGET_PLATFORM}-${TARGET_ARCH}`];
  const dirs = findAll(stageRoot, (p) => /node_modules[/\\]\.pnpm[/\\]@img\+sharp-/.test(p));
  for (const d of dirs) {
    const base = path.basename(d); // e.g. "@img+sharp-linux-x64@0.34.5" or "@img+sharp-libvips-linux-x64@1.2.4"
    if (!base.startsWith(`@img+sharp-${keep}@`) && !base.startsWith(`@img+sharp-libvips-${keep}@`)) {
      rmIfExists(d);
    }
  }
}

/** Returns top-level directories under `root` whose path satisfies `match`,
 * without descending further once found (used for the onnx bin dirs and the
 * sharp store entries above). */
function findAll(root, match, results = []) {
  if (!fs.existsSync(root)) return results;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(root, entry.name);
    if (match(full)) {
      results.push(full);
      continue;
    }
    findAll(full, match, results);
  }
  return results;
}

async function main() {
  const serverEntry = path.join(PROJECT_ROOT, "server", "dist", "index.js");
  const webIndex = path.join(PROJECT_ROOT, "web", "dist", "index.html");
  if (!fs.existsSync(serverEntry)) fail(`${serverEntry} not found — run "pnpm build" first.`);
  if (!fs.existsSync(webIndex)) fail(`${webIndex} not found — run "pnpm build" first.`);

  rmIfExists(STAGE_ROOT);
  fs.mkdirSync(STAGE_ROOT, { recursive: true });

  console.log(`[stage] tracing server/dist/index.js for ${TARGET_PLATFORM}/${TARGET_ARCH}...`);
  // nft resolves its entry-file list relative to process.cwd(), not `base`
  // (found live: running this script via `pnpm run package:linux:x64` from
  // `electron/` fed it a CWD-relative path and it looked for the entry
  // under `electron/server/...`) — pass an absolute path instead so this
  // script behaves the same regardless of the caller's working directory.
  const { fileList, warnings } = await nodeFileTrace([serverEntry], {
    base: PROJECT_ROOT,
    // The operator's own data/ (library, DB, models, audio cache) must never
    // be treated as a bundled asset — see assertNoUserData()'s doc comment.
    ignore: ["data/**"],
  });
  console.log(`[stage] nft traced ${fileList.size} files (${warnings.size} warnings — expected for optional/platform probes)`);
  for (const rel of fileList) copyOne(rel);

  const serverPkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "server", "package.json"), "utf8"));
  for (const dep of Object.keys(serverPkg.dependencies ?? {})) copyWholePackage(dep);
  fs.cpSync(path.join(PROJECT_ROOT, "server", "package.json"), path.join(STAGE_ROOT, "server", "package.json"));

  fs.cpSync(path.join(PROJECT_ROOT, "web", "dist"), path.join(STAGE_ROOT, "web", "dist"), {
    recursive: true,
    dereference: true,
  });

  assertNoUserData(STAGE_ROOT);

  const beforeMB = dirSizeMB(STAGE_ROOT);
  pruneOnnxPlatforms(STAGE_ROOT);
  pruneCanvasPlatforms(STAGE_ROOT);
  pruneSharpPlatforms(STAGE_ROOT);
  const afterMB = dirSizeMB(STAGE_ROOT);

  assertNoUserData(STAGE_ROOT); // re-checked post-prune in case a future edit reorders these calls

  console.log(`[stage] done: ${beforeMB}MB -> ${afterMB}MB after pruning, at ${STAGE_ROOT}`);
}

main().catch((error) => fail(error.stack ?? String(error)));
