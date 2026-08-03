import { useEffect, useRef, useState } from "react";
import type { DigestStatus, ScanChapter } from "@marginalia/shared";
import { ProviderPicker } from "../settings/ProviderPicker.js";
import { useOpenSettings } from "../settings/useOpenSettings.js";
import { ChapterDial } from "./ChapterDial.js";
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
}

/**
 * The spotlight (decisions.md 2026-07-28 later): a chapter-range picker
 * shown only while initiating a digest, not a persistent mode — this
 * component only exists in the DOM while the scan's "Digest…" toggle is on.
 * The FROM/TO selects are the precise, always-available, keyboard path
 * (decisions.md 2026-07-29 later); the M20.5 dials below are the charm on
 * top (replacing the M18 torch — a flat click-drag-to-aim cone didn't
 * generalise the way a real analog control should), kept in sync with the
 * selects in both directions, never the only way in.
 */
export function DigestSpotlight({ resourceId, chapters, onClose }: DigestSpotlightProps) {
  const openSettingsToLLM = useOpenSettings("llm");
  const [status, setStatus] = useState<DigestStatus | null>(null);
  const [startIdx, setStartIdxRaw] = useState(0);
  const [endIdx, setEndIdxRaw] = useState(Math.max(0, chapters.length - 1));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const abortRef = useRef<AbortController | null>(null);

  // Just the timeline's own width now — it drives the "is this tile wide
  // enough to fit a number" check below; the torch's warp-aware fraction
  // math this used to also feed is gone with the torch.
  const timelineRef = useRef<HTMLDivElement>(null);
  const [timelineWidth, setTimelineWidth] = useState(0);

  // M20.5 "dialling FROM past TO is impossible or self-correcting, never a
  // silent invalid range": both the selects and the dials go through these,
  // so a FROM dragged past the current TO pushes TO along with it (and vice
  // versa) instead of landing on a disabled Digest button with no
  // explanation — the same self-correcting rule in both directions.
  function setStartIdx(next: number) {
    setStartIdxRaw(next);
    setEndIdxRaw((prevEnd) => Math.max(prevEnd, next));
  }
  function setEndIdx(next: number) {
    setEndIdxRaw(next);
    setStartIdxRaw((prevStart) => Math.min(prevStart, next));
  }

  useEffect(() => {
    fetchDigestStatus(resourceId).then(setStatus);
  }, [resourceId]);

  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setTimelineWidth(el.getBoundingClientRect().width));
    observer.observe(el);
    return () => observer.disconnect();
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

  return (
    <div className={styles.panel} role="region" aria-label="Digest spotlight">
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.title}>Digest</span>
          <ProviderPicker role="digest" variant="compact" onNavigateToSettings={openSettingsToLLM} />
        </div>
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close spotlight">
          ×
        </button>
      </div>

      {/* M18 "the digest instrument: bigger timeline" (decisions.md
          2026-07-29 later): each tile is real width (proportional to the
          chapter's share of the book) and hoverable for its title + percent
          range — a read-only coverage map now that the M20.5 dials below
          are where the range actually gets set, not a click-drag surface
          of its own. */}
      <div className={styles.timeline} ref={timelineRef} aria-hidden="true">
        {statusChapters.map((c) => {
          const widthPx = c.lengthPercent * timelineWidth;
          return (
            <div
              key={c.spineIndex}
              className={c.digested ? styles.tileDone : styles.tilePending}
              style={{ left: `${c.startPercent * 100}%`, width: `${c.lengthPercent * 100}%` }}
              title={`${c.title ?? `Section S${c.chapterNumber}`} · ${formatRange(c.startPercent, c.lengthPercent)}${c.digested ? " — digested" : " — not yet digested"}`}
            >
              {/* "every tile is identifiable without hovering" (decisions.md
                  2026-07-29 later) — the section number, always the safe,
                  ungated value; a tile too narrow to fit it legibly just
                  doesn't show one, the same tick-vs-label split the strip's
                  own chapter axis already uses (chapterAxis.ts). */}
              {widthPx >= 16 && <span className={styles.tileNumber}>S{c.chapterNumber}</span>}
            </div>
          );
        })}
      </div>
      <div className={styles.coverageLabel}>
        {coveredCount} of {totalCount} sections digested — dial a range or use From/To below
      </div>

      {/* M20.5 "the digest range picker becomes analog dials" (TASKS.md,
          replaces the M18 torch): the charm on top of the selects below,
          never the only way in — dragging one past the other self-corrects
          (setStartIdx/setEndIdx above) rather than landing on a silently
          disabled Digest button. */}
      <div className={styles.dialRow}>
        <ChapterDial label="From" chapters={chapters} value={startIdx} onCommit={setStartIdx} disabled={running} />
        <ChapterDial label="To" chapters={chapters} value={endIdx} onCommit={setEndIdx} disabled={running} />
      </div>

      {/* M19.5: book-level synopsis now has a spoiler-safe (bookmark-
          bounded) and full variant — the spotlight, being a "start a
          digest run" control rather than a reading surface, shows whichever
          is available without a reveal gesture of its own; the digest page
          is where the full reveal control lives. */}
      {status?.book && (status.book.safe ?? status.book.full) && (
        <p className={styles.synopsis}>{(status.book.safe ?? status.book.full)!.synopsis}</p>
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
                {`S${c.chapterNumber}${c.title ? `: ${c.title}` : ""}`}
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
                {`S${c.chapterNumber}${c.title ? `: ${c.title}` : ""}`}
              </option>
            ))}
          </select>
        </label>
        {running ? (
          <button type="button" className={styles.cancelButton} onClick={handleCancel}>
            Stop waiting…
          </button>
        ) : (
          <button type="button" className={styles.digestButton} onClick={handleStart}>
            Digest
          </button>
        )}
      </div>
    </div>
  );
}
