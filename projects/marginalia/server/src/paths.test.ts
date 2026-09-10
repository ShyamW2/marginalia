import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MIGRATION_MARKER_NAME,
  resolveDataDir,
  resolveOsDataDir,
  resolveResourceDir,
  resolveUnpackedPath,
  WORKSPACE_ROOT,
} from "./paths.js";

function tmpDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `marginalia-paths-${label}-`));
  return dir;
}

describe("resolveDataDir", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("MARGINALIA_DATA_DIR always wins, migrated marker or not", () => {
    const override = tmpDir("override");
    process.env.MARGINALIA_DATA_DIR = override;
    expect(resolveDataDir()).toBe(path.resolve(override));
  });

  it("falls back to the legacy install-relative directory when it exists and nothing has migrated", () => {
    delete process.env.MARGINALIA_DATA_DIR;
    // The real WORKSPACE_ROOT/data exists on every dev checkout (including
    // this one) and the OS dir's marker does not — resolveDataDir must keep
    // reading from it, unchanged, exactly as it does today.
    expect(fs.existsSync(path.join(WORKSPACE_ROOT, "data"))).toBe(true);
    expect(resolveDataDir()).toBe(path.join(WORKSPACE_ROOT, "data"));
  });

  it("prefers the OS directory once its migration marker exists", () => {
    delete process.env.MARGINALIA_DATA_DIR;
    const fakeHome = tmpDir("home");
    vi.spyOn(os, "homedir").mockReturnValue(fakeHome);
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    delete process.env.XDG_DATA_HOME;

    const osDir = resolveOsDataDir()!;
    fs.mkdirSync(osDir, { recursive: true });
    fs.writeFileSync(path.join(osDir, MIGRATION_MARKER_NAME), "{}");

    expect(resolveDataDir()).toBe(osDir);
  });

  it("resolveOsDataDir returns null on an unhandled platform", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    expect(resolveOsDataDir()).toBeNull();
  });

  it("resolveOsDataDir respects XDG_DATA_HOME on Linux", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    const xdg = tmpDir("xdg");
    process.env.XDG_DATA_HOME = xdg;
    expect(resolveOsDataDir()).toBe(path.join(xdg, "marginalia"));
  });
});

describe("resolveResourceDir", () => {
  afterEach(() => {
    delete (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    delete process.env.MARGINALIA_RESOURCES_PATH;
  });

  it("falls back to WORKSPACE_ROOT outside Electron", () => {
    expect(resolveResourceDir()).toBe(WORKSPACE_ROOT);
  });

  it("prefers process.resourcesPath once Electron sets it", () => {
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = "/Applications/Marginalia.app/Contents/Resources";
    expect(resolveResourceDir()).toBe("/Applications/Marginalia.app/Contents/Resources");
  });

  // M45: the server now runs in a utilityProcess main forks explicitly, so
  // main passes its own resourcesPath down rather than relying on whatever
  // that process type does or doesn't inherit on its own.
  it("prefers MARGINALIA_RESOURCES_PATH over process.resourcesPath", () => {
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = "/wrong/path";
    process.env.MARGINALIA_RESOURCES_PATH = "/Applications/Marginalia.app/Contents/Resources";
    expect(resolveResourceDir()).toBe("/Applications/Marginalia.app/Contents/Resources");
  });
});

describe("resolveUnpackedPath", () => {
  it("is a no-op outside an asar archive", () => {
    const p = "/Applications/Marginalia.app/Contents/Resources/node_modules/wordnet-db/dict";
    expect(resolveUnpackedPath(p)).toBe(p);
  });

  it("rewrites an app.asar path to app.asar.unpacked", () => {
    const p = path.join("/Applications/Marginalia.app/Contents/Resources/app.asar", "node_modules/wordnet-db/dict");
    expect(resolveUnpackedPath(p)).toBe(
      path.join("/Applications/Marginalia.app/Contents/Resources/app.asar.unpacked", "node_modules/wordnet-db/dict"),
    );
  });
});
