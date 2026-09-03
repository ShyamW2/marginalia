import { useEffect, useRef, useState, type DragEvent } from "react";
import type { ResourceSummary } from "@marginalia/shared";
import { formatPublishSummary, runPublish } from "./publish.js";
import { useJobs } from "../jobs/JobsContext.js";

export interface UploadItem {
  id: string;
  fileName: string;
  progress: number;
  status: "uploading" | "error";
  error?: string;
}

function isImportableFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".epub") || lower.endsWith(".pdf");
}

function parseErrorMessage(responseText: string): string {
  try {
    const body = JSON.parse(responseText) as { error?: string };
    if (body.error === "unsupported_format") return "Only .epub and .pdf files are supported";
    if (body.error === "file_too_large") return "That file is over the 200MB import limit";
    if (body.error) return body.error;
  } catch {
    // fall through to generic message
  }
  return "Import failed";
}

/**
 * Data + actions shared by every room that shows the library: the desk
 * (freeform + list toggle) today, previously the standalone library grid.
 * One fetch/upload/publish pipeline so switching view modes never
 * double-fetches or drifts state.
 */
export function useLibrary() {
  const [resources, setResources] = useState<ResourceSummary[]>([]);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { jobs, registerStarted } = useJobs();
  // M39 §C5: a PDF import runs as a job, not the synchronous upload path
  // below — this tracks which finished `pdf-import` jobs have already
  // triggered a refetch, so the effect below doesn't re-fetch every time an
  // unrelated job update re-renders this hook.
  const settledPdfImportIds = useRef(new Set<string>());

  useEffect(() => {
    fetchResources();
  }, []);

  useEffect(() => {
    for (const job of jobs) {
      if (job.kind !== "pdf-import" || job.status === "running") continue;
      if (settledPdfImportIds.current.has(job.id)) continue;
      settledPdfImportIds.current.add(job.id);
      if (job.status === "completed") fetchResources();
    }
  }, [jobs]);

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
      if (!isImportableFile(file.name)) {
        setUploads((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            fileName: file.name,
            progress: 0,
            status: "error",
            error: "Only .epub and .pdf files are supported",
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
      // M39 §C5: a PDF import returns a jobId rather than the finished
      // resource — the byte upload is done, but extraction is still
      // running. Hand off to the tasks tray (already generic across job
      // kinds) instead of the upload list, which only ever tracked the
      // transfer itself.
      if (xhr.status === 202) {
        setUploads((prev) => prev.filter((u) => u.id !== id));
        try {
          const { jobId } = JSON.parse(xhr.responseText) as { jobId: string };
          registerStarted({ id: jobId, kind: "pdf-import", resourceId: null, resourceTitle: file.name });
        } catch {
          // Malformed response — the job still runs server-side and will
          // show up in the tray's next poll regardless.
        }
        return;
      }
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

  async function handlePublish(resourceId: string) {
    setPublishingId(resourceId);
    const outcome = await runPublish(resourceId);
    setPublishingId(null);
    setToast(
      outcome.ok
        ? { message: formatPublishSummary(outcome.result), tone: "success" }
        : { message: outcome.message, tone: "error" },
    );
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

  return {
    resources,
    setResources,
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
    fetchResources,
  };
}
