import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Link, useLocation, useNavigate, type Location } from "react-router-dom";
import type { AudioSectionsResponse, DigestStatus, ScanBookTheme, ThematicStatus } from "@marginalia/shared";
import { Button } from "../controls/Button.js";
import { captureOverlayOrigin, setPendingOverlayOrigin } from "../controls/overlayOrigin.js";
import { SHORTCUT_KEYS } from "../shortcuts/keys.js";
import { useShortcuts } from "../shortcuts/useShortcuts.js";
import { useJobs } from "../jobs/JobsContext.js";
import { startJobRequest } from "../jobs/jobsApi.js";
import { deleteAllAudio, deleteSectionAudio, fetchAudioSections } from "../audio/audioApi.js";
import { themeRampColor } from "./themeRamp.js";
import styles from "./DigestPage.module.css";

/** M22.5 G: "N MB"/"N KB" for the rendered-audio column — no existing
 * formatter in the codebase to reuse. */
function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 KB";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function revealParams(revealed: Set<number>): URLSearchParams {
  const params = new URLSearchParams();
  if (revealed.size > 0) params.set("reveal", [...revealed].join(","));
  return params;
}

async function fetchDigestStatus(
  resourceId: string,
  revealed: Set<number>,
  revealBook: boolean,
): Promise<DigestStatus | null> {
  try {
    const params = revealParams(revealed);
    if (revealBook) params.set("revealBook", "1");
    const qs = params.toString();
    const res = await fetch(`/api/resources/${resourceId}/digest${qs ? `?${qs}` : ""}`);
    if (!res.ok) return null;
    return (await res.json()) as DigestStatus;
  } catch {
    return null;
  }
}

async function fetchThematicStatus(resourceId: string, revealed: Set<number>): Promise<ThematicStatus | null> {
  try {
    const qs = revealParams(revealed).toString();
    const res = await fetch(`/api/resources/${resourceId}/thematic${qs ? `?${qs}` : ""}`);
    if (!res.ok) return null;
    return (await res.json()) as ThematicStatus;
  } catch {
    return null;
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

async function createChapterAnchor(
  resourceId: string,
  spineIndex: number,
  quote: string,
): Promise<{ id: string } | null> {
  try {
    const res = await fetch(`/api/resources/${resourceId}/chapter-anchor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spineIndex, quote }),
    });
    if (!res.ok) return null;
    return (await res.json()) as { id: string };
  } catch {
    return null;
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
  const [audioSections, setAudioSections] = useState<AudioSectionsResponse | null>(null);
  const [deletingSpine, setDeletingSpine] = useState<number | null>(null);
  const [deletingAllAudio, setDeletingAllAudio] = useState(false);
  const { registerStarted, jobs } = useJobs();

  function load() {
    if (!id) return;
    fetchDigestStatus(id, revealed, revealBook).then((result) => {
      if (result === null) setNotFound(true);
      else setStatus(result);
    });
    fetchThematicStatus(id, revealed).then((result) => {
      if (result) {
        setThematic(result);
        setBriefDraft((prev) => (prev === "" ? result.brief.text : prev));
      }
    });
    fetchBookThemes(id).then(setBookThemes);
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
    setRevealed(new Set());
    setRevealBook(false);
    setAudioSections(null);
    setBookThemes([]);
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

  async function handleAnalyzeThemes() {
    if (!id || !status || thematicJobId) return;
    const digestedChapters = status.chapters.filter((c) => c.digested);
    if (digestedChapters.length === 0) return;
    setThematicError(null);
    const spineStart = digestedChapters[0].spineIndex;
    const spineEnd = digestedChapters[digestedChapters.length - 1].spineIndex;
    const result = await startJobRequest(`/api/resources/${id}/thematic`, { spineStart, spineEnd });
    if ("jobId" in result) {
      setThematicJobId(result.jobId);
      registerStarted({ id: result.jobId, kind: "thematic", resourceId: id, resourceTitle: null });
    } else {
      setThematicError(result.error);
    }
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
    const highlight = await createChapterAnchor(id, spineIndex, quote);
    if (!highlight) return;
    navigate(`/read/${id}`, { state: { jumpToHighlightId: highlight.id, jumpToQuestion: text } });
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
      {!notFound && status === null && <div className={styles.loading}>Loading digest…</div>}

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
                onClick={handleAnalyzeThemes}
                disabled={thematicJobId !== null || !status.chapters.some((c) => c.digested)}
              >
                {thematicJobId ? "Analyzing…" : "Analyze themes for digested chapters"}
              </Button>
              <Button variant="outline" size="sm" onClick={handleTagThemes} disabled={taggingJobId !== null}>
                {taggingJobId ? "Tagging…" : "Tag highlights with themes"}
              </Button>
              <Button variant="outline" size="sm" onClick={handleDistillThemes} disabled={distillJobId !== null}>
                {distillJobId ? "Distilling…" : "Distil book-level themes"}
              </Button>
            </div>
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
              return (
                <article key={c.spineIndex} className={styles.chapterCard}>
                  <h3 className={styles.chapterTitle}>
                    {c.title ?? chapterLabel}
                    {c.title && <span className={styles.chapterMeta}> — {chapterLabel}</span>}
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
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
