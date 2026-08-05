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
  tasksTray: "t",
  // M22.5 "d for the Desk, l for the Library": both land on "/" — the same
  // route, DeskPage — but set its local view mode, so they need their own
  // keys rather than reusing `reader`'s.
  desk: "d",
  list: "l",
  // M21: play/pause reuses prevPage/nextPage's own key for skip-sentence,
  // distinguished by shift (AUDIO.md: "space", "shift+←/→").
  playPause: " ",
  skipSentencePrev: "ArrowLeft",
  skipSentenceNext: "ArrowRight",
} as const;
