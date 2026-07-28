import { useEffect, useRef, useState } from "react";
import type { DigestStatus, ScanChapter } from "@marginalia/shared";
import styles from "./DigestSpotlight.module.css";

async function fetchDigestStatus(resourceId: string): Promise<DigestStatus | null> {
  try {
    const res = await fetch(`/api/resources/${resourceId}/digest`);
    if (!res.ok) return null;
    return (await res.json()) as DigestStatus;
  } catch {
    return null;
  }
}

async function startDigest(
  resourceId: string,
  spineStart: number,
  spineEnd: number,
  signal: AbortSignal,
): Promise<{ status: DigestStatus | null; error: string | null }> {
  try {
    const res = await fetch(`/api/resources/${resourceId}/digest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spineStart, spineEnd }),
      signal,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { status: null, error: body.error ?? "digest_failed" };
    }
    return { status: (await res.json()) as DigestStatus, error: null };
  } catch (err) {
    if (signal.aborted) return { status: null, error: null };
    return { status: null, error: err instanceof Error ? err.message : "network_error" };
  }
}

function formatResumesAt(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

interface DigestSpotlightProps {
  resourceId: string;
  chapters: ScanChapter[];
  onClose: () => void;
}

/**
 * The spotlight (decisions.md 2026-07-28 later): a chapter-range picker
 * shown only while initiating a digest, not a persistent mode — this
 * component only exists in the DOM while the scan's "Digest…" toggle is on.
 * Snaps to chapter boundaries by construction (the range pickers are
 * chapter-number selects, not a free-drag percent axis — SPEC-GAP: the
 * ⚠️ "no page numbers" warning in decisions.md is satisfied by never having
 * page numbers to begin with, not by suppressing them from a richer control
 * that would otherwise show them).
 */
export function DigestSpotlight({ resourceId, chapters, onClose }: DigestSpotlightProps) {
  const [status, setStatus] = useState<DigestStatus | null>(null);
  const [startIdx, setStartIdx] = useState(0);
  const [endIdx, setEndIdx] = useState(Math.max(0, chapters.length - 1));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetchDigestStatus(resourceId).then(setStatus);
  }, [resourceId]);

  // Live-ticks the "resuming at HH:MM" countdown and drives the automatic
  // resume once the rate-limit backoff has elapsed (decisions.md: "resume
  // automatically" — this app has no background job runner, so the
  // spotlight itself, while open, is what performs that resume; see
  // NOTES.md "M17" for why this is the boring choice given the
  // architecture).
  useEffect(() => {
    if (status?.run?.status !== "paused_rate_limit" || !status.run.resumesAt) return;
    const resumesAtMs = new Date(status.run.resumesAt).getTime();
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [status?.run?.status, status?.run?.resumesAt]);

  useEffect(() => {
    if (status?.run?.status !== "paused_rate_limit" || !status.run.resumesAt) return;
    if (now < new Date(status.run.resumesAt).getTime()) return;
    void runDigest(status.run.spineStart, status.run.spineEnd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  async function runDigest(spineStart: number, spineEnd: number) {
    setRunning(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const result = await startDigest(resourceId, spineStart, spineEnd, controller.signal);
    abortRef.current = null;
    setRunning(false);
    if (result.status) setStatus(result.status);
    else if (result.error) setError(result.error);
  }

  function handleStart() {
    if (chapters.length === 0) return;
    void runDigest(chapters[startIdx].spineIndex, chapters[endIdx].spineIndex);
  }

  function handleCancel() {
    // Stops the client from waiting on the response — the server has no
    // cancellation seam for an in-flight extract() call (SPEC-GAP, see
    // NOTES.md "M17"), so the current chapter's call may still complete
    // server-side; this just stops the UI from hanging on it.
    abortRef.current?.abort();
    setRunning(false);
  }

  const coveredCount = status?.chapters.filter((c) => c.digested).length ?? 0;
  const totalCount = status?.totalChapters ?? chapters.length;

  return (
    <div className={styles.panel} role="region" aria-label="Digest spotlight">
      <div className={styles.header}>
        <span className={styles.title}>Digest</span>
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close spotlight">
          ×
        </button>
      </div>

      <div className={styles.coverageLine} aria-label="Digest coverage">
        {status?.chapters.map((c) => (
          <span
            key={c.spineIndex}
            className={c.digested ? styles.coverageDotDone : styles.coverageDotPending}
            title={`${c.label}${c.digested ? " — digested" : " — not yet digested"}`}
          />
        ))}
      </div>
      <div className={styles.coverageLabel}>
        {coveredCount} of {totalCount} chapters digested
      </div>

      {status?.book && (
        <p className={styles.synopsis}>{status.book.synopsis}</p>
      )}

      {status?.run?.status === "paused_rate_limit" && status.run.resumesAt && (
        <div className={styles.pausedNotice}>
          Rate limited — resuming at {formatResumesAt(status.run.resumesAt)}.{" "}
          <button
            type="button"
            className={styles.resumeButton}
            onClick={() => runDigest(status.run!.spineStart, status.run!.spineEnd)}
            disabled={running}
          >
            Resume now
          </button>
        </div>
      )}
      {status?.run?.failedSpineIndices && status.run.failedSpineIndices.length > 0 && (
        <div className={styles.pausedNotice}>
          {status.run.failedSpineIndices.length} chapter(s) couldn't be digested (too long even after
          splitting) and were skipped.
        </div>
      )}
      {error && <div className={styles.pausedNotice}>Digest failed: {error}</div>}

      <div className={styles.rangeRow}>
        <label className={styles.rangeLabel}>
          From
          <select
            className={styles.rangeSelect}
            value={startIdx}
            onChange={(e) => setStartIdx(Number(e.target.value))}
            disabled={running}
          >
            {chapters.map((c, i) => (
              <option key={c.spineIndex} value={i}>
                {`Ch. ${c.chapterNumber}${c.title ? `: ${c.title}` : ""}`}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.rangeLabel}>
          To
          <select
            className={styles.rangeSelect}
            value={endIdx}
            onChange={(e) => setEndIdx(Number(e.target.value))}
            disabled={running}
          >
            {chapters.map((c, i) => (
              <option key={c.spineIndex} value={i}>
                {`Ch. ${c.chapterNumber}${c.title ? `: ${c.title}` : ""}`}
              </option>
            ))}
          </select>
        </label>
        {running ? (
          <button type="button" className={styles.cancelButton} onClick={handleCancel}>
            Stop waiting…
          </button>
        ) : (
          <button
            type="button"
            className={styles.digestButton}
            onClick={handleStart}
            disabled={startIdx > endIdx}
          >
            Digest
          </button>
        )}
      </div>
    </div>
  );
}
