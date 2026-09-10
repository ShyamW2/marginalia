import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_WINDOW_STATE,
  clampToDisplays,
  loadWindowState,
  saveWindowState,
  type WindowState,
} from "./windowState.js";

function tmpFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mrg-winstate-")), "window-state.json");
}

const files: string[] = [];
afterEach(() => {
  while (files.length) fs.rmSync(path.dirname(files.pop()!), { recursive: true, force: true });
});

describe("loadWindowState", () => {
  it("returns the default when no file exists", () => {
    const file = tmpFile();
    files.push(file);
    expect(loadWindowState(file)).toEqual(DEFAULT_WINDOW_STATE);
  });

  it("returns the default against a corrupt file rather than throwing", () => {
    const file = tmpFile();
    files.push(file);
    fs.writeFileSync(file, "{not json");
    expect(loadWindowState(file)).toEqual(DEFAULT_WINDOW_STATE);
  });

  it("returns the default against valid JSON that isn't a rectangle", () => {
    const file = tmpFile();
    files.push(file);
    fs.writeFileSync(file, JSON.stringify({ hello: "world" }));
    expect(loadWindowState(file)).toEqual(DEFAULT_WINDOW_STATE);
  });

  it("round-trips a saved state", () => {
    const file = tmpFile();
    files.push(file);
    const state: WindowState = { x: 100, y: 50, width: 1400, height: 900, isMaximized: true };
    saveWindowState(file, state);
    expect(loadWindowState(file)).toEqual(state);
  });

  it("floors width/height at the minimum rather than restoring a sliver", () => {
    const file = tmpFile();
    files.push(file);
    saveWindowState(file, { x: 0, y: 0, width: 10, height: 10, isMaximized: false });
    const loaded = loadWindowState(file);
    expect(loaded.width).toBeGreaterThanOrEqual(480);
    expect(loaded.height).toBeGreaterThanOrEqual(360);
  });
});

describe("clampToDisplays", () => {
  const primary = { x: 0, y: 0, width: 1920, height: 1080 };

  it("leaves a state that's on-screen alone", () => {
    const state: WindowState = { x: 100, y: 100, width: 800, height: 600, isMaximized: false };
    expect(clampToDisplays(state, [primary])).toEqual(state);
  });

  it("falls back to the default when the saved position is on a display that's gone", () => {
    // A laptop undocked from a monitor that used to sit to its right.
    const state: WindowState = { x: 2200, y: 100, width: 800, height: 600, isMaximized: false };
    expect(clampToDisplays(state, [primary])).toEqual(DEFAULT_WINDOW_STATE);
  });

  it("preserves isMaximized on fallback — a maximized window should still maximize", () => {
    const state: WindowState = { x: -5000, y: -5000, width: 800, height: 600, isMaximized: true };
    expect(clampToDisplays(state, [primary]).isMaximized).toBe(true);
  });

  it("counts a partial overlap as on-screen", () => {
    const state: WindowState = { x: 1800, y: 100, width: 800, height: 600, isMaximized: false };
    expect(clampToDisplays(state, [primary])).toEqual(state);
  });

  it("checks every attached display, not just the first", () => {
    const secondary = { x: 1920, y: 0, width: 1920, height: 1080 };
    const state: WindowState = { x: 2000, y: 100, width: 800, height: 600, isMaximized: false };
    expect(clampToDisplays(state, [primary, secondary])).toEqual(state);
  });
});
