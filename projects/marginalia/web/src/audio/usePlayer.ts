import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioSectionManifest } from "@marginalia/shared";
import { subscribeJobEvents } from "../jobs/jobsApi.js";
import { ensureSectionRendered, fetchSectionManifest, segmentAudioUrl } from "./audioApi.js";

export interface AudioSegmentRef {
  spineIndex: number;
  charStart: number;
  charEnd: number;
  text: string;
}

export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "error";

export interface AudioPlayer {
  status: PlayerStatus;
  /** A `TTSError` code, or a job-registry error string, when `status` is
   * `"error"` — the reader surfaces this rather than a dead player. */
  errorCode: string | null;
  /** The sentence currently sounding, in `resource_text` char offsets —
   * the reader resolves this to a DOM range for the tint. Null whenever
   * nothing is loaded/playing. */
  currentSegment: AudioSegmentRef | null;
  speed: number;
  /** Begins listening at `spineIndex`, sentence 0 — used by "Listen" entry
   * points and by skip-chapter. */
  startListening: (spineIndex: number) => void;
  /** Begins listening at `spineIndex`, a specific sentence — M22.6 C's
   * "play from here" pill action. Same `loadAndPlay` race as
   * `startListening` (an unrendered section still starts in seconds), just
   * without the sentence-0 assumption. */
  playFrom: (spineIndex: number, sentenceIndex: number) => void;
  pause: () => void;
  resume: () => void;
  toggle: () => void;
  skipSentence: (direction: 1 | -1) => void;
  skipChapter: (direction: 1 | -1) => void;
  setSpeed: (n: number) => void;
  /** Stops playback entirely and forgets position — used on unmount and
   * when leaving the book. */
  stop: () => void;
}

interface UsePlayerOptions {
  resourceId: string;
  /** Every spine index in reading order — used to find "the next/previous
   * section" for chapter-ahead prefetch and cross-section advance. Must be
   * a stable reference (memoized by the caller) or every render restarts
   * the section-boundary callbacks. */
  spineIndices: number[];
  initialSpeed: number;
}

export function usePlayer({ resourceId, spineIndices, initialSpeed }: UsePlayerOptions): AudioPlayer {
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [currentSegment, setCurrentSegment] = useState<AudioSegmentRef | null>(null);
  const [speed, setSpeedState] = useState(initialSpeed);

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  if (!audioElRef.current) audioElRef.current = new Audio();

  const manifestRef = useRef<AudioSectionManifest | null>(null);
  const spineIndexRef = useRef<number | null>(null);
  const segmentIndexRef = useRef<number>(-1);
  // True once the *current* section's manifest can never grow further (a
  // cache hit, or its render job reached a terminal state) — distinguishes
  // "ran off the end, nothing more is coming, advance" from "ran off the
  // end of what's rendered *so far*, wait for the next one" while a section
  // is still being synthesized (decisions.md: "listening starts in
  // seconds", not once the whole chapter has rendered).
  const sectionCompleteRef = useRef(false);
  // True while playback has caught up to the render and is waiting for the
  // *next* sentence to land — distinct from "loading" a fresh section, so
  // the job's progress callback knows when a nudge to resume is actually
  // needed vs. when a segment is already happily playing.
  const stalledRef = useRef(false);
  // Bumped every time a new segment's `audio.play()` is issued. A rapid
  // sentence skip (or the stall-resume nudge firing twice) can call
  // `audio.play()` again before the previous call's promise settles —
  // the browser then rejects the *earlier* one with an AbortError
  // ("interrupted by a new load request"), which is expected supersession,
  // not a real failure. Comparing against this token is how the handler
  // tells the two apart instead of flipping the whole player to "error"
  // every time a listener skips ahead. Confirmed live: 40 rapid
  // skip-sentence presses reproduced exactly this AbortError storm.
  const playTokenRef = useRef(0);
  // Invalidates in-flight async loads: skipping/starting elsewhere while a
  // render/manifest fetch is pending must not have the stale one clobber it
  // on arrival.
  const genRef = useRef(0);
  const unsubscribeJobRef = useRef<(() => void) | null>(null);
  const prefetchedRef = useRef<Set<number>>(new Set());
  const speedRef = useRef(initialSpeed);
  const spineIndicesRef = useRef(spineIndices);
  spineIndicesRef.current = spineIndices;

  // M21 fix (operator-reported: "break between sentences is sometimes too
  // long"). Every sentence is its own audio file (AUDIO.md's sentence-level
  // sync), so the browser has to actually fetch a new URL every time
  // `playCurrentSegment` advances — over a slow link (an SSH tunnel,
  // confirmed as this operator's setup) that network round trip *is* the
  // pause, not a rendering cost. These two maps let `playCurrentSegment`
  // kick off the *next* sentence's fetch the moment the *current* one
  // starts playing, so by the time playback needs it, it has had that
  // sentence's whole duration to land — `resolveSegmentSrc` then serves the
  // already-downloaded blob instead of making the reader wait on a fresh
  // request. Keyed by segment URL, not index, since the URL already
  // encodes resource/cast/section/sentence — content-addressed the same way
  // the on-disk cache is (AUDIO.md).
  const segmentBlobCacheRef = useRef<Map<string, string>>(new Map());
  const segmentBlobInFlightRef = useRef<Map<string, Promise<string | null>>>(new Map());
  // A generous cap, not a real LRU: sessions are overwhelmingly sequential
  // (one sentence ahead), so a handful of entries covers normal playback and
  // the occasional skip-back without the map growing for a whole book.
  const MAX_CACHED_SEGMENT_BLOBS = 6;

  useEffect(() => {
    speedRef.current = speed;
    if (audioElRef.current) audioElRef.current.playbackRate = speed;
  }, [speed]);

  const stopSubscription = useCallback(() => {
    unsubscribeJobRef.current?.();
    unsubscribeJobRef.current = null;
  }, []);

  function adjacentSpineIndex(from: number, direction: 1 | -1): number | null {
    const order = spineIndicesRef.current;
    const i = order.indexOf(from);
    const j = i + direction;
    return i >= 0 && j >= 0 && j < order.length ? order[j] : null;
  }

  /** Kicks off rendering `spineIndex` in the background without touching
   * playback state (AUDIO.md: "chapter-ahead, on demand" — render the
   * current section, keep one ahead warm). Fire-and-forget; a failure here
   * is silent — the real attempt happens when playback actually reaches
   * that section, and surfaces there instead. */
  const warmSection = useCallback(
    (spineIndex: number) => {
      if (prefetchedRef.current.has(spineIndex)) return;
      prefetchedRef.current.add(spineIndex);
      ensureSectionRendered(resourceId, spineIndex).then((result) => {
        if (!("jobId" in result)) return;
        const unsub = subscribeJobEvents(result.jobId, (job) => {
          if (job.status !== "running") unsub();
        });
      });
    },
    [resourceId],
  );

  function pruneSegmentBlobCache() {
    const cache = segmentBlobCacheRef.current;
    while (cache.size > MAX_CACHED_SEGMENT_BLOBS) {
      const oldestUrl = cache.keys().next().value;
      if (oldestUrl === undefined) break;
      const blobUrl = cache.get(oldestUrl);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      cache.delete(oldestUrl);
    }
  }

  function clearSegmentBlobCache() {
    for (const blobUrl of segmentBlobCacheRef.current.values()) URL.revokeObjectURL(blobUrl);
    segmentBlobCacheRef.current.clear();
    segmentBlobInFlightRef.current.clear();
  }

  /** Fire-and-forget: downloads `url` into a blob ahead of when playback
   * will actually need it. Never throws and is never retried on failure —
   * a miss here just means `resolveSegmentSrc` falls back to the plain
   * endpoint, exactly as if prefetching didn't exist (e.g. the next
   * sentence hasn't finished rendering yet when this fires). */
  const prefetchSegmentBlob = useCallback((url: string) => {
    const cache = segmentBlobCacheRef.current;
    const inFlight = segmentBlobInFlightRef.current;
    if (cache.has(url) || inFlight.has(url)) return;
    const promise = fetch(url)
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => (blob ? URL.createObjectURL(blob) : null))
      .catch(() => null);
    inFlight.set(url, promise);
    void promise.then((blobUrl) => {
      inFlight.delete(url);
      if (blobUrl) {
        cache.set(url, blobUrl);
        pruneSegmentBlobCache();
      }
    });
  }, []);

  /** The URL to actually assign to `audio.src` — a prefetched blob if one
   * landed or is on its way, otherwise the plain endpoint (the browser
   * fetches it itself, same as if prefetching didn't exist). */
  async function resolveSegmentSrc(url: string): Promise<string> {
    const cached = segmentBlobCacheRef.current.get(url);
    if (cached) return cached;
    const inFlight = segmentBlobInFlightRef.current.get(url);
    if (inFlight) {
      const blobUrl = await inFlight;
      if (blobUrl) return blobUrl;
    }
    return url;
  }

  // playCurrentSegmentRef / loadAndPlayRef: the two mutually call each other
  // (running off the end of a section's segments advances to the next
  // section; a freshly loaded section starts playing its first segment).
  // Refs, not useCallback, so neither closes over a stale sibling — same
  // idiom ReaderView.tsx uses for turnPageRef/chapterJumpRef.
  const playCurrentSegmentRef = useRef<() => void>(() => {});
  const loadAndPlayRef = useRef<(spineIndex: number, sentenceIndex: number) => void>(() => {});

  /** No sentences at all in this section (an image-only cover page, say) —
   * move straight on rather than stalling silently forever. */
  function advancePastEmptySection(spineIndex: number) {
    const next = adjacentSpineIndex(spineIndex, 1);
    if (next !== null) loadAndPlayRef.current(next, 0);
    else {
      setStatus("paused");
      setCurrentSegment(null);
    }
  }

  playCurrentSegmentRef.current = function playCurrentSegment() {
    const manifest = manifestRef.current;
    const spineIndex = spineIndexRef.current;
    const audio = audioElRef.current;
    if (!manifest || spineIndex === null || !audio) return;
    const segment = manifest.segments[segmentIndexRef.current];
    if (!segment) {
      if (!sectionCompleteRef.current) {
        // Rendering is still catching up to where playback wants to be —
        // stay "loading" and wait; the render job's own progress callback
        // (in loadAndPlay below) calls this again once more segments land.
        stalledRef.current = true;
        setStatus("loading");
        return;
      }
      const next = adjacentSpineIndex(spineIndex, 1);
      if (next !== null) loadAndPlayRef.current(next, 0);
      else {
        setStatus("paused");
        setCurrentSegment(null);
      }
      return;
    }
    stalledRef.current = false;
    setCurrentSegment({
      spineIndex,
      charStart: segment.charStart,
      charEnd: segment.charEnd,
      text: segment.text,
    });

    // Kick off the *next* sentence's fetch now, while this one plays — see
    // the field comments above segmentBlobCacheRef for why.
    const nextSegment = manifest.segments[segmentIndexRef.current + 1];
    if (nextSegment) prefetchSegmentBlob(segmentAudioUrl(resourceId, spineIndex, nextSegment.n));

    const url = segmentAudioUrl(resourceId, spineIndex, segment.n);
    const token = ++playTokenRef.current;
    void resolveSegmentSrc(url).then((src) => {
      // Superseded before its own fetch even resolved (a rapid skip) —
      // whatever call replaced this one owns playback now.
      if (playTokenRef.current !== token) return;
      audio.src = src;
      audio.playbackRate = speedRef.current;
      audio
        .play()
        .then(() => {
          // A pause() that lands while this play() was still settling must
          // win — otherwise a late resolution flips "paused" back to
          // "playing" right after the listener stopped it.
          if (playTokenRef.current === token && !audio.paused) setStatus("playing");
        })
        .catch((err) => {
          // A newer segment already superseded this call — its own
          // play()/catch() owns the status now, not this stale one.
          if (playTokenRef.current !== token) return;
          if (err instanceof DOMException && err.name === "AbortError") return;
          setStatus("error");
        });
    });
  };

  loadAndPlayRef.current = function loadAndPlay(spineIndex: number, sentenceIndex: number) {
    const gen = ++genRef.current;
    stopSubscription();
    audioElRef.current?.pause();
    manifestRef.current = null;
    spineIndexRef.current = spineIndex;
    segmentIndexRef.current = sentenceIndex;
    sectionCompleteRef.current = false;
    setStatus("loading");
    setErrorCode(null);

    /** Pulls the latest on-disk manifest and, the first time enough of it
     * exists to reach `segmentIndexRef.current`, starts playback — without
     * waiting for the rest of the section to finish rendering. */
    async function refreshAndMaybePlay(started: boolean): Promise<boolean> {
      const manifest = await fetchSectionManifest(resourceId, spineIndex);
      if (gen !== genRef.current) return started;
      if (!manifest) return started;
      manifestRef.current = manifest;
      // A backward skip across a section boundary starts at "the last
      // sentence" (Number.MAX_SAFE_INTEGER, see skipSentence) — totalSegments
      // is known from the manifest's very first write, before any sentence
      // has actually rendered, so this clamp is safe even mid-render.
      segmentIndexRef.current = Math.min(segmentIndexRef.current, Math.max(manifest.totalSegments - 1, 0));
      if (!started && manifest.segments[segmentIndexRef.current]) {
        playCurrentSegmentRef.current();
        return true;
      }
      return started;
    }

    async function run() {
      const result = await ensureSectionRendered(resourceId, spineIndex);
      if (gen !== genRef.current) return;
      if ("error" in result) {
        setStatus("error");
        setErrorCode(result.error);
        return;
      }

      if ("cached" in result) {
        const started = await refreshAndMaybePlay(false);
        if (gen !== genRef.current) return;
        sectionCompleteRef.current = true;
        if (!started) {
          if (manifestRef.current && manifestRef.current.totalSegments === 0) advancePastEmptySection(spineIndex);
          else playCurrentSegmentRef.current(); // re-check now sectionCompleteRef is true
          return;
        }
        const next = adjacentSpineIndex(spineIndex, 1);
        if (next !== null) warmSection(next);
        return;
      }

      // A job is doing the rendering — race playback against it, starting
      // the instant sentence `sentenceIndex` itself is ready rather than
      // waiting for the whole section (decisions.md: "listening starts in
      // seconds").
      let started = false;
      const unsub = subscribeJobEvents(result.jobId, (job) => {
        void (async () => {
          started = await refreshAndMaybePlay(started);
          if (gen !== genRef.current) return;
          // Playback caught up to the render and is waiting on the next
          // sentence — every progress tick is a chance for it to actually
          // exist now. Never fires while a segment is already sounding.
          if (started && stalledRef.current) playCurrentSegmentRef.current();
          if (job.status !== "running") {
            unsub();
            if (unsubscribeJobRef.current === unsub) unsubscribeJobRef.current = null;
            sectionCompleteRef.current = true;
            if (!started) {
              if (job.status === "completed") advancePastEmptySection(spineIndex);
              else if (job.status === "cancelled") {
                // M22.5 G: a render job is cancelled when its section's audio
                // is deleted out from under it — that is "not rendered", not
                // a failure. Settling here as idle (rather than "error")
                // means starting listening again re-runs ensureSectionRendered
                // and simply re-renders, instead of surfacing a scary error
                // for what the delete route did on purpose.
                setStatus("idle");
                setErrorCode(null);
                setCurrentSegment(null);
              } else {
                setStatus("error");
                setErrorCode(job.error ?? "audio_render_failed");
              }
            } else {
              // One last nudge in case playback was waiting on "more to
              // come" right as the job finished (sectionCompleteRef just
              // flipped true above, so this time it correctly advances
              // instead of waiting forever).
              if (stalledRef.current) playCurrentSegmentRef.current();
              const next = adjacentSpineIndex(spineIndex, 1);
              if (next !== null) warmSection(next);
            }
          }
        })();
      });
      unsubscribeJobRef.current = unsub;
    }
    void run();
  };

  useEffect(() => {
    const audio = audioElRef.current;
    if (!audio) return;
    function handleEnded() {
      segmentIndexRef.current += 1;
      playCurrentSegmentRef.current();
    }
    audio.addEventListener("ended", handleEnded);
    return () => audio.removeEventListener("ended", handleEnded);
  }, []);

  useEffect(
    () => () => {
      stopSubscription();
      audioElRef.current?.pause();
      clearSegmentBlobCache();
    },
    [stopSubscription],
  );

  const startListening = useCallback((spineIndex: number) => {
    loadAndPlayRef.current(spineIndex, 0);
  }, []);

  const playFrom = useCallback((spineIndex: number, sentenceIndex: number) => {
    loadAndPlayRef.current(spineIndex, sentenceIndex);
  }, []);

  const pause = useCallback(() => {
    audioElRef.current?.pause();
    setStatus((s) => (s === "playing" || s === "loading" ? "paused" : s));
  }, []);

  const resume = useCallback(() => {
    if (!manifestRef.current) return;
    if (segmentIndexRef.current < 0) {
      playCurrentSegmentRef.current();
      return;
    }
    const token = ++playTokenRef.current;
    const audio = audioElRef.current;
    audio
      ?.play()
      .then(() => {
        if (playTokenRef.current === token && audio && !audio.paused) setStatus("playing");
      })
      .catch((err) => {
        if (playTokenRef.current !== token) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setStatus("error");
      });
  }, []);

  const toggle = useCallback(() => {
    if (status === "playing" || status === "loading") pause();
    else resume();
  }, [status, pause, resume]);

  const skipSentence = useCallback((direction: 1 | -1) => {
    if (!manifestRef.current) return;
    segmentIndexRef.current += direction;
    if (segmentIndexRef.current < 0) {
      const prevIdx = spineIndexRef.current !== null ? adjacentSpineIndex(spineIndexRef.current, -1) : null;
      if (prevIdx !== null) loadAndPlayRef.current(prevIdx, Number.MAX_SAFE_INTEGER);
      else segmentIndexRef.current = 0;
      return;
    }
    playCurrentSegmentRef.current();
  }, []);

  const skipChapter = useCallback((direction: 1 | -1) => {
    if (spineIndexRef.current === null) return;
    const target = adjacentSpineIndex(spineIndexRef.current, direction);
    if (target !== null) loadAndPlayRef.current(target, 0);
  }, []);

  const setSpeed = useCallback((n: number) => {
    setSpeedState(n);
  }, []);

  const stop = useCallback(() => {
    genRef.current += 1;
    stopSubscription();
    audioElRef.current?.pause();
    manifestRef.current = null;
    spineIndexRef.current = null;
    segmentIndexRef.current = -1;
    clearSegmentBlobCache();
    setStatus("idle");
    setErrorCode(null);
    setCurrentSegment(null);
  }, [stopSubscription]);

  return {
    status,
    errorCode,
    currentSegment,
    speed,
    startListening,
    playFrom,
    pause,
    resume,
    toggle,
    skipSentence,
    skipChapter,
    setSpeed,
    stop,
  };
}
