import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import type { Resource } from "@marginalia/shared";
import { Toast } from "../app/Toast.js";
import { playAirlock } from "../app/airlockBus.js";
import { BookCover } from "../library/BookCover.js";
import { coverLayoutId } from "../library/coverLayoutId.js";
import { formatPublishSummary, runPublish } from "../library/publish.js";
import { ReaderView } from "./ReaderView.js";
import styles from "./ReaderPage.module.css";

interface ReaderLocationState {
  jumpToHighlightId?: string;
  viaAirlock?: boolean;
}

export function ReaderPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [resource, setResource] = useState<Resource | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const reducedMotion = Boolean(useReducedMotion());
  // Captured once, lazily, at mount — not read live from `location` on every
  // render. ReaderView only mounts once `resource` finishes its async fetch
  // below; a live read would see `null` by the time that happens, because
  // the "clear the flag" effect just below fires on THIS component's first
  // commit (immediately), well before that fetch resolves. Found live: the
  // scan's "click a band" jump landed on the right page (CFI still worked)
  // but silently never opened the thread panel.
  const [initialLocationState] = useState<ReaderLocationState | null>(
    () => location.state as ReaderLocationState | null,
  );

  useEffect(() => {
    if (!id) return;
    setResource(null);
    setNotFound(false);
    fetch(`/api/resources/${id}`)
      .then(async (res) => {
        if (!res.ok) {
          setNotFound(true);
          return;
        }
        setResource((await res.json()) as Resource);
      })
      .catch(() => setNotFound(true));
  }, [id]);

  // Arrived via the scan's airlock (a heat band click) — play the "in" half
  // (scanlines fading back out to reveal the book) once, then clear the flag
  // so a plain reload of this URL doesn't replay it.
  useEffect(() => {
    if (!initialLocationState?.viaAirlock) return;
    void playAirlock("in", reducedMotion ? 0 : 360);
    navigate(location.pathname, { replace: true, state: null });
    // Runs once per mount by design — re-checking on every location.state
    // change would replay the "in" animation on unrelated in-page
    // navigations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleOpenScan() {
    if (!id) return;
    await playAirlock("out", reducedMotion ? 0 : 360);
    navigate(`/scan/${id}`, { state: { viaAirlock: true } });
  }

  if (!id) return null;

  if (notFound) {
    return (
      <div className={styles.page}>
        <p>That book isn't in the library.</p>
        <Link to="/">Back to library</Link>
      </div>
    );
  }

  if (!resource) {
    return <div className={styles.page} />;
  }

  async function handlePublish() {
    if (!resource) return;
    setPublishing(true);
    const outcome = await runPublish(resource.id);
    setPublishing(false);
    setToast(
      outcome.ok
        ? { message: formatPublishSummary(outcome.result), tone: "success" }
        : { message: outcome.message, tone: "error" },
    );
  }

  return (
    <div className={styles.readerPage}>
      <div className={styles.titleBar}>
        {/* Doorway transition (DESIGN.md): shares a layoutId with the
            library card's cover — the same element the user just clicked,
            landing here (M7's proof of the shared-element motion system). */}
        <motion.div
          className={styles.coverThumb}
          layoutId={reducedMotion ? undefined : coverLayoutId(resource.id)}
        >
          <BookCover resourceId={resource.id} title={resource.title} />
        </motion.div>
        <span className={styles.title}>{resource.title}</span>
        {resource.author && (
          <span className={styles.author}>{resource.author}</span>
        )}
        <button type="button" className={styles.scanButton} onClick={handleOpenScan}>
          Scan
        </button>
        <button
          type="button"
          className={styles.publishButton}
          disabled={publishing}
          onClick={handlePublish}
        >
          {publishing ? "Publishing…" : "Publish"}
        </button>
      </div>
      <ReaderView resourceId={resource.id} initialHighlightId={initialLocationState?.jumpToHighlightId} />
      {toast && (
        <Toast
          message={toast.message}
          tone={toast.tone}
          position="top"
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  );
}
