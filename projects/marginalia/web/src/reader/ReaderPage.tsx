import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import type { ReaderPaneWidth, Resource, Settings, SpreadMode } from "@marginalia/shared";
import { Toast } from "../app/Toast.js";
import { playAirlock } from "../app/airlockBus.js";
import { BookCover } from "../library/BookCover.js";
import { coverLayoutId } from "../library/coverLayoutId.js";
import { formatPublishSummary, runPublish } from "../library/publish.js";
import { Button, buttonClassName } from "../controls/Button.js";
import { BrainIcon, MagnifierIcon } from "../controls/icons.js";
import { ReaderView } from "./ReaderView.js";
import styles from "./ReaderPage.module.css";

interface ReaderLocationState {
  jumpToHighlightId?: string;
  /** M19.5: a posed question's text, arriving from the digest page — seeds
   * the jumped-to thread's draft, pre-filled. */
  jumpToQuestion?: string;
  viaAirlock?: boolean;
}

export function ReaderPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [resource, setResource] = useState<Resource | null>(null);
  // M19.6 "annotations roam the app": the thread panel's dragConstraints
  // widen from the reading stage to this — the reader page's own root,
  // everything a book's title bar and stage share. Handed down through
  // ReaderView rather than reaching for App.tsx's outer shell, since the
  // reader's own room is what a dragged note has license to roam within.
  const appBoundsRef = useRef<HTMLDivElement>(null);
  // Fetched alongside the resource, not inside ReaderView, so the reader's
  // own book-loading effect can pass `spread` to epub.js's `renderTo()` at
  // creation time instead of racing a settings fetch against it (renderTo's
  // spread option only applies at creation — see the M12 note in NOTES.md
  // for why that ordering matters). Read once per mount; toggling it in the
  // M11 settings modal while a book is already open takes effect on the
  // next open/reload, not live — a deliberate scope boundary, not a bug.
  const [spreadMode, setSpreadMode] = useState<SpreadMode | null>(null);
  // M19.6 "the reading pane is resizable" (decisions.md 2026-07-30 later):
  // same "resolved before ReaderView ever mounts" story as spreadMode
  // above — the initial `--reader-max-width` needs this at first paint, not
  // moments later, or a reader with a custom pane width sees a flash back
  // to the spread-mode default on every reload.
  const [readerPaneWidth, setReaderPaneWidth] = useState<ReaderPaneWidth | null>(null);
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
    setSpreadMode(null);
    setReaderPaneWidth(null);
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
    fetch("/api/settings")
      .then((res) => (res.ok ? (res.json() as Promise<Settings>) : null))
      .then((settings) => {
        setSpreadMode(settings?.spreadMode ?? "single");
        setReaderPaneWidth(settings?.readerPaneWidth ?? 0);
      })
      .catch(() => {
        setSpreadMode("single");
        setReaderPaneWidth(0);
      });
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

  if (!resource || !spreadMode || readerPaneWidth === null) {
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
    <div className={`${styles.readerPage} register-paper register-quiet`} ref={appBoundsRef}>
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
        <Link
          to={`/digest/${resource.id}`}
          className={buttonClassName({ variant: "outline", size: "sm", className: styles.digestLink })}
        >
          <BrainIcon size={15} />
          Digest
        </Link>
        <Button
          variant="outline"
          size="sm"
          icon={<MagnifierIcon size={15} />}
          className={styles.scanButton}
          onClick={handleOpenScan}
        >
          Scan
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={styles.publishButton}
          disabled={publishing}
          onClick={handlePublish}
        >
          {publishing ? "Publishing…" : "Publish"}
        </Button>
      </div>
      <ReaderView
        resourceId={resource.id}
        initialHighlightId={initialLocationState?.jumpToHighlightId}
        initialQuestion={initialLocationState?.jumpToQuestion}
        spreadMode={spreadMode}
        initialReaderPaneWidth={readerPaneWidth}
        appBoundsRef={appBoundsRef}
      />
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
