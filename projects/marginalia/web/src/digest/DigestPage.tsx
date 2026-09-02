import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Link, useLocation, useNavigate, type Location } from "react-router-dom";
import type {
  AudioSectionsResponse,
  ChapterQuestion,
  DigestChapterStatus,
  DigestStatus,
  ScanBookTheme,
  ThematicStatus,
} from "@marginalia/shared";
import { Button } from "../controls/Button.js";
import { IconButton } from "../controls/IconButton.js";
import { Slider } from "../controls/Slider.js";
import { clampValue } from "../controls/sliderMath.js";
import { useOutsideClick } from "../controls/useOutsideClick.js";
import { captureOverlayOrigin, setPendingOverlayOrigin } from "../controls/overlayOrigin.js";
import { stepFindCursor } from "../search/findCursor.js";
import { SHORTCUT_KEYS } from "../shortcuts/keys.js";
import { useShortcuts } from "../shortcuts/useShortcuts.js";
import { useJobs } from "../jobs/JobsContext.js";
import { startJobRequest } from "../jobs/jobsApi.js";
import { deleteAllAudio, deleteSectionAudio, fetchAudioSections } from "../audio/audioApi.js";
import { themeRampColor } from "./themeRamp.js";
import { createChapterAnchor, fetchChapterQuestions, fetchThematicStatus, revealParams } from "./digestApi.js";
import { ChapterQuestionBox } from "./ChapterQuestionBox.js";
import styles from "./DigestPage.module.css";

/** M22.5 G: "N MB"/"N KB" for the rendered-audio column — no existing
 * formatter in the codebase to reuse. */
function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 KB";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * M29 (decisions.md 2026-08-22): distinguishes "the resource genuinely
 * doesn't exist" (404 — a stable, permanent state) from "the request failed"
 * (network error, timeout, 500 — worth a retry) so the caller can show a
 * retry affordance instead of leaving the page on an indefinite spinner with
 * no feedback either way.
 */
type DigestFetchResult = { ok: true; data: DigestStatus } | { ok: false; notFound: boolean };

async function fetchDigestStatus(
  resourceId: string,
  revealed: Set<number>,
  revealBook: boolean,
): Promise<DigestFetchResult> {
  try {
    const params = revealParams(revealed);
    if (revealBook) params.set("revealBook", "1");
    const qs = params.toString();
    const res = await fetch(`/api/resources/${resourceId}/digest${qs ? `?${qs}` : ""}`);
    if (res.status === 404) return { ok: false, notFound: true };
    if (!res.ok) return { ok: false, notFound: false };
    return { ok: true, data: (await res.json()) as DigestStatus };
  } catch {
    return { ok: false, notFound: false };
  }
}

async function fetchBookThemes(resourceId: string): Promise<ScanBookTheme[]> {
  try {
    const res = await fetch(`/api/resources/${resourceId}/theme-distillation`);
    if (!res.ok) return [];
    const body = (await res.json()) as { bookThemes: ScanBookTheme[] };
    return body.bookThemes;
  } catch {
    return [];
  }
}

async function saveBrief(resourceId: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/resources/${resourceId}/brief`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function formatRange(startPercent: number, lengthPercent: number): string {
  const from = Math.round(startPercent * 100);
  const to = Math.round((startPercent + lengthPercent) * 100);
  return `${from}–${to}%`;
}

/** "S<n> · title", falling back to the position range when there's no
 * title at all — the grid cell, the per-chapter header and the chapter
 * picker all want the same label (TASKS.md M20.5's "S<n> is the only
 * number that appears in any UI"). */
function chapterLabel(c: DigestChapterStatus): string {
  const range = `S${c.chapterNumber} · ${formatRange(c.startPercent, c.lengthPercent)}`;
  return c.tocTitle ? `S${c.chapterNumber} · ${c.tocTitle}` : range;
}

/**
 * The digest page: a landing view (Tools, reading brief, book-so-far, and a
 * chapter grid — M38 §A) in front of per-chapter pages, replacing the old
 * design where opening the Digest meant scrolling past every chapter card
 * already rendered. The plot and thematic layers still sit side by side per
 * chapter (decisions.md 2026-07-29 later — "two layers, two lifecycles"),
 * spoiler-safe throughout. Replaces the old read-only markdown projection
 * with a structured, interactive view — the markdown export (still
 * generated server-side for the vault/CLI) isn't the right shape for
 * per-item reveal controls or a clickable question.
 */
interface DigestPageProps {
  resourceId: string;
}

export function DigestPage({ resourceId: id }: DigestPageProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<DigestStatus | null>(null);
  const [thematic, setThematic] = useState<ThematicStatus | null>(null);
  const [notFound, setNotFound] = useState(false);
  // M29: set only on a genuine request failure (not a 404) when there's no
  // status to fall back on yet — distinct from `notFound`, which is
  // permanent, so this one offers a retry instead.
  const [loadError, setLoadError] = useState(false);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [revealBook, setRevealBook] = useState(false);
  const [briefDraft, setBriefDraft] = useState("");
  const [briefSaving, setBriefSaving] = useState(false);
  const [briefSaved, setBriefSaved] = useState(true);
  // M20.6: both the thematic re-run and the theme-tagging pass are jobs now
  // — the tray/toast own the actual progress and cancel UI; the ids tracked
  // here are only so this page knows when to refetch and show its own
  // (much smaller) success/failure note.
  const [thematicJobId, setThematicJobId] = useState<string | null>(null);
  const [thematicError, setThematicError] = useState<string | null>(null);
  // M38 §B2: the Analyse control's plot half — the range-scoped sibling of
  // the reading pane's single-chapter "Digest Plot" (ReaderView.tsx),
  // reusing the same `/digest` route DigestSpotlight already posts to.
  const [plotJobId, setPlotJobId] = useState<string | null>(null);
  const [plotError, setPlotError] = useState<string | null>(null);
  const [taggingJobId, setTaggingJobId] = useState<string | null>(null);
  const [taggingError, setTaggingError] = useState<string | null>(null);
  const [bookThemes, setBookThemes] = useState<ScanBookTheme[]>([]);
  const [distillJobId, setDistillJobId] = useState<string | null>(null);
  const [distillError, setDistillError] = useState<string | null>(null);
  // M35 §G1 (renamed M38 §B1 — the range now scopes both Plot and Themes,
  // not just the thematic re-read it started as): the Analyse range
  // picker's own indices, into `allChapters` below (every chapter in the
  // book — a thematic run has no dependency on a chapter's plot digest, so
  // the dials span the whole spine, not just the digested chapters).
  const [analyseStartIdx, setAnalyseStartIdx] = useState(0);
  const [analyseEndIdx, setAnalyseEndIdx] = useState(0);
  // M38 §B2: "Analyse" collapses "Re-read my notes"/"Re-read the book"
  // behind one button whose panel chooses scope (Plot and/or Themes) before
  // running, rather than two top-level buttons of unclear relationship.
  const [analyseOpen, setAnalyseOpen] = useState(false);
  const [analysePlotChecked, setAnalysePlotChecked] = useState(true);
  const [analyseThemesChecked, setAnalyseThemesChecked] = useState(true);
  const [analyseMode, setAnalyseMode] = useState<"notes" | "full">("notes");
  const analyseWrapRef = useRef<HTMLDivElement>(null);
  const [chapterQuestions, setChapterQuestions] = useState<ChapterQuestion[]>([]);
  const [audioSections, setAudioSections] = useState<AudioSectionsResponse | null>(null);
  const [deletingSpine, setDeletingSpine] = useState<number | null>(null);
  const [deletingAllAudio, setDeletingAllAudio] = useState(false);
  const { registerStarted, jobs, cancel: cancelJob } = useJobs();
  // M35 §F1: the chapter currently showing its themes' quotes. M38 §A
  // folded this together with "which chapter page is open" — see
  // `openChapter`/`handleStepExpanded` below — since only one chapter
  // renders at a time now, there's no longer a second chapter's card
  // sitting on screen for this to disagree with.
  const [expandedSpineIndex, setExpandedSpineIndex] = useState<number | null>(null);
  // M38 §A1: landing (Tools/brief/book-so-far/grid) vs. a single chapter's
  // own page — replaces the old always-scrolling chapter list.
  const [view, setView] = useState<"landing" | "chapter">("landing");
  const [focusedSpineIndex, setFocusedSpineIndex] = useState<number | null>(null);
  const [chapterPickerOpen, setChapterPickerOpen] = useState(false);
  const chapterPickerRef = useRef<HTMLDivElement>(null);
  // M38 §A1: "Book so far, clickable to open in full view" — the synopsis
  // can run long, so the landing page clamps it by default.
  const [synopsisExpanded, setSynopsisExpanded] = useState(false);

  function load() {
    if (!id) return;
    fetchDigestStatus(id, revealed, revealBook).then((result) => {
      if (result.ok) {
        setStatus(result.data);
        setLoadError(false);
      } else if (result.notFound) {
        setNotFound(true);
      } else {
        setLoadError(true);
      }
    });
    fetchThematicStatus(id, revealed).then((result) => {
      if (result) {
        setThematic(result);
        setBriefDraft((prev) => (prev === "" ? result.brief.text : prev));
      }
    });
    fetchBookThemes(id).then(setBookThemes);
    fetchChapterQuestions(id).then(setChapterQuestions);
  }

  function loadAudio() {
    if (!id) return;
    fetchAudioSections(id).then(setAudioSections);
  }

  useEffect(() => {
    if (!id) return;
    setStatus(null);
    setThematic(null);
    setNotFound(false);
    setLoadError(false);
    setRevealed(new Set());
    setRevealBook(false);
    setAudioSections(null);
    setBookThemes([]);
    setChapterQuestions([]);
    setExpandedSpineIndex(null);
    setView("landing");
    setFocusedSpineIndex(null);
    setChapterPickerOpen(false);
    setAnalyseOpen(false);
    setSynopsisExpanded(false);
    load();
    loadAudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!id) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed, revealBook]);

  // M22.5 G "rides the live tray stream from D": a chapter-ahead render
  // kicked off from the reader (or another tab) finishes with nobody on
  // this page having started it — this page only learns about it through
  // JobsContext's registry-wide stream, the same one the tray uses. Tracks
  // each audio-render job's last-seen status so a re-fetch fires once per
  // actual transition off "running", not on every progress tick.
  const audioJobStatusesRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    if (!id) return;
    let finishedOne = false;
    for (const job of jobs) {
      if (job.kind !== "audio-render" || job.resourceId !== id) continue;
      const prev = audioJobStatusesRef.current.get(job.id);
      if (prev === job.status) continue;
      audioJobStatusesRef.current.set(job.id, job.status);
      if (job.status !== "running") finishedOne = true;
    }
    if (finishedOne) loadAudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, id]);

  // M19.6 "`r` opens the reader" (decisions.md 2026-07-30 later): "the book
  // currently in focus" is unambiguous here — the book this digest is for —
  // so `r` is just a keyboard shortcut for the existing "Open book" link
  // below. Moved into the M19.7 shared registry (useShortcuts).
  useShortcuts([{ key: SHORTCUT_KEYS.reader, handler: () => id && navigate(`/read/${id}`) }]);

  function reveal(spineIndex: number) {
    setRevealed((prev) => new Set(prev).add(spineIndex));
  }

  async function handleSaveBrief() {
    if (!id) return;
    setBriefSaving(true);
    const ok = await saveBrief(id, briefDraft);
    setBriefSaving(false);
    setBriefSaved(ok);
    if (ok) load();
  }

  // Watches our own thematic/plot/theme-tagging/distillation job through to
  // completion — real cancellation and the running-work indicator live in
  // the tray now; this just decides when to refetch and clears the tracked
  // id.
  useEffect(() => {
    if (thematicJobId) {
      const job = jobs.find((j) => j.id === thematicJobId);
      if (job && job.status !== "running") {
        setThematicJobId(null);
        if (job.status === "failed") setThematicError(job.error ?? "thematic_digest_failed");
        load();
      }
    }
    if (plotJobId) {
      const job = jobs.find((j) => j.id === plotJobId);
      if (job && job.status !== "running") {
        setPlotJobId(null);
        if (job.status === "failed") setPlotError(job.error ?? "digest_failed");
        load();
      }
    }
    if (taggingJobId) {
      const job = jobs.find((j) => j.id === taggingJobId);
      if (job && job.status !== "running") {
        setTaggingJobId(null);
        if (job.status === "failed") setTaggingError(job.error ?? "theme_tagging_failed");
      }
    }
    if (distillJobId) {
      const job = jobs.find((j) => j.id === distillJobId);
      if (job && job.status !== "running") {
        setDistillJobId(null);
        if (job.status === "failed") setDistillError(job.error ?? "theme_distillation_failed");
        else if (id) fetchBookThemes(id).then(setBookThemes);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, thematicJobId, plotJobId, taggingJobId, distillJobId]);

  // M35 §G1, corrected after checking `thematicBuild.ts`: a thematic run
  // reads a chapter's own *raw* section text (`getResourceTextSections`),
  // never the plot digest — there is no server-side dependency on a chapter
  // having been plot-digested first. The dials span every chapter in the
  // book, not just the digested ones (an earlier version of this section
  // assumed the opposite and was wrong).
  const allChapters = status?.chapters ?? [];
  const analyseMaxIdx = Math.max(0, allChapters.length - 1);

  // M35 §G1: the range picker's own default — the full book, same as the
  // old hardcoded "everything digested" behaviour's spirit (analyze as much
  // as there is) but now over the whole spine — re-syncs whenever the
  // *count* of chapters changes (which in practice only happens once, right
  // after the book's own spine loads), not on every render. A manually
  // narrowed selection is scoped to the current visit, same as the plot
  // digest's own dials never promise to remember a choice.
  useEffect(() => {
    setAnalyseStartIdx(0);
    setAnalyseEndIdx(Math.max(0, allChapters.length - 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allChapters.length]);

  useOutsideClick(analyseWrapRef, () => setAnalyseOpen(false), analyseOpen);
  useOutsideClick(chapterPickerRef, () => setChapterPickerOpen(false), chapterPickerOpen);

  /** M38 §B1: "S<n> · title" while dragging or typed, in the slider's own
   * index space — the same label ChapterDial's sectionLabel showed, now
   * doubling as the drag dial's live popup per B1's acceptance. */
  function formatAnalyseChapter(idxValue: number): string {
    const c = allChapters[Math.round(clampValue(idxValue, 0, analyseMaxIdx))];
    return c ? chapterLabel(c) : "—";
  }

  /** M38 §B1: "a typeable section-number entry" — typed text is the
   * section number (`chapterNumber`, always 1-based and present), not the
   * raw array index, so it reads the same way S-numbers do everywhere else
   * in the app. */
  function parseAnalyseChapter(text: string): number | null {
    const n = Number.parseInt(text, 10);
    if (!Number.isFinite(n)) return null;
    const idx = allChapters.findIndex((c) => c.chapterNumber === n);
    return idx >= 0 ? idx : null;
  }

  // M37 §D1: "notes" (default) reads each chapter's substrate — cheap,
  // because it's already built; "full" re-reads the chapter's own text,
  // paying again what the very first analysis cost. Both post to the same
  // route; `mode` is the only thing that changes.
  async function handleAnalyzeThemes(mode: "notes" | "full") {
    if (!id || allChapters.length === 0 || thematicJobId) return;
    setThematicError(null);
    const spineStart = allChapters[analyseStartIdx]?.spineIndex ?? allChapters[0].spineIndex;
    const spineEnd = allChapters[analyseEndIdx]?.spineIndex ?? allChapters[allChapters.length - 1].spineIndex;
    const result = await startJobRequest(`/api/resources/${id}/thematic`, {
      spineStart: Math.min(spineStart, spineEnd),
      spineEnd: Math.max(spineStart, spineEnd),
      mode,
    });
    if ("jobId" in result) {
      setThematicJobId(result.jobId);
      registerStarted({ id: result.jobId, kind: "thematic", resourceId: id, resourceTitle: null });
    } else {
      setThematicError(result.error);
    }
  }

  /** M38 §B2: the Analyse panel's plot half — same range, the existing
   * `/digest` route DigestSpotlight (Scan) already posts to for a range
   * run, not a new endpoint. */
  async function handleAnalyzePlot() {
    if (!id || allChapters.length === 0 || plotJobId) return;
    setPlotError(null);
    const spineStart = allChapters[analyseStartIdx]?.spineIndex ?? allChapters[0].spineIndex;
    const spineEnd = allChapters[analyseEndIdx]?.spineIndex ?? allChapters[allChapters.length - 1].spineIndex;
    const result = await startJobRequest(`/api/resources/${id}/digest`, {
      spineStart: Math.min(spineStart, spineEnd),
      spineEnd: Math.max(spineStart, spineEnd),
    });
    if ("jobId" in result) {
      setPlotJobId(result.jobId);
      registerStarted({ id: result.jobId, kind: "digest", resourceId: id, resourceTitle: null });
    } else {
      setPlotError(result.error);
    }
  }

  /** M38 §B2: "one button with a clear choice of scope" — fires whichever
   * of Plot/Themes is checked over the shared range, then closes the panel.
   * Selecting Themes only, in "notes" mode, is exactly the old "Re-read my
   * notes" button (verify step's own acceptance bar). */
  function handleRunAnalyse() {
    if (analysePlotChecked) void handleAnalyzePlot();
    if (analyseThemesChecked) void handleAnalyzeThemes(analyseMode);
    setAnalyseOpen(false);
  }

  // M35 §G2: exposes the cancel every job already supports (the tasks tray's
  // own button calls the same `cancelJob`) right where the job was started,
  // instead of requiring a trip to the tray to stop one of these.
  function handleCancelThematic() {
    if (thematicJobId) cancelJob(thematicJobId);
  }
  function handleCancelPlot() {
    if (plotJobId) cancelJob(plotJobId);
  }
  function handleCancelTagging() {
    if (taggingJobId) cancelJob(taggingJobId);
  }
  function handleCancelDistill() {
    if (distillJobId) cancelJob(distillJobId);
  }

  // "Tag highlights" — the Mine layer's theme signal for the scan
  // (decisions.md 2026-07-29 later); previously had no UI trigger at all
  // (SPEC-GAP, NOTES.md). The digest page is where the thematic vocabulary
  // this tags against lives, so it's the natural place for the button.
  async function handleTagThemes() {
    if (!id || taggingJobId) return;
    setTaggingError(null);
    const result = await startJobRequest(`/api/resources/${id}/theme-tagging`, undefined);
    if ("jobId" in result) {
      setTaggingJobId(result.jobId);
      registerStarted({ id: result.jobId, kind: "theme-tagging", resourceId: id, resourceTitle: null });
    } else {
      setTaggingError(result.error);
    }
  }

  // "Consolidate themes" (M24.5, renamed from "Distil book-level themes" —
  // M38 §B3): folds the dozens of per-chapter theme strings under ~6-8
  // book-level ones. Same shape as handleTagThemes — a no-op the server
  // handles gracefully when there's nothing to consolidate from yet, so
  // there's no separate "vocabulary is empty" disabled state here either.
  async function handleDistillThemes() {
    if (!id || distillJobId) return;
    setDistillError(null);
    const result = await startJobRequest(`/api/resources/${id}/theme-distillation`, undefined);
    if ("jobId" in result) {
      setDistillJobId(result.jobId);
      registerStarted({ id: result.jobId, kind: "theme-distillation", resourceId: id, resourceTitle: null });
    } else {
      setDistillError(result.error);
    }
  }

  async function handleDeleteSectionAudio(spineIndex: number) {
    if (!id || deletingSpine !== null) return;
    setDeletingSpine(spineIndex);
    await deleteSectionAudio(id, spineIndex);
    setDeletingSpine(null);
    loadAudio();
  }

  async function handleDeleteAllAudio() {
    if (!id || deletingAllAudio) return;
    if (!window.confirm("Delete all rendered audio for this book? Playing a chapter again will re-render it.")) return;
    setDeletingAllAudio(true);
    await deleteAllAudio(id);
    setDeletingAllAudio(false);
    loadAudio();
  }

  async function handleQuestionClick(spineIndex: number, text: string, quote: string) {
    if (!id) return;
    const result = await createChapterAnchor(id, spineIndex, quote, text);
    if (!result) return;
    if (result.highlight) {
      navigate(`/read/${id}`, { state: { jumpToHighlightId: result.highlight.id, jumpToQuestion: text } });
      return;
    }
    // M35 §B2: the quote didn't locate — it landed as a chapter question
    // instead of a mis-anchored highlight, so reflect that here rather than
    // navigating to a highlight that was never created.
    if (result.chapterQuestion) handleChapterQuestionCreated(result.chapterQuestion);
  }

  /**
   * M35 §F2: "same jump path as E6" — the reader's find bar, with the
   * server-located exact substring (`routes/digest.ts`'s `buildThematicStatus`
   * already normalizes each theme's quotes the same way `themeZones.ts` does
   * for the Scan), never the chapter-anchor route: a theme's evidence quote
   * isn't a highlight and this click shouldn't create one.
   */
  function handleOpenThemeQuote(quote: string) {
    if (!id) return;
    navigate(`/read/${id}`, {
      state: { jumpToFindQuery: quote, jumpToFindHitIndex: 0, jumpToFindMatchMode: "substring" },
    });
  }

  function handleToggleExpand(spineIndex: number) {
    setExpandedSpineIndex((prev) => (prev === spineIndex ? null : spineIndex));
  }

  // M35 §F1: "`< >` traversal across chapters" — steps `expandedSpineIndex`
  // across every chapter that currently qualifies (analyzed *and*
  // revealed, §F3's spoiler gate), reusing `stepFindCursor` rather than a
  // second stepping rule (same precedent ThreadPanel's own `< >` anchor
  // traversal already set for §D4).
  //
  // M38 §A: each chapter is now its own page rather than a card in one
  // continuous scroll, so "next analyzed chapter" navigates the chapter
  // view itself (`view`/`focusedSpineIndex`) instead of scrolling a card
  // into view — same traversal order, a different kind of destination.
  function handleStepExpanded(analyzedSpineIndices: number[], direction: "next" | "prev") {
    if (analyzedSpineIndices.length === 0) return;
    const currentIndex = expandedSpineIndex === null ? -1 : analyzedSpineIndices.indexOf(expandedSpineIndex);
    const nextIndex = stepFindCursor(currentIndex, analyzedSpineIndices.length, direction);
    const nextSpineIndex = analyzedSpineIndices[nextIndex];
    setView("chapter");
    setFocusedSpineIndex(nextSpineIndex);
    setExpandedSpineIndex(nextSpineIndex);
    setChapterPickerOpen(false);
  }

  // M20.5 "the Digest becomes a popup too": swaps to the Scan instrument
  // over the *same* background room rather than stacking Digest-over-Scan
  // — Scan and Digest are peer instruments, not nested ones. Reuses the
  // background this Digest itself was opened with (falling back to this
  // own location for a direct/deep link, exactly like a fresh open would).
  function handleOpenScan(event: MouseEvent<HTMLElement>) {
    const background = (location.state as { background?: Location } | null)?.background ?? location;
    setPendingOverlayOrigin(captureOverlayOrigin(event.currentTarget));
    navigate(`/scan/${id}`, { state: { background } });
  }

  /** M38 §A3/§A4: opens a chapter's own page — resets the quotes panel
   * (only ever meaningful for whichever chapter is now open) and closes
   * the chapter picker if it was left open. */
  function openChapter(spineIndex: number) {
    setView("chapter");
    setFocusedSpineIndex(spineIndex);
    setExpandedSpineIndex(null);
    setChapterPickerOpen(false);
  }

  function backToGrid() {
    setView("landing");
    setFocusedSpineIndex(null);
    setChapterPickerOpen(false);
  }

  /** M38 §A4: "‹ › to step to the next/previous chapter" — steps across
   * every chapter in the book, not just analyzed ones (contrast
   * `handleStepExpanded`'s narrower quotes-traversal above). */
  function stepChapter(direction: "next" | "prev") {
    if (!status || focusedSpineIndex === null) return;
    const idx = status.chapters.findIndex((c) => c.spineIndex === focusedSpineIndex);
    if (idx < 0) return;
    const target = status.chapters[idx + (direction === "next" ? 1 : -1)];
    if (target) openChapter(target.spineIndex);
  }

  const thematicByIndex = new Map((thematic?.chapters ?? []).map((c) => [c.spineIndex, c]));
  const audioByIndex = new Map((audioSections?.sections ?? []).map((s) => [s.spineIndex, s]));
  const chapterQuestionByIndex = new Map(chapterQuestions.map((q) => [q.spineIndex, q]));
  // M35 §F1/§F3: the only chapters `< >` can land on — analyzed *and*
  // revealed, in spine order, matching exactly which cards render a
  // thematic block at all below.
  const analyzedSpineIndices = (status?.chapters ?? [])
    .filter((c) => (thematicByIndex.get(c.spineIndex)?.analyzed ?? false) && c.revealed)
    .map((c) => c.spineIndex);

  function handleChapterQuestionCreated(created: ChapterQuestion) {
    setChapterQuestions((prev) => [...prev.filter((q) => q.spineIndex !== created.spineIndex), created]);
  }

  /** M38 §A3: reuses the existing per-chapter card rendering rather than
   * rebuilding it — unchanged from the old always-scrolling list except
   * that it's now called for exactly one chapter at a time. */
  function renderChapterCard(c: DigestChapterStatus) {
    const t = thematicByIndex.get(c.spineIndex);
    const audio = audioByIndex.get(c.spineIndex);
    const displayTitle = c.title ?? c.tocTitle;
    const label = `S${c.chapterNumber} · ${formatRange(c.startPercent, c.lengthPercent)}`;
    return (
      <article className={styles.chapterCard}>
        <h3 className={styles.chapterTitle}>
          {displayTitle ?? label}
          {displayTitle && <span className={styles.chapterMeta}> — {label}</span>}
        </h3>

        {audio && (
          <div className={styles.audioRow}>
            <span className={audio.rendered ? styles.audioBadgeRendered : styles.audioBadge}>
              {audio.rendered ? `Rendered · ${formatBytes(audio.bytes)}` : "Not rendered"}
            </span>
            {audio.rendered && (
              <button
                type="button"
                className={styles.audioDeleteButton}
                onClick={() => handleDeleteSectionAudio(c.spineIndex)}
                disabled={deletingSpine === c.spineIndex}
              >
                {deletingSpine === c.spineIndex ? "Deleting…" : "Delete audio"}
              </button>
            )}
          </div>
        )}

        {!c.digested && <p className={styles.mutedNote}>Not yet digested.</p>}

        {c.digested && !c.revealed && (
          <Button variant="outline" size="sm" style={{ borderStyle: "dashed" }} onClick={() => reveal(c.spineIndex)}>
            Reveal (past your bookmark)
          </Button>
        )}

        {c.digested && c.revealed && (
          <>
            <p className={styles.chapterSummary}>{c.summary}</p>
            {c.themes.length > 0 && <p className={styles.themeRow}>Themes: {c.themes.join(", ")}</p>}
          </>
        )}

        {t?.analyzed && c.revealed && (
          <div className={styles.thematicBlock}>
            <div className={styles.thematicHeader}>
              <span className={styles.thematicLabel}>Thematic reading</span>
              {t.stale && <span className={styles.staleBadge}>Stale — brief has changed</span>}
              {t.themes.length > 0 && (
                <button
                  type="button"
                  className={styles.expandThemesButton}
                  aria-expanded={expandedSpineIndex === c.spineIndex}
                  onClick={() => handleToggleExpand(c.spineIndex)}
                >
                  {expandedSpineIndex === c.spineIndex ? "Hide quotes ▾" : "Show quotes ▸"}
                </button>
              )}
            </div>
            {t.briefText && <p className={styles.briefInForce}>Read through: "{t.briefText}"</p>}
            <p className={styles.chapterSummary}>{t.analysis}</p>
            {t.questions.length > 0 && (
              <div className={styles.questionRow}>
                {t.questions.map((q, i) => (
                  <button
                    key={i}
                    type="button"
                    className={styles.questionChip}
                    onClick={() => handleQuestionClick(c.spineIndex, q.text, q.quote)}
                  >
                    {q.text}
                  </button>
                ))}
              </div>
            )}

            {/* M35 §F1/§F2: the quotes behind "Show quotes" — one theme at
                a time, each quote clicking through to the reader via the
                same jump path §E6 uses for a Scan zone. */}
            {expandedSpineIndex === c.spineIndex && t.themes.length > 0 && (
              <div className={styles.themeQuotesSection}>
                {analyzedSpineIndices.length > 1 && (
                  <div className={styles.anchorStepper}>
                    <IconButton
                      icon="‹"
                      label="Previous analyzed chapter"
                      size="sm"
                      onClick={() => handleStepExpanded(analyzedSpineIndices, "prev")}
                    />
                    <span className={styles.anchorCount}>
                      {analyzedSpineIndices.indexOf(c.spineIndex) + 1} of {analyzedSpineIndices.length}
                    </span>
                    <IconButton
                      icon="›"
                      label="Next analyzed chapter"
                      size="sm"
                      onClick={() => handleStepExpanded(analyzedSpineIndices, "next")}
                    />
                  </div>
                )}
                {t.themes.map((theme) => (
                  <div key={theme.name} className={styles.themeQuoteGroup}>
                    <span className={styles.themeQuoteName}>{theme.name}</span>
                    <div className={styles.questionRow}>
                      {theme.quotes.map((quote, i) => (
                        <button
                          key={i}
                          type="button"
                          className={styles.questionChip}
                          onClick={() => handleOpenThemeQuote(quote)}
                        >
                          &ldquo;{quote}&rdquo;
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <ChapterQuestionBox
          resourceId={id}
          spineIndex={c.spineIndex}
          question={chapterQuestionByIndex.get(c.spineIndex) ?? null}
          onCreated={handleChapterQuestionCreated}
        />
      </article>
    );
  }

  /** M38 §A2: reuses `c.digested`/`t?.analyzed`/the audio lookup this page
   * already loads — no new query. Renders nothing for a chapter past the
   * bookmark: a checkmark is itself a spoiler-shaped signal ("something
   * happens here"), so an unrevealed cell shows no badges at all rather
   * than three "not done" badges that would at least leak "not a spoiler
   * yet". */
  function renderChapterBadges(c: DigestChapterStatus) {
    if (!c.revealed) return null;
    const analyzed = thematicByIndex.get(c.spineIndex)?.analyzed ?? false;
    const audioRendered = audioByIndex.get(c.spineIndex)?.rendered ?? false;
    return (
      <div className={styles.chapterCellBadges} aria-hidden="true">
        <span className={`${styles.chapterBadge} ${c.digested ? styles.chapterBadgeOn : ""}`} title="Plot digest">
          P
        </span>
        <span className={`${styles.chapterBadge} ${analyzed ? styles.chapterBadgeOn : ""}`} title="Thematic analysis">
          T
        </span>
        <span className={`${styles.chapterBadge} ${audioRendered ? styles.chapterBadgeOn : ""}`} title="Audio rendered">
          A
        </span>
      </div>
    );
  }

  const focusedChapter = focusedSpineIndex !== null ? (status?.chapters.find((c) => c.spineIndex === focusedSpineIndex) ?? null) : null;
  const focusedIdx = focusedSpineIndex !== null ? (status?.chapters.findIndex((c) => c.spineIndex === focusedSpineIndex) ?? -1) : -1;
  const hasPrevChapter = focusedIdx > 0;
  const hasNextChapter = focusedIdx >= 0 && !!status && focusedIdx < status.chapters.length - 1;

  const anyAnalyseRunning = plotJobId !== null || thematicJobId !== null;
  const runDisabled =
    (!analysePlotChecked && !analyseThemesChecked) ||
    (analysePlotChecked && plotJobId !== null) ||
    (analyseThemesChecked && thematicJobId !== null);

  return (
    <div className={`${styles.page} register-paper`}>
      <div className={styles.headerRow}>
        <button type="button" className={styles.backLink} onClick={handleOpenScan}>
          ← Scan
        </button>
        <Link to={`/read/${id}`} className={styles.backLink}>
          Open book
        </Link>
      </div>

      {notFound && <p>Couldn't load the digest for this book.</p>}
      {!notFound && loadError && status === null && (
        <div className={styles.loading}>
          Couldn't load the digest right now.{" "}
          <Button variant="outline" size="sm" onClick={load}>
            Retry
          </Button>
        </div>
      )}
      {!notFound && !loadError && status === null && <div className={styles.loading}>Loading digest…</div>}

      {status !== null && view === "chapter" && focusedChapter && (
        <div className={styles.chapterView}>
          <button type="button" className={styles.backToGridLink} onClick={backToGrid}>
            ← All chapters
          </button>
          <div className={styles.chapterStepper}>
            <IconButton
              icon="‹"
              label="Previous chapter"
              size="sm"
              disabled={!hasPrevChapter}
              onClick={() => stepChapter("prev")}
            />
            {/* M38 §A4: "a clickable chapter title that opens the same
                chapter selector/navigator the reading pane already uses" —
                the reader's own `ChapterNav` is built on the epub.js
                rendition it navigates (`entry.href`/`.display()`), which
                this page never loads (it works off the digest's own status
                JSON, not the live book). This reproduces its look and
                click-to-jump behaviour over `status.chapters` instead of
                pulling epub.js into a status page to share the literal
                component — flagged here for the morning review rather than
                decided quietly. */}
            <div className={styles.chapterPickerWrap} ref={chapterPickerRef}>
              <button
                type="button"
                className={styles.chapterTitleButton}
                aria-haspopup="listbox"
                aria-expanded={chapterPickerOpen}
                onClick={() => setChapterPickerOpen((prev) => !prev)}
              >
                {chapterLabel(focusedChapter)}
              </button>
              {chapterPickerOpen && (
                <div className={styles.chapterPickerPanel} role="listbox" aria-label="Jump to chapter">
                  {status.chapters.map((c) => (
                    <button
                      key={c.spineIndex}
                      type="button"
                      role="option"
                      aria-selected={c.spineIndex === focusedSpineIndex}
                      className={`${styles.chapterPickerEntry} ${
                        c.spineIndex === focusedSpineIndex ? styles.chapterPickerEntryActive : ""
                      }`}
                      onClick={() => openChapter(c.spineIndex)}
                    >
                      {chapterLabel(c)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <IconButton
              icon="›"
              label="Next chapter"
              size="sm"
              disabled={!hasNextChapter}
              onClick={() => stepChapter("next")}
            />
          </div>
          {renderChapterCard(focusedChapter)}
        </div>
      )}

      {status !== null && view === "landing" && (
        <>
          <section className={styles.toolsSection}>
            <h2 className={styles.toolsHeading}>Tools</h2>
            {/* M38 §B1: one horizontal Slider (the same control the
                reader's own reading-progress dial uses), replacing the
                vertical ChapterDial FROM/TO pair — a live popup shows the
                chapter title while dragging, and clicking either readout
                opens a typeable section-number entry. Hidden below two
                chapters, where a range has nothing to narrow. */}
            {allChapters.length > 1 && (
              <div className={styles.rangeRow}>
                <div className={styles.rangeItem}>
                  <span className={styles.rangeLabel}>From</span>
                  <Slider
                    value={analyseStartIdx}
                    min={0}
                    max={analyseMaxIdx}
                    step={1}
                    dragPxPerUnit={32}
                    keyboardStep={1}
                    ariaLabel="Analyse range: from chapter"
                    formatValue={formatAnalyseChapter}
                    parseValue={parseAnalyseChapter}
                    onCommit={(v) => setAnalyseStartIdx(Math.round(v))}
                    disabled={anyAnalyseRunning}
                  />
                </div>
                <div className={styles.rangeItem}>
                  <span className={styles.rangeLabel}>To</span>
                  <Slider
                    value={analyseEndIdx}
                    min={0}
                    max={analyseMaxIdx}
                    step={1}
                    dragPxPerUnit={32}
                    keyboardStep={1}
                    ariaLabel="Analyse range: to chapter"
                    formatValue={formatAnalyseChapter}
                    parseValue={parseAnalyseChapter}
                    onCommit={(v) => setAnalyseEndIdx(Math.round(v))}
                    disabled={anyAnalyseRunning}
                  />
                </div>
              </div>
            )}

            <div className={styles.toolsFooter}>
              {/* M38 §B2: one Analyse button, a submenu chooses Plot
                  and/or Themes (Themes offering the existing fast-vs-full
                  choice inline) rather than two top-level buttons of
                  unclear relationship. */}
              <div className={styles.analyseWrap} ref={analyseWrapRef}>
                <Button
                  variant="outline"
                  size="sm"
                  aria-haspopup="true"
                  aria-expanded={analyseOpen}
                  onClick={() => setAnalyseOpen((prev) => !prev)}
                  disabled={allChapters.length === 0}
                >
                  {anyAnalyseRunning ? "Analysing…" : "Analyse"}
                </Button>
                {analyseOpen && (
                  <div className={styles.analysePanel}>
                    <label className={styles.analyseOption}>
                      <input
                        type="checkbox"
                        checked={analysePlotChecked}
                        onChange={(e) => setAnalysePlotChecked(e.target.checked)}
                      />
                      Plot
                    </label>
                    <label className={styles.analyseOption}>
                      <input
                        type="checkbox"
                        checked={analyseThemesChecked}
                        onChange={(e) => setAnalyseThemesChecked(e.target.checked)}
                      />
                      Themes
                    </label>
                    {analyseThemesChecked && (
                      <>
                        <div className={styles.analyseModeRow}>
                          <label className={styles.analyseModeOption}>
                            <input
                              type="radio"
                              name="analyse-mode"
                              checked={analyseMode === "notes"}
                              onChange={() => setAnalyseMode("notes")}
                            />
                            Fast — re-read my notes
                          </label>
                          <label className={styles.analyseModeOption}>
                            <input
                              type="radio"
                              name="analyse-mode"
                              checked={analyseMode === "full"}
                              onChange={() => setAnalyseMode("full")}
                            />
                            Full — re-read the book
                          </label>
                        </div>
                        {/* M37 §D2: said plainly, not left as a tooltip
                            only — a brief-blind substrate can't know which
                            passage a future brief will need. */}
                        <p className={styles.analyseHint}>
                          Fast reads each chapter's saved notes — cheap, but can miss a passage
                          your brief never made it into. Full re-reads the chapter text and
                          costs what the very first analysis did, folding anything new back into
                          your notes.
                        </p>
                      </>
                    )}
                    <div className={styles.analyseActions}>
                      <Button variant="solid" size="sm" onClick={handleRunAnalyse} disabled={runDisabled}>
                        Run
                      </Button>
                      {plotJobId && (
                        <Button variant="outline" size="sm" onClick={handleCancelPlot}>
                          Cancel plot
                        </Button>
                      )}
                      {thematicJobId && (
                        <Button variant="outline" size="sm" onClick={handleCancelThematic}>
                          Cancel themes
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={handleTagThemes} disabled={taggingJobId !== null}>
                {taggingJobId ? "Tagging…" : "Tag highlights with themes"}
              </Button>
              {taggingJobId && (
                <Button variant="outline" size="sm" onClick={handleCancelTagging}>
                  Cancel
                </Button>
              )}
              {/* M38 §B3: renamed from "Distil book-level themes" — reads as
                  a distinct second step over Analyse's output, not a fourth
                  unrelated button. Confirmed not redundant with per-chapter
                  analysis: it folds per-chapter themes into book-level
                  canonical themes across chapters analyzed at different
                  times. */}
              <Button variant="outline" size="sm" onClick={handleDistillThemes} disabled={distillJobId !== null}>
                {distillJobId ? "Consolidating…" : "Consolidate themes"}
              </Button>
              {distillJobId && (
                <Button variant="outline" size="sm" onClick={handleCancelDistill}>
                  Cancel
                </Button>
              )}
            </div>
            {plotError && <p className={styles.pausedNotice}>Plot digest failed: {plotError}</p>}
            {thematicError && <p className={styles.pausedNotice}>Thematic analysis failed: {thematicError}</p>}
            {taggingError && <p className={styles.pausedNotice}>Theme tagging failed: {taggingError}</p>}
            {distillError && <p className={styles.pausedNotice}>Theme consolidation failed: {distillError}</p>}
            {bookThemes.length > 0 && (
              <ul className={styles.bookThemeLegend} aria-label="Book-level themes">
                {bookThemes.map((theme) => (
                  <li key={theme.id} className={styles.bookThemeChip}>
                    <span
                      className={styles.bookThemeSwatch}
                      style={{ backgroundColor: themeRampColor(theme.colorIndex) }}
                      aria-hidden="true"
                    />
                    {theme.name}
                    <span className={styles.bookThemeCount}>{theme.children.length}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.briefSection}>
            <label className={styles.briefLabel} htmlFor="brief-textarea">
              Your reading brief
            </label>
            <p className={styles.briefHint}>
              A standing angle for this book — questions, perspectives, or interests you want
              held in mind while it's analysed ("read this for what it says about
              self-determination"). Set it before digesting ahead of your bookmark.
            </p>
            <textarea
              id="brief-textarea"
              className={styles.briefTextarea}
              value={briefDraft}
              onChange={(e) => {
                setBriefDraft(e.target.value);
                setBriefSaved(false);
              }}
              placeholder="No brief set — thematic analysis will read the book on its own terms."
            />
            <div className={styles.briefFooter}>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSaveBrief}
                disabled={briefSaving || briefSaved}
                title={
                  briefSaving
                    ? "Saving your reading brief…"
                    : briefSaved
                      ? "Your reading brief is saved — future analysis reads through it."
                      : "Save your reading brief so analysis reads through it."
                }
              >
                {briefSaving ? "Saving…" : briefSaved ? "Saved" : "Save brief"}
              </Button>
            </div>
          </section>

          {status.book && (status.book.safe || status.book.full) && (
            <section className={styles.bookSection}>
              <h2 className={styles.bookHeading}>The book so far</h2>
              <p
                className={synopsisExpanded ? styles.synopsis : `${styles.synopsis} ${styles.synopsisClamped}`}
                role="button"
                tabIndex={0}
                onClick={() => setSynopsisExpanded((prev) => !prev)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSynopsisExpanded((prev) => !prev);
                  }
                }}
                title={synopsisExpanded ? "Click to collapse" : "Click to open in full view"}
              >
                {(revealBook ? status.book.full : status.book.safe)?.synopsis}
              </p>
              {status.book.hasMoreToReveal && !revealBook && (
                <Button variant="outline" size="sm" style={{ borderStyle: "dashed" }} onClick={() => setRevealBook(true)}>
                  Reveal full synopsis (includes chapters past your bookmark)
                </Button>
              )}
            </section>
          )}

          {audioSections && audioSections.sections.length > 0 && (
            <section className={styles.audioSummary}>
              <span className={styles.audioSummaryText}>
                {audioSections.totalBytes > 0
                  ? `Audio rendered: ${formatBytes(audioSections.totalBytes)} across ${
                      audioSections.sections.filter((s) => s.rendered).length
                    } of ${audioSections.sections.length} sections`
                  : "No audio rendered yet"}
              </span>
              {audioSections.totalBytes > 0 && (
                <Button variant="outline" size="sm" onClick={handleDeleteAllAudio} disabled={deletingAllAudio}>
                  {deletingAllAudio ? "Deleting…" : "Delete all audio"}
                </Button>
              )}
            </section>
          )}

          <section className={styles.gridSection}>
            <h2 className={styles.gridHeading}>Chapters</h2>
            <div className={styles.chapterGrid}>
              {status.chapters.map((c) => (
                <button
                  key={c.spineIndex}
                  type="button"
                  className={styles.chapterCell}
                  onClick={() => openChapter(c.spineIndex)}
                >
                  <span className={styles.chapterCellNumber}>S{c.chapterNumber}</span>
                  <span className={styles.chapterCellName}>
                    {c.tocTitle ?? formatRange(c.startPercent, c.lengthPercent)}
                  </span>
                  {renderChapterBadges(c)}
                </button>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
