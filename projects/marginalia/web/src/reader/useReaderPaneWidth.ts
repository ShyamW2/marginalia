import { useState, type Dispatch, type SetStateAction } from "react";
import type { ReaderPaneWidth, Settings, SpreadMode } from "@marginalia/shared";
import { emitSettingsSaved } from "../settings/settingsBus.js";

// M19.6 "the reading pane is resizable": clamps for the drag-set override —
// wide enough to be pointless below, tall-screen-friendly above.
const READER_PANE_WIDTH_MIN = 480;
const READER_PANE_WIDTH_MAX = 1800;

// M19.6 "the reading pane is resizable" (decisions.md 2026-07-30 later):
// same direct-PUT-from-the-reader pattern ThreadPanel's own size/offset
// persistence uses, rather than routing through the Settings modal — the
// drag handle lives in the reading surface, not a form. Broadcasts via the
// settingsBus (settings/settingsBus.ts) on success so any other mounted
// consumer of readerPaneWidth (there is none today, but readerMargin/
// readerFontScale already establish "settings changes are always live") is
// never silently out of sync.
function saveReaderPaneWidth(width: number): void {
  fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ readerPaneWidth: width }),
  })
    .then((res) => (res.ok ? (res.json() as Promise<Settings>) : null))
    .then((settings) => {
      if (settings) emitSettingsSaved(settings);
    })
    .catch(() => {
      // best-effort — worst case this reverts to the spread-mode default
      // next open
    });
}

/**
 * The drag-to-resize gesture on the reading pane's edge handle. Extracted
 * verbatim from ReaderView.tsx (M19.8 refactor) — the persisted value itself
 * (`readerPaneWidth`) stays owned by the caller, since it's synced together
 * with the other live-via-settingsBus reader settings (margin, font scale,
 * page numbers); this hook only owns the gesture and the derived effective
 * width.
 */
export function useReaderPaneWidth(
  readerPaneWidth: ReaderPaneWidth,
  setReaderPaneWidth: Dispatch<SetStateAction<ReaderPaneWidth>>,
  spreadMode: SpreadMode,
  fullscreenMode: boolean,
): {
  effectivePaneWidth: number;
  paneWidthDragging: boolean;
  handlePaneResizePointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
} {
  const [paneWidthDragging, setPaneWidthDragging] = useState(false);

  // M19.6 "the reading pane is resizable" (decisions.md 2026-07-30 later):
  // the drag-set override (if any) replaces the spread-mode default outright
  // rather than adding to it — one clear number, not a fourth knob stacked
  // on the other three (readerMargin/READER_TARGET_COLUMN_WIDTH/
  // SPREAD_GUTTER already own their own jobs, per decisions.md 2026-07-27).
  const spreadDefaultPaneWidth = fullscreenMode ? 1600 : spreadMode === "auto" ? 1400 : 800;
  const effectivePaneWidth = readerPaneWidth > 0 ? readerPaneWidth : spreadDefaultPaneWidth;

  // Dragging the right edge of a *centered* pane: the row grows/shrinks
  // symmetrically, so the edge under the pointer only moves by half of any
  // width change — doubling the pointer's own delta is what keeps the
  // handle tracking the cursor 1:1 instead of lagging at half speed.
  function handlePaneResizePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startWidth = effectivePaneWidth;
    const startX = event.clientX;
    setPaneWidthDragging(true);

    function onMove(moveEvent: PointerEvent) {
      const delta = (moveEvent.clientX - startX) * 2;
      const next = Math.min(
        Math.max(Math.round(startWidth + delta), READER_PANE_WIDTH_MIN),
        READER_PANE_WIDTH_MAX,
      );
      setReaderPaneWidth(next);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setPaneWidthDragging(false);
      setReaderPaneWidth((current) => {
        saveReaderPaneWidth(current);
        return current;
      });
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return { effectivePaneWidth, paneWidthDragging, handlePaneResizePointerDown };
}
