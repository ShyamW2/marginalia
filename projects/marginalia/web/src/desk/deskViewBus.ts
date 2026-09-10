import { pushAppearanceSetting } from "../app/appearanceSync.js";

const EVENT = "marginalia:desk-view-mode-change";
const STORAGE_KEY = "marginalia:desk-view-mode";

export type DeskViewMode = "desk" | "list" | "shelf";

const MODES: readonly DeskViewMode[] = ["desk", "list", "shelf"];

export function loadDeskViewMode(): DeskViewMode {
  if (typeof localStorage === "undefined") return "desk";
  const stored = localStorage.getItem(STORAGE_KEY);
  return MODES.find((mode) => mode === stored) ?? "desk";
}

export function persistDeskViewMode(mode: DeskViewMode): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, mode);
}

/**
 * `d`/`l`/`b` (M22.5 "d for the Desk, l for the Library"; M23 §D adds the
 * shelf on `b`) must work from
 * anywhere, including from the reader — a full room, not an overlay, so
 * closing it leaves no `DeskPage` mounted at all (visible or as a hidden
 * background) for a DOM event to reach. Persisting here, synchronously,
 * before the `navigate("/")` that follows, is what the fresh `DeskPage`
 * about to mount actually reads (`loadDeskViewMode`, the same seed its
 * `useState` initializer already used). The event below is for the other
 * case — a `DeskPage` that's already mounted (visible, or hidden behind an
 * open Settings/Scan/Digest) won't remount to re-read `localStorage`, so it
 * needs to be told directly; its own effect re-persisting the same value
 * right back is harmless.
 *
 * M44 (DESKTOP.md §3.4): also writes through to the sidecar `settings` table
 * (`uiDeskViewMode`), best-effort — `localStorage` stays the instant-paint
 * cache `loadDeskViewMode` reads synchronously; `DeskPage` reconciles the
 * two once per mount the same way `useTheme`/`useAccent`/`usePaperTint` do.
 */
export function emitDeskViewMode(mode: DeskViewMode): void {
  persistDeskViewMode(mode);
  pushAppearanceSetting({ uiDeskViewMode: mode });
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<DeskViewMode>(EVENT, { detail: mode }));
}

export function onDeskViewMode(handler: (mode: DeskViewMode) => void): () => void {
  function listener(event: Event) {
    handler((event as CustomEvent<DeskViewMode>).detail);
  }
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

/** The server's recorded desk view mode, or null if it's unset or doesn't
 * parse to one of the three real modes — the caller's own default (today,
 * always `loadDeskViewMode()`'s "desk") applies in either case. */
export function parseServerDeskViewMode(raw: string): DeskViewMode | null {
  return MODES.find((mode) => mode === raw) ?? null;
}
