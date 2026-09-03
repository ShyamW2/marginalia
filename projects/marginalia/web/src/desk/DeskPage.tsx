import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";
import type { CursorStyleChoice, Settings } from "@marginalia/shared";
import { Toast } from "../app/Toast.js";
import { ChromeSlotPortal } from "../app/chromeSlot.js";
import { LibraryGrid } from "../library/LibraryGrid.js";
import { useLibrary } from "../library/useLibrary.js";
import { Button } from "../controls/Button.js";
import { SHORTCUT_KEYS } from "../shortcuts/keys.js";
import { useShortcuts } from "../shortcuts/useShortcuts.js";
import { DeskCanvas } from "./DeskCanvas.js";
import { ShelfView } from "./ShelfView.js";
import { loadDeskViewMode, onDeskViewMode, persistDeskViewMode, type DeskViewMode } from "./deskViewBus.js";
import styles from "./DeskPage.module.css";

type ViewMode = DeskViewMode;

const HEADINGS: Record<ViewMode, string> = {
  desk: "The Desk",
  list: "Library",
  shelf: "The Shelf",
};

interface DeskPageProps {
  /** M22.5: true when the Desk is mounted only as the hidden background
   * behind an open Settings/Scan/Digest overlay — its own header actions
   * then stay out of the chrome row (they'd widen it behind the overlay's
   * back, and the true foreground surface owns that corner instead). */
  overlayOpen?: boolean;
}

/**
 * The default room (DESIGN.md "Room 1 — The Desk"): a freeform workspace of
 * draggable books, with the pre-M8 accessible grid surviving as a "List"
 * toggle — the canonical keyboard/screen-reader path.
 */
export function DeskPage({ overlayOpen = false }: DeskPageProps) {
  const {
    resources,
    uploads,
    isDragging,
    publishingId,
    toast,
    setToast,
    fileInputRef,
    importFiles,
    dismissUpload,
    handlePublish,
    handleDrop,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
  } = useLibrary();

  const [mode, setMode] = useState<ViewMode>(loadDeskViewMode);
  const [cursorStyle, setCursorStyle] = useState<CursorStyleChoice>("custom");
  const [cursorTrailEnabled, setCursorTrailEnabled] = useState(true);
  const reducedMotion = Boolean(useReducedMotion());

  // M22 "the desk tool": session-only, deliberately not persisted — a
  // physical toggle you'd expect to still be lit next time you sit down
  // would also be easy to leave on and forget (DESIGN.md gives no
  // persistence rule; this is the boring, safer default — SPEC-GAP, NOTES.md).
  // Lives here, above both view modes, since "opening any book" applies
  // whichever one is showing.
  const [listeningEngaged, setListeningEngaged] = useState(false);
  useShortcuts([
    { key: SHORTCUT_KEYS.escape, handler: () => listeningEngaged && setListeningEngaged(false), allowWhileTyping: true },
  ]);

  useEffect(() => {
    persistDeskViewMode(mode);
  }, [mode]);

  // M22.5: `d`/`l`, registered globally in NavCluster so they work from any
  // room or instrument, reach this already-mounted DeskPage (visible or the
  // hidden background behind an overlay) through the bus. A `DeskPage` that
  // isn't mounted yet (the reader is a full room, not an overlay, so
  // there's nothing here to notify) picks the mode up instead from
  // `loadDeskViewMode` above, which `emitDeskViewMode` persists to before
  // this component ever mounts — see deskViewBus.ts.
  useEffect(() => onDeskViewMode(setMode), []);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => (res.ok ? (res.json() as Promise<Settings>) : null))
      .then((settings) => {
        if (!settings) return;
        setCursorStyle(settings.cursorStyle);
        setCursorTrailEnabled(settings.cursorTrailEnabled);
      })
      .catch(() => {
        // keep defaults — the desk still works with system cursor, no trail
      });
  }, []);

  const hasBooks = resources.length > 0;

  return (
    <div
      className={
        isDragging
          ? `${styles.page} register-paper ${mode === "desk" ? styles.deskMode : ""} ${styles.dragging}`
          : `${styles.page} register-paper ${mode === "desk" ? styles.deskMode : ""}`
      }
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".epub,.pdf"
        multiple
        className={styles.hiddenInput}
        onChange={(event) => {
          if (event.target.files) importFiles(event.target.files);
          event.target.value = "";
        }}
      />

      {hasBooks && (
        <div className={styles.headerRow}>
          <h1 className={styles.heading}>{HEADINGS[mode]}</h1>
        </div>
      )}

      {/* M22.5 (decisions.md 2026-08-04 "nothing else may occupy the
          top-right corner"): the Desk's global actions join NavCluster's
          chrome row instead of laying out their own fixed header cluster,
          which used to end up underneath it. Suppressed while an overlay
          hides the Desk — see DeskPageProps.overlayOpen. */}
      {hasBooks && !overlayOpen && (
        <ChromeSlotPortal>
          <div className={styles.modeToggle} role="group" aria-label="View">
            <Button
              size="sm"
              variant="ghost"
              pressed={mode === "desk"}
              className={styles.modeButton}
              onClick={() => setMode("desk")}
            >
              Desk
            </Button>
            <Button
              size="sm"
              variant="ghost"
              pressed={mode === "shelf"}
              className={styles.modeButton}
              onClick={() => setMode("shelf")}
            >
              Shelf
            </Button>
            <Button
              size="sm"
              variant="ghost"
              pressed={mode === "list"}
              className={styles.modeButton}
              onClick={() => setMode("list")}
            >
              List
            </Button>
          </div>
          <Button variant="solid" size="sm" onClick={() => fileInputRef.current?.click()}>
            Import book
          </Button>
        </ChromeSlotPortal>
      )}

      {uploads.length > 0 && (
        <ul className={styles.uploadList}>
          {uploads.map((upload) => (
            <li key={upload.id} className={styles.uploadItem}>
              <span className={styles.uploadName}>{upload.fileName}</span>
              {upload.status === "uploading" ? (
                <div className={styles.progressTrack}>
                  <div className={styles.progressFill} style={{ width: `${upload.progress}%` }} />
                </div>
              ) : (
                <span className={styles.uploadError}>
                  {upload.error}
                  <Button
                    size="sm"
                    variant="ghost"
                    className={styles.dismissButton}
                    onClick={() => dismissUpload(upload.id)}
                  >
                    Dismiss
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {hasBooks ? (
        mode === "shelf" ? (
          <ShelfView
            resources={resources}
            publishingId={publishingId}
            onPublish={handlePublish}
            listeningEngaged={listeningEngaged}
          />
        ) : mode === "desk" ? (
          <DeskCanvas
            resources={resources}
            reducedMotion={reducedMotion}
            cursorStyle={cursorStyle}
            cursorTrailEnabled={cursorTrailEnabled}
            publishingId={publishingId}
            onPublish={handlePublish}
            onToast={setToast}
            listeningEngaged={listeningEngaged}
            onToggleListening={() => setListeningEngaged((prev) => !prev)}
          />
        ) : (
          <LibraryGrid
            resources={resources}
            publishingId={publishingId}
            onPublish={handlePublish}
            listeningEngaged={listeningEngaged}
          />
        )
      ) : (
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>Your library is empty</div>
          <p>Drag an .epub or .pdf here, or use the file picker, to start reading.</p>
          <Button
            variant="solid"
            className={styles.emptyImport}
            onClick={() => fileInputRef.current?.click()}
          >
            Choose a file
          </Button>
        </div>
      )}

      {toast && (
        <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />
      )}
    </div>
  );
}
