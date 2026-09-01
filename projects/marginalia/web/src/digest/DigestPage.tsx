import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Link, useLocation, useNavigate, type Location } from "react-router-dom";
import type {
  AudioSectionsResponse,
  ChapterQuestion,
  DigestStatus,
  ScanBookTheme,
  ThematicStatus,
} from "@marginalia/shared";
import { Button } from "../controls/Button.js";
import { IconButton } from "../controls/IconButton.js";
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
import { ChapterDial } from "../scan/ChapterDial.js";
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

/**
 * The digest page: the plot and thematic layers, side by side per chapter
 * (decisions.md 2026-07-29 later — "two layers, two lifecycles"), a reader
 * brief editor, and spoiler-safe display throughout. Replaces the old
 * read-only markdown projection with a structured, interactive view — the
 * markdown export (still generated server-side for the vault/CLI) isn't
 * the right shape for per-item reveal controls or a clickable question.
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
  const [taggingJobId, setTaggingJobId] = useState<string | null>(null);
  const [taggingError, setTaggingError] = useState<string | null>(null);
  const [bookThemes, setBookThemes] = useState<ScanBookTheme[]>([]);
  const [distillJobId, setDistillJobId] = useState<string | null>(null);
  const [distillError, setDistillError] = useState<string | null>(null);
  // M35 §G1: the thematic range picker's own indices, into `allChapters`
  // below (every chapter in the book — a thematic run has no dependency on
  // a chapter's plot digest, so there's nothing to bound this to).
  const [thematicStartIdx, setThematicStartIdx] = useState(0);
  const [thematicEndIdx, setThematicEndIdx] = useState(0);
  const [chapterQuestions, setChapterQuestions] = useState<ChapterQuestion[]>([]);
  const [audioSections, setAudioSections] = useState<AudioSectionsResponse | null>(null);
  const [deletingSpine, setDeletingSpine] = useState<number | null>(null);
  const [deletingAllAudio, setDeletingAllAudio] = useState(false);
  const { registerStarted, jobs, cancel: cancelJob } = useJobs();
  // M35 §F1: the chapter currently showing its themes' quotes — one at a
  // time, stepped with `< >` across every analyzed-and-revealed chapter
  // (§F3), the same "expand" scope decisions.md's own analysis/questions
  // block never had before this milestone.
  const [expandedSpineIndex, setExpandedSpineIndex] = useState<number | null>(null);
  const chapterRefs = useRef<Map<number, HTMLElement>>(new Map());

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

  // Watches our own thematic/theme-tagging job through to completion —
  // real cancellation and the running-work indicator live in the tray now;
  // this just decides when to refetch and clears the tracked id.
  useEffect(() => {
    if (thematicJobId) {
      const job = jobs.find((j) => j.id === thematicJobId);
      if (job && job.status !== "running") {
        setThematicJobId(null);
        if (job.status === "failed") setThematicError(job.error ?? "thematic_digest_failed");
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
  }, [jobs, thematicJobId, taggingJobId, distillJobId]);

  // M35 §G1, corrected after checking `thematicBuild.ts`: a thematic run
  // reads a chapter's own *raw* section text (`getResourceTextSections`),
  // never the plot digest — there is no server-side dependency on a chapter
  // having been plot-digested first. The dials span every chapter in the
  // book, not just the digested ones (an earlier version of this section
  // assumed the opposite and was wrong).
  const allChapters = status?.chapters ?? [];

  // M35 §G1: the range picker's own default — the full book, same as the
  // old hardcoded "everything digested" behaviour's spirit (analyze as much
  // as there is) but now over the whole spine — re-syncs whenever the
  // *count* of chapters changes (which in practice only happens once, right
  // after the book's own spine loads), not on every render. A manually
  // narrowed selection is scoped to the current visit, same as the plot
  // digest's own dials never promise to remember a choice.
  useEffect(() => {
    setThematicStartIdx(0);
    setThematicEndIdx(Math.max(0, allChapters.length - 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allChapters.length]);

  // M37 §D1: "notes" (default) reads each chapter's substrate — cheap,
  // because it's already built; "full" re-reads the chapter's own text,
  // paying again what the very first analysis cost. Both post to the same
  // route; `mode` is the only thing that changes.
  async function handleAnalyzeThemes(mode: "notes" | "full") {
    if (!id || allChapters.length === 0 || thematicJobId) return;
    setThematicError(null);
    const spineStart = allChapters[thematicStartIdx]?.spineIndex ?? allChapters[0].spineIndex;
    const spineEnd = allChapters[thematicEndIdx]?.spineIndex ?? allChapters[allChapters.length - 1].spineIndex;
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

  // M35 §G2: exposes the cancel every job already supports (the tasks tray's
  // own button calls the same `cancelJob`) right where the job was started,
  // instead of requiring a trip to the tray to stop one of these three.
  function handleCancelThematic() {
    if (thematicJobId) cancelJob(thematicJobId);
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

  // "Distil book-level themes" (M24.5): folds the dozens of per-chapter
  // theme strings under ~6-8 book-level ones. Same shape as handleTagThemes
  // — a no-op the server handles gracefully when there's nothing to distil
  // from yet, so there's no separate "vocabulary is empty" disabled state
  // here either.
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
  // across every chapter that currently qualifies (analyzed *and* revealed,
  // §F3's spoiler gate), reusing `stepFindCursor` rather than a second
  // stepping rule (same precedent ThreadPanel's own `< >` anchor traversal
  // already set for §D4). Scrolls the newly-expanded card into view — a
  // stepper that moves state nobody can see isn't really a stepper.
  function handleStepExpanded(analyzedSpineIndices: number[], direction: "next" | "prev") {
    if (analyzedSpineIndices.length === 0) return;
    const currentIndex = expandedSpineIndex === null ? -1 : analyzedSpineIndices.indexOf(expandedSpineIndex);
    const nextIndex = stepFindCursor(currentIndex, analyzedSpineIndices.length, direction);
    const nextSpineIndex = analyzedSpineIndices[nextIndex];
    setExpandedSpineIndex(nextSpineIndex);
    chapterRefs.current.get(nextSpineIndex)?.scrollIntoView({ behavior: "smooth", block: "center" });
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

      {status !== null && (
        <>
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
            {/* M35 §G1: the same From/To dials the plot digest already uses
                (ChapterDial, M20.5) — spanning the whole book, since a
                thematic run has no dependency on that chapter's plot digest.
                Hidden below two chapters, where a range has nothing to
                narrow. M37 §B: a "notes" run reads each chapter's own
                substrate rather than its raw section text; only a "full"
                re-read (§D1) still pays that original cost. */}
            {allChapters.length > 1 && (
              <div className={styles.thematicRangeRow}>
                <ChapterDial
                  label="From"
                  chapters={allChapters}
                  value={thematicStartIdx}
                  onCommit={setThematicStartIdx}
                  disabled={thematicJobId !== null}
                />
                <ChapterDial
                  label="To"
                  chapters={allChapters}
                  value={thematicEndIdx}
                  onCommit={setThematicEndIdx}
                  disabled={thematicJobId !== null}
                />
              </div>
            )}
            <div className={styles.briefFooter}>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSaveBrief}
                disabled={briefSaving || briefSaved}
              >
                {briefSaving ? "Saving…" : briefSaved ? "Saved" : "Save brief"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleAnalyzeThemes("notes")}
                disabled={thematicJobId !== null || allChapters.length === 0}
                title="Reads each chapter's saved substrate — cheap, but a brief-blind extract can miss a passage this brief would have wanted."
              >
                {thematicJobId ? "Analyzing…" : "Re-read my notes"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleAnalyzeThemes("full")}
                disabled={thematicJobId !== null || allChapters.length === 0}
                title="Re-reads the full chapter text for every chapter in range — costs what the very first analysis did, and folds anything new it finds back into your notes."
              >
                {thematicJobId ? "Analyzing…" : "Re-read the book"}
              </Button>
              {thematicJobId && (
                <Button variant="outline" size="sm" onClick={handleCancelThematic}>
                  Cancel
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={handleTagThemes} disabled={taggingJobId !== null}>
                {taggingJobId ? "Tagging…" : "Tag highlights with themes"}
              </Button>
              {taggingJobId && (
                <Button variant="outline" size="sm" onClick={handleCancelTagging}>
                  Cancel
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={handleDistillThemes} disabled={distillJobId !== null}>
                {distillJobId ? "Distilling…" : "Distil book-level themes"}
              </Button>
              {distillJobId && (
                <Button variant="outline" size="sm" onClick={handleCancelDistill}>
                  Cancel
                </Button>
              )}
            </div>
            {/* M37 §D2: said plainly, not left as a tooltip only — a
                brief-blind substrate can't know which passage a future
                brief will need, so "re-read my notes" is a real, visible
                tradeoff rather than a caveat to bury. */}
            <p className={styles.briefHint}>
              "Re-read my notes" is cheap and usually enough, but it can miss a passage your
              saved notes never kept — the notes were written before this brief existed.
              "Re-read the book" costs what the very first analysis did, and anything new it
              finds is folded back into your notes for next time.
            </p>
            {thematicError && <p className={styles.pausedNotice}>Thematic analysis failed: {thematicError}</p>}
            {taggingError && <p className={styles.pausedNotice}>Theme tagging failed: {taggingError}</p>}
            {distillError && <p className={styles.pausedNotice}>Theme distillation failed: {distillError}</p>}
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

          {status.book && (status.book.safe || status.book.full) && (
            <section className={styles.bookSection}>
              <h2 className={styles.bookHeading}>The book so far</h2>
              <p className={styles.synopsis}>{(revealBook ? status.book.full : status.book.safe)?.synopsis}</p>
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

          <div className={styles.chapterList}>
            {status.chapters.map((c) => {
              const t = thematicByIndex.get(c.spineIndex);
              const audio = audioByIndex.get(c.spineIndex);
              const chapterLabel = `S${c.chapterNumber} · ${formatRange(c.startPercent, c.lengthPercent)}`;
              // The digest's own title wins once it's revealed; otherwise
              // fall back to the book's own TOC name (never gated — see
              // `tocTitle`'s schema comment) rather than showing a bare
              // "S7" for a section that hasn't been digested yet but does
              // have a real chapter name.
              const displayTitle = c.title ?? c.tocTitle;
              return (
                <article
                  key={c.spineIndex}
                  className={styles.chapterCard}
                  ref={(el) => {
                    if (el) chapterRefs.current.set(c.spineIndex, el);
                    else chapterRefs.current.delete(c.spineIndex);
                  }}
                >
                  <h3 className={styles.chapterTitle}>
                    {displayTitle ?? chapterLabel}
                    {displayTitle && <span className={styles.chapterMeta}> — {chapterLabel}</span>}
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
                      {c.themes.length > 0 && (
                        <p className={styles.themeRow}>Themes: {c.themes.join(", ")}</p>
                      )}
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
                      {t.briefText && (
                        <p className={styles.briefInForce}>Read through: "{t.briefText}"</p>
                      )}
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

                      {/* M35 §F1/§F2: the quotes behind "Show quotes" — one
                          theme at a time, each quote clicking through to the
                          reader via the same jump path §E6 uses for a Scan
                          zone. */}
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
            })}
          </div>
        </>
      )}
    </div>
  );
}
