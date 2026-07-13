import { useEffect, useRef, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import type { ResourceSummary } from "@marginalia/shared";
import styles from "./LibraryPage.module.css";

interface UploadItem {
  id: string;
  fileName: string;
  progress: number;
  status: "uploading" | "error";
  error?: string;
}

function parseErrorMessage(responseText: string): string {
  try {
    const body = JSON.parse(responseText) as { error?: string };
    if (body.error === "unsupported_format") return "Only .epub files are supported";
    if (body.error) return body.error;
  } catch {
    // fall through to generic message
  }
  return "Import failed";
}

export function LibraryPage() {
  const [resources, setResources] = useState<ResourceSummary[]>([]);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchResources();
  }, []);

  async function fetchResources() {
    try {
      const res = await fetch("/api/resources");
      if (!res.ok) return;
      const data = (await res.json()) as ResourceSummary[];
      setResources(data);
    } catch {
      // server unreachable — leave the library empty rather than erroring the page
    }
  }

  function importFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      if (!file.name.toLowerCase().endsWith(".epub")) {
        setUploads((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            fileName: file.name,
            progress: 0,
            status: "error",
            error: "Only .epub files are supported",
          },
        ]);
        continue;
      }
      uploadFile(file);
    }
  }

  function uploadFile(file: File) {
    const id = crypto.randomUUID();
    setUploads((prev) => [
      ...prev,
      { id, fileName: file.name, progress: 0, status: "uploading" },
    ]);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/resources");
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const progress = Math.round((event.loaded / event.total) * 100);
      setUploads((prev) =>
        prev.map((u) => (u.id === id ? { ...u, progress } : u)),
      );
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setUploads((prev) => prev.filter((u) => u.id !== id));
        fetchResources();
      } else {
        const message = parseErrorMessage(xhr.responseText);
        setUploads((prev) =>
          prev.map((u) =>
            u.id === id ? { ...u, status: "error", error: message } : u,
          ),
        );
      }
    };
    xhr.onerror = () => {
      setUploads((prev) =>
        prev.map((u) =>
          u.id === id ? { ...u, status: "error", error: "Upload failed" } : u,
        ),
      );
    };

    const formData = new FormData();
    formData.append("file", file, file.name);
    xhr.send(formData);
  }

  function dismissUpload(id: string) {
    setUploads((prev) => prev.filter((u) => u.id !== id));
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    if (event.dataTransfer.files.length > 0) importFiles(event.dataTransfer.files);
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
  }

  const hasBooks = resources.length > 0;

  return (
    <div
      className={isDragging ? `${styles.page} ${styles.dragging}` : styles.page}
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
          <h1 className={styles.heading}>Library</h1>
          <button
            type="button"
            className={styles.importButton}
            onClick={() => fileInputRef.current?.click()}
          >
            Import book
          </button>
        </div>
      )}

      {uploads.length > 0 && (
        <ul className={styles.uploadList}>
          {uploads.map((upload) => (
            <li key={upload.id} className={styles.uploadItem}>
              <span className={styles.uploadName}>{upload.fileName}</span>
              {upload.status === "uploading" ? (
                <div className={styles.progressTrack}>
                  <div
                    className={styles.progressFill}
                    style={{ width: `${upload.progress}%` }}
                  />
                </div>
              ) : (
                <span className={styles.uploadError}>
                  {upload.error}
                  <button
                    type="button"
                    className={styles.dismissButton}
                    onClick={() => dismissUpload(upload.id)}
                  >
                    Dismiss
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {hasBooks ? (
        <div className={styles.grid}>
          {resources.map((resource) => (
            <Link
              key={resource.id}
              to={`/read/${resource.id}`}
              className={styles.card}
            >
              <div className={styles.cardTitle}>{resource.title}</div>
              {resource.author && (
                <div className={styles.cardAuthor}>{resource.author}</div>
              )}
              <div className={styles.cardMeta}>
                {resource.highlightCount > 0
                  ? `${resource.highlightCount} highlight${
                      resource.highlightCount === 1 ? "" : "s"
                    }`
                  : "No highlights yet"}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>Your library is empty</div>
          <p>Drag an .epub here, or use the file picker, to start reading.</p>
          <button
            type="button"
            className={`${styles.importButton} ${styles.emptyImport}`}
            onClick={() => fileInputRef.current?.click()}
          >
            Choose a file
          </button>
        </div>
      )}
    </div>
  );
}
