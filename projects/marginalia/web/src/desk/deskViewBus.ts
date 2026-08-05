const EVENT = "marginalia:desk-view-mode-change";
const STORAGE_KEY = "marginalia:desk-view-mode";

export type DeskViewMode = "desk" | "list";

export function loadDeskViewMode(): DeskViewMode {
  if (typeof localStorage === "undefined") return "desk";
  return localStorage.getItem(STORAGE_KEY) === "list" ? "list" : "desk";
}

export function persistDeskViewMode(mode: DeskViewMode): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, mode);
}

/**
 * `d`/`l` (M22.5 "d for the Desk, l for the Library") must work from
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
 */
export function emitDeskViewMode(mode: DeskViewMode): void {
  persistDeskViewMode(mode);
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
