import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { DigestStatus, ScanChapter } from "@marginalia/shared";
import {
  beamFromChapterRange,
  beamHalfWidthFromDrag,
  beamRange,
  chapterIndexAtFraction,
  type BeamRange,
} from "./digestTimeline.js";
import { unwarpPoint, type WarpGeometry } from "./warp.js";
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

function formatRange(startPercent: number, lengthPercent: number): string {
  const from = Math.round(startPercent * 100);
  const to = Math.round((startPercent + lengthPercent) * 100);
  return `${from}–${to}%`;
}

interface DigestSpotlightProps {
  resourceId: string;
  chapters: ScanChapter[];
  onClose: () => void;
  /** M18: this panel lives inside ScanPage's single warped wrapper (it's
   * laid out inline, not a floating overlay — see DigestSpotlight.module.css),
   * so the torch needs the same barrel-mapping machinery HeatStrip's bands
   * use, just in the other direction: turning a *visual* pointer position
   * back into a raw domain fraction (`unwarpPoint`, warp.ts). */
  warpGeometry: WarpGeometry;
  warpWrapperRef: RefObject<HTMLDivElement>;
}

/**
 * The spotlight (decisions.md 2026-07-28 later): a chapter-range picker
 * shown only while initiating a digest, not a persistent mode — this
 * component only exists in the DOM while the scan's "Digest…" toggle is on.
 * The FROM/TO selects are the precise, always-available, keyboard path
 * (decisions.md 2026-07-29 later); the M18 torch below is the charm on top,
 * kept in sync with them in both directions, never the only way in.
 */
export function DigestSpotlight({ resourceId, chapters, onClose, warpGeometry, warpWrapperRef }: DigestSpotlightProps) {
  const [status, setStatus] = useState<DigestStatus | null>(null);
  const [startIdx, setStartIdx] = useState(0);
  const [endIdx, setEndIdx] = useState(Math.max(0, chapters.length - 1));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const abortRef = useRef<AbortController | null>(null);

  const timelineRef = useRef<HTMLDivElement>(null);
  const [timelineOffset, setTimelineOffset] = useState({ left: 0, top: 0, width: 0 });
  const [drag, setDrag] = useState<{ center: number; halfWidth: number; startY: number; baseHalfWidth: number } | null>(
    null,
  );

  useEffect(() => {
    fetchDigestStatus(resourceId).then(setStatus);
  }, [resourceId]);

  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const wrapperEl = warpWrapperRef.current;
      if (!wrapperEl) return;
      const rect = el.getBoundingClientRect();
      const wrapperRect = wrapperEl.getBoundingClientRect();
      setTimelineOffset({ left: rect.left - wrapperRect.left, top: rect.top - wrapperRect.top, width: rect.width });
    });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // M18 SPEC-GAP (NOTES.md): assumes `status.chapters` (digest coverage,
  // has percent/title) and `chapters` (the ScanChapter[] prop driving the
  // FROM/TO selects, has TOC titles) line up positionally — both are built
  // from the same resource's spine sections in spine order, and nothing
  // elsewhere in this file has ever needed a stricter join than that.
  const statusChapters = status?.chapters ?? [];

  /** Screen (post-warp) point -> raw fraction (0-1) along the timeline. */
  function fractionAtClientPoint(clientX: number, clientY: number): number {
    const wrapperEl = warpWrapperRef.current;
    if (!wrapperEl || timelineOffset.width === 0) return 0;
    const wrapperRect = wrapperEl.getBoundingClientRect();
    const raw = unwarpPoint(clientX - wrapperRect.left, clientY - wrapperRect.top, warpGeometry);
    const localX = raw.x - timelineOffset.left;
    return Math.min(1, Math.max(0, localX / timelineOffset.width));
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (running || statusChapters.length === 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const center = fractionAtClientPoint(e.clientX, e.clientY);
    const currentBeam = beamFromChapterRange(statusChapters, startIdx, endIdx);
    const baseHalfWidth = Math.max(0.03, (currentBeam.endFraction - currentBeam.startFraction) / 2);
    setDrag({ center, halfWidth: baseHalfWidth, startY: e.clientY, baseHalfWidth });
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const center = fractionAtClientPoint(e.clientX, e.clientY);
    const halfWidth = beamHalfWidthFromDrag(drag.baseHalfWidth, drag.startY, e.clientY);
    setDrag({ ...drag, center, halfWidth });
  }

  function handlePointerUp() {
    if (!drag) return;
    const { startFraction, endFraction } = beamRange(drag.center, drag.halfWidth);
    const lo = chapterIndexAtFraction(statusChapters, startFraction);
    const hi = chapterIndexAtFraction(statusChapters, endFraction);
    setStartIdx(Math.min(lo, hi));
    setEndIdx(Math.max(lo, hi));
    setDrag(null);
  }

  const liveBeam: BeamRange = drag
    ? beamRange(drag.center, drag.halfWidth)
    : beamFromChapterRange(statusChapters, startIdx, endIdx);

  return (
    <div className={styles.panel} role="region" aria-label="Digest spotlight">
      <div className={styles.header}>
        <span className={styles.title}>Digest</span>
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close spotlight">
          ×
        </button>
      </div>

      {/* M18 "the digest instrument: bigger timeline, and the torch"
          (decisions.md 2026-07-29 later): each tile is now real width
          (proportional to the chapter's share of the book, not a uniform
          dot) and hoverable for its title + percent range; the torch is a
          click-drag-to-aim, drag-up/down-to-widen flashlight cone sitting
          on top, kept in sync with FROM/TO in both directions. FROM/TO
          themselves are unchanged below — the torch never replaces them. */}
      <div
        className={styles.timeline}
        ref={timelineRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        aria-hidden="true"
      >
        {statusChapters.map((c) => {
          const widthPx = c.lengthPercent * timelineOffset.width;
          return (
            <div
              key={c.spineIndex}
              className={c.digested ? styles.tileDone : styles.tilePending}
              style={{ left: `${c.startPercent * 100}%`, width: `${c.lengthPercent * 100}%` }}
              title={`${c.title ?? `Chapter ${c.chapterNumber}`} · ${formatRange(c.startPercent, c.lengthPercent)}${c.digested ? " — digested" : " — not yet digested"}`}
            >
              {/* "every tile is identifiable without hovering" (decisions.md
                  2026-07-29 later) — the chapter number, always the safe,
                  ungated value; a tile too narrow to fit it legibly just
                  doesn't show one, the same tick-vs-label split the strip's
                  own chapter axis already uses (chapterAxis.ts). */}
              {widthPx >= 16 && <span className={styles.tileNumber}>{c.chapterNumber}</span>}
            </div>
          );
        })}
        {statusChapters.length > 0 && (
          <div
            className={styles.torchBeam}
            style={{
              left: `${liveBeam.startFraction * 100}%`,
              width: `${(liveBeam.endFraction - liveBeam.startFraction) * 100}%`,
            }}
          >
            <span className={styles.torchHandle}>🔦</span>
          </div>
        )}
      </div>
      <div className={styles.coverageLabel}>
        {coveredCount} of {totalCount} chapters digested — drag the torch or use From/To below
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
