import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { DigestStatus, ThematicStatus } from "@marginalia/shared";
import { Button } from "../controls/Button.js";
import { SHORTCUT_KEYS } from "../shortcuts/keys.js";
import { useShortcuts } from "../shortcuts/useShortcuts.js";
import styles from "./DigestPage.module.css";

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

async function startThematicRun(
  resourceId: string,
  spineStart: number,
  spineEnd: number,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/resources/${resourceId}/thematic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spineStart, spineEnd }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network_error" };
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
export function DigestPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState<DigestStatus | null>(null);
  const [thematic, setThematic] = useState<ThematicStatus | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [revealBook, setRevealBook] = useState(false);
  const [briefDraft, setBriefDraft] = useState("");
  const [briefSaving, setBriefSaving] = useState(false);
  const [briefSaved, setBriefSaved] = useState(true);
  const [thematicRunning, setThematicRunning] = useState(false);
  const [thematicError, setThematicError] = useState<string | null>(null);

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
  }

  useEffect(() => {
    if (!id) return;
    setStatus(null);
    setThematic(null);
    setNotFound(false);
    setRevealed(new Set());
    setRevealBook(false);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!id) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed, revealBook]);

  // M19.6 "`r` opens the reader" (decisions.md 2026-07-30 later): "the book
  // currently in focus" is unambiguous here — the book this digest is for —
  // so `r` is just a keyboard shortcut for the existing "← Book" link below.
  // Moved into the M19.7 shared registry (useShortcuts).
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

  async function handleAnalyzeThemes() {
    if (!id || !status) return;
    const digestedChapters = status.chapters.filter((c) => c.digested);
    if (digestedChapters.length === 0) return;
    setThematicRunning(true);
    setThematicError(null);
    const spineStart = digestedChapters[0].spineIndex;
    const spineEnd = digestedChapters[digestedChapters.length - 1].spineIndex;
    const result = await startThematicRun(id, spineStart, spineEnd);
    setThematicRunning(false);
    if (result.ok) load();
    else setThematicError(result.error ?? "thematic_digest_failed");
  }

  async function handleQuestionClick(spineIndex: number, text: string, quote: string) {
    if (!id) return;
    const highlight = await createChapterAnchor(id, spineIndex, quote);
    if (!highlight) return;
    navigate(`/read/${id}`, { state: { jumpToHighlightId: highlight.id, jumpToQuestion: text } });
  }

  if (!id) return null;

  const thematicByIndex = new Map((thematic?.chapters ?? []).map((c) => [c.spineIndex, c]));

  return (
    <div className={`${styles.page} register-paper`}>
      <div className={styles.headerRow}>
        <Link to={`/scan/${id}`} className={styles.backLink}>
          ← Scan
        </Link>
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
                disabled={thematicRunning || !status.chapters.some((c) => c.digested)}
              >
                {thematicRunning ? "Analyzing…" : "Analyze themes for digested chapters"}
              </Button>
            </div>
            {thematicError && <p className={styles.pausedNotice}>Thematic analysis failed: {thematicError}</p>}
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

          <div className={styles.chapterList}>
            {status.chapters.map((c) => {
              const t = thematicByIndex.get(c.spineIndex);
              const chapterLabel = `Chapter ${c.chapterNumber} · ${formatRange(c.startPercent, c.lengthPercent)}`;
              return (
                <article key={c.spineIndex} className={styles.chapterCard}>
                  <h3 className={styles.chapterTitle}>
                    {c.title ?? chapterLabel}
                    {c.title && <span className={styles.chapterMeta}> — {chapterLabel}</span>}
                  </h3>

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
