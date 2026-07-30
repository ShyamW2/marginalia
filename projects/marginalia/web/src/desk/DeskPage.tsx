import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";
import type { CursorStyleChoice, Settings } from "@marginalia/shared";
import { Toast } from "../app/Toast.js";
import { LibraryGrid } from "../library/LibraryGrid.js";
import { useLibrary } from "../library/useLibrary.js";
import { Button } from "../controls/Button.js";
import { DeskCanvas } from "./DeskCanvas.js";
import styles from "./DeskPage.module.css";

type ViewMode = "desk" | "list";
const VIEW_MODE_KEY = "marginalia:desk-view-mode";

function loadViewMode(): ViewMode {
  if (typeof localStorage === "undefined") return "desk";
  return localStorage.getItem(VIEW_MODE_KEY) === "list" ? "list" : "desk";
}

/**
 * The default room (DESIGN.md "Room 1 — The Desk"): a freeform workspace of
 * draggable books, with the pre-M8 accessible grid surviving as a "List"
 * toggle — the canonical keyboard/screen-reader path.
 */
export function DeskPage() {
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

  const [mode, setMode] = useState<ViewMode>(loadViewMode);
  const [cursorStyle, setCursorStyle] = useState<CursorStyleChoice>("custom");
  const [cursorTrailEnabled, setCursorTrailEnabled] = useState(true);
  const reducedMotion = Boolean(useReducedMotion());

  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, mode);
  }, [mode]);

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
        accept=".epub"
        multiple
        className={styles.hiddenInput}
        onChange={(event) => {
          if (event.target.files) importFiles(event.target.files);
          event.target.value = "";
        }}
      />

      {hasBooks && (
        <div className={styles.headerRow}>
          <h1 className={styles.heading}>{mode === "desk" ? "The Desk" : "Library"}</h1>
          <div className={styles.headerActions}>
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
                pressed={mode === "list"}
                className={styles.modeButton}
                onClick={() => setMode("list")}
              >
                List
              </Button>
            </div>
            <Button variant="solid" onClick={() => fileInputRef.current?.click()}>
              Import book
            </Button>
          </div>
        </div>
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
        mode === "desk" ? (
          <DeskCanvas
            resources={resources}
            reducedMotion={reducedMotion}
            cursorStyle={cursorStyle}
            cursorTrailEnabled={cursorTrailEnabled}
            publishingId={publishingId}
            onPublish={handlePublish}
            onToast={setToast}
          />
        ) : (
          <LibraryGrid resources={resources} publishingId={publishingId} onPublish={handlePublish} />
        )
      ) : (
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>Your library is empty</div>
          <p>Drag an .epub here, or use the file picker, to start reading.</p>
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
