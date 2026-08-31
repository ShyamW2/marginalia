import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, readdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { delimiter, join } from "node:path";

/**
 * Resolving a CLI's executable without relying on the inherited `PATH`
 * (decisions.md 2026-08-26).
 *
 * `spawn("codex", …)` searches only `process.env.PATH`, and a server's `PATH`
 * is whatever launched it — which on macOS is routinely *not* the shell's.
 * A GUI/launchd-started process gets the bare `/usr/bin:/bin:/usr/sbin:/sbin`
 * default, so a `codex` installed by Homebrew (`/opt/homebrew/bin`), npm-global,
 * volta, bun, or nvm is invisible and `spawn` fails `ENOENT` — the operator's
 * Mac symptom on 2026-08-26, with `codex` plainly working in their terminal.
 *
 * Three strategies, in order, first hit wins:
 *   1. An explicit override — `MARGINALIA_CODEX_BIN` / `MARGINALIA_CLAUDE_BIN`.
 *      Always available as the escape hatch when the search below is wrong.
 *   2. `PATH` plus a table of the directories these two CLIs are actually
 *      installed into, including nvm's versioned `bin`s.
 *   3. The user's **login shell**, asked directly (`$SHELL -lc "command -v x"`,
 *      then `-ic` for the rc-file-only installs like nvm). This is the one that
 *      matches "but it works in my terminal", so it is worth the ~200ms — and
 *      it is only ever paid once per binary per server run.
 *
 * A found path is cached per process (an install doesn't move once made); a
 * miss is never cached, so a user who installs the CLI while the app is open
 * gets picked up on the next check — no restart needed. `clearCliBinCache()`
 * exists for tests, which reuse binary names across differing fake `PATH`s.
 */

/** Overridable, and deliberately not a config-file setting: this is machine
 * geometry, not a preference, and it must be settable before any UI can load. */
function overrideFor(name: string): string | undefined {
  const value = process.env[`MARGINALIA_${name.toUpperCase()}_BIN`];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

/** Where these CLIs actually land, by installer. Ordered most- to
 * least-specific; `/snap/bin` is last because a snap-packaged `codex` is the
 * most constrained build (see codexCli.ts's `scratchDir` for what its
 * confinement costs us) — prefer a native install when both exist. */
function candidateDirs(): string[] {
  const home = homedir();
  const dirs = [
    "/opt/homebrew/bin", // Homebrew, Apple silicon
    "/usr/local/bin", // Homebrew (Intel), and plain `npm -g` on a system node
    join(home, ".local", "bin"),
    join(home, ".npm-global", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".volta", "bin"),
    join(home, ".deno", "bin"),
    join(home, ".yarn", "bin"),
    join(home, ".cargo", "bin"),
    "/snap/bin",
  ];
  // nvm keeps one `bin` per installed node version and puts none of them on a
  // non-interactive PATH; check them all, newest-looking last-wins is not worth
  // the version parsing, so take them in readdir order.
  const nvmRoot = process.env.NVM_DIR ?? join(home, ".nvm");
  const versions = join(nvmRoot, "versions", "node");
  if (existsSync(versions)) {
    try {
      for (const entry of readdirSync(versions)) dirs.push(join(versions, entry, "bin"));
    } catch {
      // unreadable nvm dir — not fatal, the other strategies still apply.
    }
  }
  return dirs;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Exported for tests. The directories searched, in order, for `name` —
 * `PATH` first (so an operator's own `PATH` always wins over our table), then
 * the installer table. Surfaced to the UI's setup guide so a "not found" is
 * inspectable rather than a shrug. */
export function searchDirs(): string[] {
  const fromPath = (process.env.PATH ?? "").split(delimiter).filter((d) => d.length > 0);
  const seen = new Set<string>();
  return [...fromPath, ...candidateDirs()].filter((d) => {
    if (seen.has(d)) return false;
    seen.add(d);
    return true;
  });
}

/** Strategy 3. Asks the login shell the same question the operator would type.
 * Bounded and never throws — a shell that hangs or doesn't exist just means
 * this strategy found nothing. `name` is always one of our own literals, but
 * it is validated anyway because it is interpolated into a shell string. */
function askLoginShell(name: string): string | null {
  if (!/^[a-z0-9_-]+$/i.test(name)) return null;
  const shell = process.env.SHELL;
  if (!shell || !existsSync(shell)) return null;
  // `-lc` covers login-file installs (Homebrew's shellenv in .zprofile);
  // `-ic` covers rc-file-only installs (nvm in .zshrc). Both are tried
  // because macOS distributes these two cases about evenly.
  for (const flags of ["-lc", "-ic"]) {
    try {
      const out = execFileSync(shell, [flags, `command -v ${name}`], {
        encoding: "utf8",
        timeout: 3000,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const line = out.split("\n").map((l) => l.trim()).find((l) => l.startsWith("/"));
      if (line && isExecutable(line)) return line;
    } catch {
      // non-zero exit (not found), timeout, or no such shell — try the next.
    }
  }
  return null;
}

const cache = new Map<string, string | null>();

/** The absolute path to `name`'s executable, or null if nothing was found.
 * Callers that spawn should use `resolveCliBin`, which falls back to the bare
 * name so the OS produces its own error rather than us inventing one. */
export function findCliBin(name: string): string | null {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;

  let found: string | null = null;
  const override = overrideFor(name);
  if (override) {
    found = isExecutable(override) ? override : null;
  } else {
    const exts = platform() === "win32" ? [".cmd", ".exe", ""] : [""];
    outer: for (const dir of searchDirs()) {
      for (const ext of exts) {
        const candidate = join(dir, `${name}${ext}`);
        if (isExecutable(candidate)) {
          found = candidate;
          break outer;
        }
      }
    }
    found ??= askLoginShell(name);
  }

  // Only a hit is cached. Caching a miss would mean an install done while the
  // server keeps running is invisible until restart — exactly what this
  // function's cache exists to avoid (see `clearCliBinCache`'s doc comment).
  if (found) cache.set(name, found);
  return found;
}

/** What to hand `spawn`. Falls back to the bare name when nothing was found so
 * the failure is the OS's familiar `ENOENT` rather than a path we made up —
 * `describeCli` is what turns that into an explanation. */
export function resolveCliBin(name: string): string {
  return findCliBin(name) ?? name;
}

export function clearCliBinCache(): void {
  cache.clear();
}
