import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));

// This file lives at <workspace>/server/src/paths.ts in dev (tsx) and at
// <workspace>/server/dist/paths.js after build — both are two levels under
// the workspace root (projects/marginalia/), so the same relative walk
// resolves correctly in both cases.
export const WORKSPACE_ROOT = path.resolve(here, "..", "..");

/** The pre-M44 layout: data lives inside the checkout, two levels under this
 * file. Every install before Desktop has its data here, and `resolveDataDir`
 * keeps reading from it until a migration has actually run — see there. */
export const LEGACY_DATA_DIR = path.join(WORKSPACE_ROOT, "data");

/** Written into the OS per-user directory once `dataMigration.ts` has
 * copied the legacy directory into it and verified the copy. `resolveDataDir`
 * only trusts the new location once this file exists, which is what makes
 * DESKTOP.md §3.1's "recoverable by deleting the destination" literally
 * true: delete the directory (marker included) and resolution falls back to
 * `LEGACY_DATA_DIR` again on the next call. */
export const MIGRATION_MARKER_NAME = ".migrated-from-legacy";

/**
 * The OS-conventional per-user data directory for this app, or `null` on a
 * platform with no convention wired up here — Windows is out of scope for
 * M44 (DESKTOP.md §8).
 */
export function resolveOsDataDir(): string | null {
  const appName = "marginalia";
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", appName);
  }
  if (process.platform === "linux") {
    const xdgHome = process.env.XDG_DATA_HOME;
    const base = xdgHome && xdgHome.trim() ? xdgHome : path.join(os.homedir(), ".local", "share");
    return path.join(base, appName);
  }
  return null;
}

/**
 * `MARGINALIA_DATA_DIR` (explicit override, always wins) → the OS per-user
 * directory, once its migration marker says it holds real data → the legacy
 * install-relative directory (today's exact behaviour, unchanged for every
 * existing checkout until its data is deliberately migrated) → the OS
 * per-user directory again, for an install that has no legacy data to
 * migrate in the first place (a fresh packaged build).
 *
 * ⚠️ The marker gate is deliberate (DESKTOP.md §3.1): the migration copies,
 * it never moves, so `LEGACY_DATA_DIR` keeps resolving correctly right up
 * until a migration has actually succeeded. Calling this function never
 * changes where an existing dev checkout or the operator's live install
 * reads from — only running `dataMigration.ts`'s migration to completion
 * does.
 */
export function resolveDataDir(): string {
  const override = process.env.MARGINALIA_DATA_DIR;
  if (override && override.trim()) return path.resolve(override);

  const osDir = resolveOsDataDir();
  if (osDir && fs.existsSync(path.join(osDir, MIGRATION_MARKER_NAME))) {
    return osDir;
  }
  if (fs.existsSync(LEGACY_DATA_DIR)) {
    return LEGACY_DATA_DIR;
  }
  return osDir ?? LEGACY_DATA_DIR;
}

export const DATA_DIR = resolveDataDir();
export const LIBRARY_DIR = path.join(DATA_DIR, "library");
export const DB_PATH = path.join(DATA_DIR, "marginalia.sqlite");
// M17: the book digest's markdown projection — a deterministically
// regenerated read-only view of chapter_digests/book_digests, same pattern
// as the vault compiler (settled decision 6: never parsed back).
export const DIGEST_DIR = path.join(DATA_DIR, "digests");
// M21 (AUDIO.md): first-run TTS model weights. Per-machine like the rest of
// `data/` — never committed, never bundled.
export const MODELS_DIR = path.join(DATA_DIR, "models");
// M21 (AUDIO.md): the rendered-audio cache, content-addressed by
// resource/cast hash/spine index — safe to delete at any time.
export const AUDIO_DIR = path.join(DATA_DIR, "audio");

/**
 * App resources (today, just the built web SPA) versus user data (library,
 * DB, models, vault): different lifetimes, and in a packaged app different
 * directories entirely — collapsing them into one resolver is the mistake
 * this function exists to prevent (DESKTOP.md §3.2). Electron sets
 * `resourcesPath` on `process` once the app is packaged; a plain Node
 * process (dev, or M44's throwaway launcher) has none, so it falls back to
 * the same `WORKSPACE_ROOT` every consumer already resolved against.
 */
export function resolveResourceDir(): string {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return resourcesPath && resourcesPath.trim() ? resourcesPath : WORKSPACE_ROOT;
}

/**
 * Rewrites a path that fell inside `app.asar` to its `app.asar.unpacked`
 * sibling, a no-op everywhere else. `wordnet-db`'s on-disk binary search
 * (`dictionary/wordnet.ts`) and `@napi-rs/canvas`'s native binding both need
 * real file-descriptor access that an asar archive can't give a virtual
 * path, and both need `asarUnpack` in the M47 packaging config paired with
 * this rewrite — unpacking without it resolves to a path that no longer has
 * the file (DESKTOP.md §3.3). Written now, ahead of Electron, so M47 has a
 * seam to point at rather than a call site to retrofit.
 */
export function resolveUnpackedPath(candidate: string): string {
  const marker = `${path.sep}app.asar${path.sep}`;
  const index = candidate.indexOf(marker);
  if (index === -1) return candidate;
  return `${candidate.slice(0, index)}${path.sep}app.asar.unpacked${path.sep}${candidate.slice(index + marker.length)}`;
}

/** Creates the runtime data directories if they don't already exist. */
export function ensureDataDirs(): void {
  fs.mkdirSync(LIBRARY_DIR, { recursive: true });
  fs.mkdirSync(DIGEST_DIR, { recursive: true });
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}
