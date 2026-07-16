import { useEffect, useRef, useState } from "react";
import ePub from "epubjs";
import type { Book, Contents, Location, Rendition } from "epubjs";
import type { ReadingPosition } from "@marginalia/shared";
import { useEpubThemeVars, type EpubThemeVars } from "./useEpubThemeVars.js";
import styles from "./ReaderView.module.css";

const POSITION_SAVE_DEBOUNCE_MS = 600;
const LOCATIONS_CHAR_STEP = 1600;

function applyTheme(rendition: Rendition, vars: EpubThemeVars): void {
  rendition.themes.register("app", {
    "html, body": {
      background: `${vars.bg} !important`,
      color: `${vars.text} !important`,
    },
    body: {
      "font-family": `${vars.fontSerif} !important`,
      "line-height": "1.65 !important",
      padding: "0 2rem !important",
    },
    a: { color: `${vars.accent} !important` },
    "::selection": { background: `${vars.highlightActive} !important` },
  });
  rendition.themes.select("app");
}

async function fetchPosition(
  resourceId: string,
): Promise<ReadingPosition | null> {
  const res = await fetch(`/api/resources/${resourceId}/position`);
  if (!res.ok) return null;
  return (await res.json()) as ReadingPosition | null;
}

function savePosition(resourceId: string, location: string): void {
  fetch(`/api/resources/${resourceId}/position`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ location }),
  }).catch(() => {
    // best-effort — losing one position write isn't worth surfacing an error
  });
}

interface ReaderViewProps {
  resourceId: string;
}

export function ReaderView({ resourceId }: ReaderViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const themeVars = useEpubThemeVars();

  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [progressPercent, setProgressPercent] = useState<number | null>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    setStatus("loading");
    setProgressPercent(null);

    // Our file route has no .epub extension for epub.js to sniff from the
    // URL, so it would otherwise be treated as an unpacked directory of
    // book files rather than a single archive to fetch and unzip.
    const book: Book = ePub(`/api/resources/${resourceId}/file`, {
      openAs: "epub",
    });
    const rendition = book.renderTo(containerRef.current, {
      width: "100%",
      height: "100%",
      flow: "paginated",
      manager: "default",
      spread: "none",
      allowScriptedContent: false,
    });
    renditionRef.current = rendition;
    applyTheme(rendition, themeVars);

    function handleRelocated(location: Location) {
      setAtStart(Boolean(location.atStart));
      setAtEnd(Boolean(location.atEnd));
      const pct = location.start.percentage;
      if (typeof pct === "number") {
        setProgressPercent(Math.round(pct * 100));
      }

      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        savePosition(resourceId, location.start.cfi);
      }, POSITION_SAVE_DEBOUNCE_MS);
    }
    rendition.on("relocated", handleRelocated);

    function handleContentClick(event: MouseEvent, contents: Contents) {
      const target = event.target as HTMLElement | null;
      // Old Gutenberg-style markup often has unclosed `<a id="...">` bookmark
      // anchors (no href) that end up wrapping whole chapters per lenient
      // HTML parsing — only treat *navigable* links as click-through targets.
      if (target?.closest("a[href]")) return;
      if (contents.window.getSelection()?.toString()) return;

      // epub.js's paginated flow renders the whole section into one wide
      // multi-column iframe and reveals the current page via scroll offset,
      // so event.clientX is relative to that wide canvas, not the visible
      // viewport. Translate through the iframe's own screen position to get
      // a coordinate relative to our (viewport-sized) container instead.
      const iframeEl = contents.document.defaultView?.frameElement as
        | HTMLElement
        | null
        | undefined;
      const container = containerRef.current;
      if (!iframeEl || !container) return;

      const iframeRect = iframeEl.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const visibleX = iframeRect.left + event.clientX - containerRect.left;

      if (visibleX < containerRect.width * 0.3) {
        rendition.prev();
      } else if (visibleX > containerRect.width * 0.7) {
        rendition.next();
      }
    }
    rendition.on("click", handleContentClick);

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") rendition.prev();
      else if (event.key === "ArrowRight") rendition.next();
    }
    rendition.on("keydown", handleKeydown);
    window.addEventListener("keydown", handleKeydown);

    book.ready
      .then(async () => {
        if (cancelled) return;
        const position = await fetchPosition(resourceId);
        await rendition.display(position?.location ?? undefined);
        if (cancelled) return;
        setStatus("ready");

        // Locations let epub.js compute a whole-book percentage from a CFI;
        // generating them is async, so the initial relocated event may fire
        // before percentages are available — recompute once ready.
        book.locations.generate(LOCATIONS_CHAR_STEP).then(() => {
          if (!cancelled) rendition.reportLocation();
        });
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
      window.clearTimeout(saveTimerRef.current);
      window.removeEventListener("keydown", handleKeydown);
      renditionRef.current = null;
      rendition.destroy();
      book.destroy();
    };
    // themeVars intentionally excluded — handled by the effect below so
    // toggling the theme doesn't tear down and reload the whole book.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId]);

  useEffect(() => {
    if (renditionRef.current) applyTheme(renditionRef.current, themeVars);
  }, [themeVars]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.progress}>
        {progressPercent !== null ? `${progressPercent}%` : ""}
      </div>

      <div className={styles.stage}>
        <div ref={containerRef} className={styles.epubContainer} />
        {status === "loading" && (
          <div className={styles.overlay}>Loading book…</div>
        )}
        {status === "error" && (
          <div className={styles.overlay}>Couldn't load this book.</div>
        )}
      </div>

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.navButton}
          disabled={atStart}
          onClick={() => renditionRef.current?.prev()}
        >
          ← Previous
        </button>
        <button
          type="button"
          className={styles.navButton}
          disabled={atEnd}
          onClick={() => renditionRef.current?.next()}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
