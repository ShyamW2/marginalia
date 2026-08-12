import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import type { ReaderPaneWidth, Resource, Settings, SpreadMode } from "@marginalia/shared";
import { Toast } from "../app/Toast.js";
import { BookCover } from "../library/BookCover.js";
import { coverLayoutId } from "../library/coverLayoutId.js";
import { formatPublishSummary, runPublish } from "../library/publish.js";
import {
  captureOverlayOrigin,
  readPendingOverlayOrigin,
  setPendingOverlayOrigin,
  type OverlayOrigin,
} from "../controls/overlayOrigin.js";
import { SHORTCUT_KEYS } from "../shortcuts/keys.js";
import { useShortcuts } from "../shortcuts/useShortcuts.js";
import { BookOpening } from "./BookOpening.js";
import { ReaderView } from "./ReaderView.js";
import styles from "./ReaderPage.module.css";

interface ReaderLocationState {
  jumpToHighlightId?: string;
  /** M19.5: a posed question's text, arriving from the digest page — seeds
   * the jumped-to thread's draft, pre-filled. */
  jumpToQuestion?: string;
  /** M21 "Listen" entry point (desk hover strip / list view): start
   * listening once the book is open, same "captured once at mount" story
   * as the other two fields above. */
  listenOnOpen?: boolean;
}

interface ReaderPageProps {
  /** Whether the Scan/Digest this room opened is still showing above it —
   * computed by `App.tsx` from the real, un-remapped location (see the
   * comment at this route's `element`). Undefined on any render path that
   * doesn't come through that route (there is none today, but the prop
   * stays optional rather than assumed). */
  scanOpen?: boolean;
  digestOpen?: boolean;
  onCloseScan?: () => void;
  onCloseDigest?: () => void;
}

export function ReaderPage({ scanOpen, digestOpen, onCloseScan, onCloseDigest }: ReaderPageProps) {
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
  const scanButtonRef = useRef<HTMLButtonElement>(null);
  const digestButtonRef = useRef<HTMLButtonElement>(null);
  // M20.7 "the opening": read once at mount, the same click-time-rect
  // handoff the Scan/Digest overlays use (App.tsx's "background location"
  // pattern doesn't apply here — the reader is a full room, not a popup —
  // but the origin-capture half of that machinery is identical). Absent on
  // a direct/deep link or the list view's plain `<Link>`, both of which
  // keep today's plain load with no overlay.
  const [origin] = useState<OverlayOrigin | null>(() => readPendingOverlayOrigin());
  const [openingDone, setOpeningDone] = useState(false);
  const [readerReady, setReaderReady] = useState(false);
  // M22.5 "the opening actually opens": the reading pane's rect, measured by
  // BookOpening once the reader is ready — the target the revealed spread
  // scales and translates onto before crossfading to the live reader.
  // `HTMLDivElement | null` so `useRef` resolves to a `MutableRefObject` —
  // ReaderView writes this one, it doesn't just receive it as a JSX `ref`.
  const readerStageRef = useRef<HTMLDivElement | null>(null);

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

  function openScanFrom(el: Element) {
    if (!id) return;
    // M20.5 "the Scan becomes a popup": flies in from the control that
    // opened it — the same background-location pattern Settings already
    // uses, not the old Book<->Scan airlock (decisions.md 2026-07-30:
    // there's no longer a room to travel to).
    setPendingOverlayOrigin(captureOverlayOrigin(el));
    navigate(`/scan/${id}`, { state: { background: location } });
  }

  function handleOpenScan(event: MouseEvent<HTMLElement>) {
    openScanFrom(event.currentTarget);
  }

  // M20.5 "the Digest becomes a popup too": the exact same background-
  // location pattern as the Scan above, now that Digest is a second
  // instrument rather than a plain routed page.
  function openDigestFrom(el: Element) {
    if (!id) return;
    setPendingOverlayOrigin(captureOverlayOrigin(el));
    navigate(`/digest/${id}`, { state: { background: location } });
  }

  function handleOpenDigest(event: MouseEvent<HTMLElement>) {
    openDigestFrom(event.currentTarget);
  }

  // M20.5 "`q` opens the scan for the book in focus": unambiguous here — the
  // book this reader has open — through the M19.7 shared registry. Focuses
  // the Scan button first (there's no click target for a keyboard trigger),
  // matching NavCluster's identical "s" -> settings pattern. M22.6 "`q`
  // closes the Scan it opened": `scanOpen`/`digestOpen` (threaded down from
  // App.tsx, which can see the real location this room's own can't — see the
  // route's comment) turn the same key into the close, reusing App.tsx's
  // existing `closeScan`/`closeDigest` rather than a second already-open
  // check.
  useShortcuts([
    {
      key: SHORTCUT_KEYS.scan,
      handler: () => {
        if (scanOpen) {
          onCloseScan?.();
          return;
        }
        scanButtonRef.current?.focus();
        if (scanButtonRef.current) openScanFrom(scanButtonRef.current);
      },
    },
    {
      key: SHORTCUT_KEYS.digest,
      handler: () => {
        if (digestOpen) {
          onCloseDigest?.();
          return;
        }
        digestButtonRef.current?.focus();
        if (digestButtonRef.current) openDigestFrom(digestButtonRef.current);
      },
    },
  ]);

  if (!id) return null;

  if (notFound) {
    return (
      <div className={styles.page}>
        <p>That book isn't in the library.</p>
        <Link to="/">Back to library</Link>
      </div>
    );
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

  // M20.7: the ready room (title bar + ReaderView) waits on the fetch below
  // exactly as before; the opening overlay does not — it renders from `id`
  // alone (BookCover fetches its cover by id directly) so it can mask this
  // earlier loading beat too, not just what used to be an empty `.page`
  // div. Kept at a stable position among this component's siblings across
  // that loading -> loaded transition so it never remounts (and restarts
  // its flight) partway through.
  return (
    <div className={`${styles.readerPage} register-paper register-quiet`} ref={appBoundsRef}>
      {resource && spreadMode && readerPaneWidth !== null && (
        <>
          <div className={styles.titleBar}>
            {/* Doorway transition (DESIGN.md): shares a layoutId with the
                library card's cover — the same element the user just
                clicked, landing here (M7's proof of the shared-element
                motion system). */}
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
          </div>
          <ReaderView
            resourceId={resource.id}
            initialHighlightId={initialLocationState?.jumpToHighlightId}
            initialQuestion={initialLocationState?.jumpToQuestion}
            spreadMode={spreadMode}
            initialReaderPaneWidth={readerPaneWidth}
            appBoundsRef={appBoundsRef}
            onReady={() => setReaderReady(true)}
            initialAutoplay={initialLocationState?.listenOnOpen}
            onOpenDigest={handleOpenDigest}
            onOpenScan={handleOpenScan}
            onPublish={handlePublish}
            publishing={publishing}
            scanButtonRef={scanButtonRef}
            digestButtonRef={digestButtonRef}
            stageRef={readerStageRef}
          />
        </>
      )}
      {origin && !openingDone && (
        <BookOpening
          origin={origin}
          resourceId={id}
          title={resource?.title ?? ""}
          reducedMotion={reducedMotion}
          contentReady={readerReady}
          stageRef={readerStageRef}
          onDone={() => setOpeningDone(true)}
          onCancel={() => navigate("/")}
        />
      )}
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
