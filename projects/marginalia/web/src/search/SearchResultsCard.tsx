import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { motion, useDragControls, useMotionValue, useReducedMotion } from "motion/react";
import { Button } from "../controls/Button.js";
import { IconButton } from "../controls/IconButton.js";
import { clampPanelOffset } from "../threads/panelGeometry.js";
import type { SearchResultRow } from "./searchRows.js";
import styles from "./SearchResultsCard.module.css";

const MIN_WIDTH_PX = 260;
const MIN_HEIGHT_PX = 180;

interface SearchResultsCardProps {
  rows: SearchResultRow[];
  /** The find cursor's index in the same ordered result set the rows are
   * numbered by — `‹ ›` and this list step the one list (TASKS.md M24.1 D). */
  currentIndex: number;
  query: string;
  loading: boolean;
  onSelect: (index: number) => void;
  onClose: () => void;
  /** The reader page's own root — what a drag is constrained to and what a
   * stale offset gets clamped back into, exactly as for the annotation card
   * (ThreadPanel's `appBoundsRef`). */
  appBoundsRef: RefObject<HTMLDivElement>;
  /** M24.7 §E: display order only — `rows` stays index-stable (identity
   * lives in `row.index`, decisions.md 2026-08-14), this just walks it
   * back-to-front. The pebble's `‹ ›` reverse with it (ReaderView's
   * `handleFindStep`), so the window and the pebble can never disagree
   * about which physical direction is "next". */
  reversed: boolean;
  onToggleReversed: () => void;
  /** Hands a specific hit off to the Scan — `⇧⏎` on a focused row, or the
   * footer's "Show all" (which passes the shared cursor, the same handoff
   * the pebble's own "See in Scan" makes). */
  onOpenInScan: (index: number) => void;
}

interface RowGroup {
  chapter: string;
  rows: SearchResultRow[];
}

/** Contiguous runs by chapter label, not a group-by-map — hits arrive in
 * book order (the server sorts by spineIndex/offset), so a chapter's hits
 * are already adjacent; a map would silently merge two *non-adjacent*
 * sections that happen to share a label (an untitled front-matter section,
 * say) into one header. */
function groupRowsByChapter(rows: SearchResultRow[]): RowGroup[] {
  const groups: RowGroup[] = [];
  for (const row of rows) {
    const label = row.chapter ?? row.source;
    const last = groups[groups.length - 1];
    if (last && last.chapter === label) {
      last.rows.push(row);
    } else {
      groups.push({ chapter: label, rows: [row] });
    }
  }
  return groups;
}

/**
 * The search result set as a card (TASKS.md M24.1 D, operator request;
 * reworked into a real hierarchy in M24.7 §E): movable and resizable like
 * the annotation card, sticky chapter headers, one row per hit, a row click
 * landing exactly where stepping to that index lands.
 *
 * It is a *view* of the M24 result set, never a second result set
 * (decisions.md 2026-08-14, "one result set, two views"): it holds no hits,
 * no query and no cursor of its own — the reader owns all three and this
 * renders them, so the card and the find bar cannot disagree about what was
 * found or which hit is current.
 *
 * Chrome and register are the annotation card's (settled decision 12): the
 * same paper panel, border, shadow and header-drag gesture, anchored to the
 * *left* of the stage so opening both at once doesn't stack one on the other.
 */
export function SearchResultsCard({
  rows,
  currentIndex,
  query,
  loading,
  onSelect,
  onClose,
  appBoundsRef,
  reversed,
  onToggleReversed,
  onOpenInScan,
}: SearchResultsCardProps) {
  const reducedMotion = Boolean(useReducedMotion());
  const cardRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const dragControls = useDragControls();
  const dragX = useMotionValue(0);
  const dragY = useMotionValue(0);
  const [isDragging, setIsDragging] = useState(false);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  function reclamp() {
    const cardEl = cardRef.current;
    const boundsEl = appBoundsRef.current;
    if (!cardEl || !boundsEl) return;
    const clamped = clampPanelOffset(
      cardEl.getBoundingClientRect(),
      boundsEl.getBoundingClientRect(),
      dragX.get(),
      dragY.get(),
    );
    dragX.set(clamped.dx);
    dragY.set(clamped.dy);
  }

  function handleHeaderPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    // The close button shares the header strip — a pointerdown there is a
    // click, not a drag start (same rule as ThreadPanel's header).
    if ((event.target as HTMLElement).closest("button")) return;
    dragControls.start(event);
  }

  // The card is left- and top-anchored (see the CSS) with the drag offset
  // layered on as a transform, so growing width or height always extends the
  // right and bottom edges — the edge the cursor is on. That is why there are
  // no left/top handles and no offset compensation here: ThreadPanel needs
  // both only because it is right-anchored.
  function handleResizePointerDown(horizontal: boolean, vertical: boolean) {
    return function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
      event.stopPropagation();
      const cardEl = cardRef.current;
      const boundsEl = appBoundsRef.current;
      if (!cardEl || !boundsEl) return;
      event.currentTarget.setPointerCapture(event.pointerId);

      const startRect = cardEl.getBoundingClientRect();
      const startWidth = size?.width ?? startRect.width;
      const startHeight = size?.height ?? startRect.height;
      const startX = event.clientX;
      const startY = event.clientY;
      const boundsRect = boundsEl.getBoundingClientRect();

      function onMove(moveEvent: PointerEvent) {
        setSize({
          width: horizontal
            ? Math.min(Math.max(startWidth + moveEvent.clientX - startX, MIN_WIDTH_PX), boundsRect.width)
            : startWidth,
          height: vertical
            ? Math.min(Math.max(startHeight + moveEvent.clientY - startY, MIN_HEIGHT_PX), boundsRect.height)
            : startHeight,
        });
      }

      function onUp() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        // Growing the card can push it past the bounds edge; re-clamp once
        // the new box has actually laid out.
        requestAnimationFrame(reclamp);
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };
  }

  // The stepped hit is brought into view rather than the reader hunting for
  // it — this is the same cursor `‹ ›` moves, so the list has to follow it
  // wherever it goes, including the wrap from last to first.
  useEffect(() => {
    if (currentIndex < 0) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-hit-index="${currentIndex}"]`);
    row?.scrollIntoView({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
  }, [currentIndex, reducedMotion, rows]);

  // M24.7 §E: display order is the one thing `reversed` is allowed to
  // touch — `row.index` (a hit's identity) never moves, only where it
  // renders in this list. Grouped after reversing, so the chapter headers
  // read top-to-bottom in whichever direction is current.
  const groups = useMemo(() => {
    const displayRows = reversed ? [...rows].reverse() : rows;
    return groupRowsByChapter(displayRows);
  }, [rows, reversed]);

  function handleListKeyDown(event: ReactKeyboardEvent<HTMLUListElement>) {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-hit-index]");
    if (!target) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const buttons = Array.from(
        listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-hit-index]") ?? [],
      );
      const i = buttons.indexOf(target);
      if (i === -1) return;
      const nextIndex = event.key === "ArrowDown" ? Math.min(i + 1, buttons.length - 1) : Math.max(i - 1, 0);
      buttons[nextIndex]?.focus();
    } else if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      onOpenInScan(Number(target.dataset.hitIndex));
    }
  }

  const trimmedQuery = query.trim();
  const titleLabel = trimmedQuery.length === 0 ? "Results" : `"${trimmedQuery}"`;
  const summaryLabel = loading
    ? "Searching…"
    : rows.length === 0
      ? trimmedQuery.length === 0
        ? "Type to search"
        : "No results"
      : `${rows.length} in ${groups.length} chapter${groups.length === 1 ? "" : "s"}`;

  return (
    <motion.div
      ref={cardRef}
      className={styles.card}
      style={{ x: dragX, y: dragY, width: size?.width, height: size?.height }}
      role="dialog"
      aria-label="Search results"
      drag
      dragControls={dragControls}
      dragListener={false}
      dragConstraints={appBoundsRef}
      dragElastic={0}
      dragMomentum={false}
      onDragStart={() => setIsDragging(true)}
      onDragEnd={() => setIsDragging(false)}
      // Opacity and scale only — `x`/`y` are the drag's own motion values
      // (above), and animating them here would fight the gesture for the
      // same transform channel.
      initial={{ opacity: 0, scale: reducedMotion ? 1 : 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: reducedMotion ? 1 : 0.98 }}
      transition={reducedMotion ? { duration: 0.12 } : { type: "spring", stiffness: 420, damping: 34 }}
    >
      <div
        className={`${styles.header} ${isDragging ? styles.headerDragging : ""}`}
        onPointerDown={handleHeaderPointerDown}
      >
        <span className={styles.title}>{titleLabel}</span>
        <span className={styles.status} aria-live="polite">
          {summaryLabel}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className={styles.orderButton}
          disabled={rows.length === 0}
          aria-pressed={reversed}
          title="Order results by position in the book"
          onClick={onToggleReversed}
        >
          {reversed ? "Latest first" : "Earliest first"}
        </Button>
        <IconButton icon="×" label="Close results" size="sm" className={styles.closeButton} onClick={onClose} />
      </div>

      {rows.length === 0 ? (
        <div className={styles.empty}>
          {trimmedQuery.length === 0
            ? "Search the book and your annotations to see every hit here."
            : loading
              ? "Searching…"
              : `Nothing found for “${trimmedQuery}”.`}
        </div>
      ) : (
        <ul className={styles.list} ref={listRef} onKeyDown={handleListKeyDown}>
          {groups.map((group, groupIndex) => (
            <li key={`${group.chapter}-${groupIndex}`} className={styles.group}>
              <div className={styles.chapterHeader}>
                <span className={styles.chapterHeaderName}>{group.chapter}</span>
                <span className={styles.chapterHeaderCount}>{group.rows.length}</span>
              </div>
              <ul className={styles.groupRows}>
                {group.rows.map((row) => (
                  <li key={row.index} className={styles.item}>
                    <button
                      type="button"
                      data-hit-index={row.index}
                      className={`${styles.entry} ${row.index === currentIndex ? styles.entryCurrent : ""}`}
                      aria-current={row.index === currentIndex ? "true" : undefined}
                      onClick={() => onSelect(row.index)}
                    >
                      <span className={styles.snippet}>
                        {row.before}
                        {row.match && <mark className={styles.mark}>{row.match}</mark>}
                        {row.after}
                      </span>
                      <span className={styles.meta}>
                        {row.page && <span className={styles.metaCell}>{row.page}</span>}
                        <span className={styles.metaCell}>{row.percent}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.footer}>
        <span className={styles.footerHint}>↑↓ move · ⏎ jump · ⇧⏎ open in Scan</span>
        <Button
          variant="ghost"
          size="sm"
          className={styles.showAllButton}
          disabled={rows.length === 0}
          onClick={() => onOpenInScan(currentIndex)}
        >
          Show all {rows.length}
        </Button>
      </div>

      <div
        className={`${styles.resizeEdge} ${styles.resizeEdgeRight}`}
        aria-hidden="true"
        onPointerDown={handleResizePointerDown(true, false)}
      />
      <div
        className={`${styles.resizeEdge} ${styles.resizeEdgeBottom}`}
        aria-hidden="true"
        onPointerDown={handleResizePointerDown(false, true)}
      />
      <div
        className={styles.resizeHandle}
        aria-hidden="true"
        onPointerDown={handleResizePointerDown(true, true)}
      />
    </motion.div>
  );
}
