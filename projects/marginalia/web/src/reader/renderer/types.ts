/**
 * M40 §A (PDF.md §7.2): the format-neutral reading-pane seam. Prescriptive,
 * not pseudocode — matches PDF.md's own shape exactly. No epubjs (or pdf.js)
 * import belongs in this file; it is the contract every renderer implements,
 * and the chrome (ReaderView) depends only on this, never on a concrete
 * renderer's own extra surface.
 */

import type { HighlightKind } from "@marginalia/shared";
import type { SpreadMode } from "@marginalia/shared";

// ── Position ──────────────────────────────────────────────────────────────
/** Format-neutral position. Offsets are into the section's own text — the
 *  domain `resource_text` stores. `cfi` is EPUB's fast path, never required. */
export interface Locator {
  sectionIndex: number;
  offset: number;
  /** 0 for a caret (a reading position) rather than a range (a highlight). */
  length: number;
  cfi?: string;
}

/** What goes into `reading_state.location` (TEXT NOT NULL) and comes back out.
 *  ⚠️ A bare CFI string is valid input — every row written before M40 is one —
 *  so the parser accepts both and the writer emits the new form. */
export type SerializedLocator = string;

// ── Capabilities: the chrome asks these, never the format ────────────────
export interface RendererCapabilities {
  spread: boolean;
  fontScale: boolean;
  margins: boolean;
  pageFold: boolean;
  pageNumbers: boolean;
  textSelection: boolean;
  /** M41 §C1: true only for `PdfRenderer` — gates the zoom control cluster.
   *  EPUB reflows instead of zooming; `fontScale` already owns that job. */
  zoom: boolean;
  /** "page"   — discrete turns (today's EPUB pane)
   *  "scroll" — continuous within a section (M40 §C), or a zoomed-in native
   *             PDF pane past its own fit scale (M41 §C1)
   *  "image"  — fixed pages, no reflow (M41's native PDF at or under fit)
   *  Drives which progress readout the strip shows. */
  advance: "page" | "scroll" | "image";
}

// ── Events ────────────────────────────────────────────────────────────────
export interface RendererEvents {
  /** Fires on every position change, however this surface produces one — a
   *  page turn, a scroll, a jump. `bookPercent` is null until locations are
   *  ready; `sectionPercent` is always available. */
  relocated: (pos: {
    locator: Locator;
    bookPercent: number | null;
    sectionPercent: number;
  }) => void;
  selected: (sel: {
    text: string; prefix: string; suffix: string; locator: Locator;
  }) => void;
  markClicked: (highlightId: string) => void;
  /** M32's chapter-end trigger, however this surface defines "the end" —
   *  the last page, or scrolled to the bottom. */
  sectionEnd: () => void;
  error: (err: Error) => void;
}

export interface RendererOptions {
  flow: "paginated" | "scrolled";
  spread: SpreadMode;
  fontScale: number;
  marginPx: number;
}

export interface ResourceRenderer {
  mount(container: HTMLElement, resource: { id: string }, opts: RendererOptions): Promise<void>;
  destroy(): void;

  goTo(loc: Locator): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  currentLocation(): Locator | null;

  /** Returns an unsubscribe function. ⚠️ Not an `onSelection(cb)` with no way
   *  off — `ReaderView` mounts and unmounts these across route changes. */
  on<K extends keyof RendererEvents>(event: K, cb: RendererEvents[K]): () => void;

  paintMark(highlightId: string, loc: Locator, kind: HighlightKind): void;
  removeMark(highlightId: string): void;
  /** M43 §A corrective: the mark whose annotation panel is open lifts to
   *  `hoverFillOpacity` strength (still blended, never opaque — the glyphs
   *  underneath stay legible) so it's visually clear which highlight the
   *  open panel belongs to. Null clears it. Idempotent, and safe to call on
   *  every open/close/switch — implementations no-op when the id is
   *  unchanged. */
  setActiveHighlight(id: string | null): void;
  /** The transient, non-highlight tint — audio's sentence follow. At most one
   *  at a time; null clears. Deliberately separate from paintMark, because
   *  `ReaderView` already keeps these two bookkeepings apart (`tintCfiRef` vs
   *  `cfiOwnersRef`) and merging them re-introduces a bug that was already fixed. */
  setTint(loc: Locator | null): void;
  /** Viewport rect of a painted mark, for positioning its annotation panel.
   *  Null when the mark is not currently on screen. */
  markRect(highlightId: string): DOMRect | null;

  applyTheme(vars: ReaderThemeVars): void;
  setFontScale(scale: number): void;
  setMargins(px: number): void;
  /** M41 §C1, amended M43 §C2. No-op under `capabilities.zoom === false`.
   *  "free" only ever results from `zoomIn`/`zoomOut` stepping past the
   *  active fit mode's own scale — there is no `setZoomMode("free")`.
   *  `fit-page` fits one page to both axes; `fit-spread` fits two, also to
   *  both axes, resolving to a single page at a width too narrow for a
   *  legible spread (`shouldShowSpread`). */
  setZoomMode(mode: "fit-page" | "fit-spread"): void;
  zoomIn(): void;
  zoomOut(): void;
  /** M42 §D1: the continuous counterpart to `zoomIn`/`zoomOut` — an
   *  absolute target scale from a live gesture (wheel, touch pinch, or a
   *  drag on the chrome's zoom slider), called many times a second while
   *  the gesture is live. No-op under `capabilities.zoom === false`, same
   *  as the discrete pair. */
  setZoomScale(scale: number): void;

  readonly capabilities: RendererCapabilities;
}

/**
 * Renamed from `EpubThemeVars` (M40 §A, PDF.md §7.2): a type with a format in
 * its name cannot sit on a format-neutral seam. Content is unchanged — CSS
 * custom properties read off `document.documentElement` — see
 * `useReaderThemeVars.ts`.
 */
export interface ReaderThemeVars {
  bg: string;
  text: string;
  accent: string;
  fontSerif: string;
  highlight: string;
  highlightActive: string;
  border: string;
  /** Reference hue per highlight kind (docs/marginalia/DESIGN.md). */
  kindColors: Record<HighlightKind, string>;
  /** The theme actually in effect right now — resolved via `color-scheme`,
   * which theme.css sets explicitly for both the "paper"/"ink" override and
   * the prefers-color-scheme fallback, so this always matches what's on
   * screen regardless of which path produced it. */
  colorScheme: "light" | "dark";
}

/**
 * M40 §B4 (PDF.md §7.3): `reading_state.location`'s serialization convention.
 * A legacy bare CFI string (every row written before M40) is valid input —
 * it parses into a `Locator` whose `cfi` is set and whose
 * `sectionIndex`/`offset`/`length` are placeholders, which is harmless
 * because `EpubRenderer.goTo()` resolves `loc.cfi` first and never looks at
 * the placeholders when a `cfi` is present.
 */
export function serializeLocator(loc: Locator): SerializedLocator {
  return JSON.stringify({
    v: 1,
    sectionIndex: loc.sectionIndex,
    offset: loc.offset,
    length: loc.length,
    cfi: loc.cfi,
  });
}

export function parseSerializedLocator(s: SerializedLocator): Locator {
  if (s.startsWith("epubcfi(")) {
    return { sectionIndex: 0, offset: 0, length: 0, cfi: s };
  }
  const parsed = JSON.parse(s) as {
    sectionIndex: number;
    offset: number;
    length: number;
    cfi?: string;
  };
  return {
    sectionIndex: parsed.sectionIndex,
    offset: parsed.offset,
    length: parsed.length,
    cfi: parsed.cfi,
  };
}
