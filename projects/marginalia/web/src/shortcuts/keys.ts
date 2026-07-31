/**
 * The literal key for every named shortcut, declared once (M19.7: "keycaps
 * that cannot lie"). A `useShortcuts` registration and the `KeyCap` hint
 * shown beside its icon both import from here instead of each typing their
 * own copy of the letter — so a rebind is a one-line change here, and the
 * on-screen hint can never advertise a binding that no longer exists.
 */
export const SHORTCUT_KEYS = {
  prevPage: "ArrowLeft",
  nextPage: "ArrowRight",
  prevChapter: "[",
  nextChapter: "]",
  focusMode: "f",
  fullscreen: "f",
  escape: "Escape",
  settings: "s",
  reader: "r",
  scan: "q",
} as const;
