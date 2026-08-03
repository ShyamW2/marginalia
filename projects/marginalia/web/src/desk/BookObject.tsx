import { useRef, useState, type KeyboardEvent, type MouseEvent, type WheelEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion, useMotionValue, type PanInfo } from "motion/react";
import type { CursorStyleChoice, ResourceSummary, ShelfState } from "@marginalia/shared";
import { captureOverlayOrigin, setPendingOverlayOrigin } from "../controls/overlayOrigin.js";
import { BookCover } from "../library/BookCover.js";
import { coverLayoutId } from "../library/coverLayoutId.js";
import { Button } from "../controls/Button.js";
import styles from "./BookObject.module.css";

// Total accumulated |wheel delta| needed to "wind the crown" all the way in.
const CROWN_THRESHOLD = 260;
// A pointer that moved less than this during a drag gesture is a click, not
// a rearrangement — open the book instead of persisting a near-zero move.
const DRAG_CLICK_THRESHOLD = 4;

function relativeLastRead(iso: string | null): string {
  if (!iso) return "never opened";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "read today";
  if (days === 1) return "read yesterday";
  if (days < 30) return `read ${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `read ${months}mo ago`;
  return `read ${Math.floor(months / 12)}y ago`;
}

interface BookObjectProps {
  resource: ResourceSummary;
  position: ShelfState;
  reducedMotion: boolean;
  cursorStyle: CursorStyleChoice;
  onBringToFront: (resourceId: string) => number;
  onPositionChange: (resourceId: string, next: ShelfState) => void;
  onPublish: (resourceId: string) => void;
  publishing: boolean;
}

/**
 * A book on the desk (DESIGN.md "Room 1"): cover-forward, draggable,
 * spring-settles on release, lifts under a deeper shadow while dragging.
 * Click opens it (sharing the M7 doorway transition's layoutId with the
 * reader); scrolling while hovered "winds the crown" to the same opening.
 */
export function BookObject({
  resource,
  position,
  reducedMotion,
  cursorStyle,
  onBringToFront,
  onPositionChange,
  onPublish,
  publishing,
}: BookObjectProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const x = useMotionValue(position.x);
  const y = useMotionValue(position.y);
  const [zOrder, setZOrder] = useState(position.zOrder);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [crownProgress, setCrownProgress] = useState(0);
  const dragDistance = useRef(0);
  const openedRef = useRef(false);

  function open() {
    if (openedRef.current) return;
    openedRef.current = true;
    navigate(`/read/${resource.id}`);
  }

  // Unlike `open()` below, these don't gate on `openedRef`: opening the
  // reader unmounts this whole BookObject (a real room change), so a
  // permanently-latched guard never gets in its own way. The Scan/Digest
  // overlays leave the Desk (and this component) mounted underneath, so the
  // same guard would permanently block re-opening either one after the
  // first click — caught live going "open scan, close it, open scan again."
  function openScan(event: MouseEvent<HTMLElement>) {
    // M20.5 "the Scan becomes a popup": flies in from the button that opened
    // it (the same `background`-location pattern Settings already uses),
    // not the old Book<->Scan airlock — there's no longer a room to travel
    // to (decisions.md 2026-07-30).
    setPendingOverlayOrigin(captureOverlayOrigin(event.currentTarget));
    navigate(`/scan/${resource.id}`, { state: { background: location } });
  }

  // M20.5 "the Digest becomes a popup too": the same pattern as openScan.
  function openDigest(event: MouseEvent<HTMLElement>) {
    setPendingOverlayOrigin(captureOverlayOrigin(event.currentTarget));
    navigate(`/digest/${resource.id}`, { state: { background: location } });
  }

  function handleDragStart() {
    dragDistance.current = 0;
    setIsDragging(true);
    setZOrder(onBringToFront(resource.id));
  }

  function handleDrag(_event: unknown, info: PanInfo) {
    dragDistance.current += Math.abs(info.delta.x) + Math.abs(info.delta.y);
  }

  function handleDragEnd() {
    setIsDragging(false);
    if (dragDistance.current < DRAG_CLICK_THRESHOLD) {
      open();
      return;
    }
    onPositionChange(resource.id, {
      x: x.get(),
      y: y.get(),
      rotation: position.rotation,
      zOrder,
    });
  }

  function handleWheel(event: WheelEvent) {
    const next = Math.min(1, crownProgress + Math.abs(event.deltaY) / CROWN_THRESHOLD);
    setCrownProgress(next);
    if (next >= 1) open();
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    } else if (event.key === "Escape") {
      setCrownProgress(0);
    }
  }

  const scale = isDragging ? 1.04 : 1 + crownProgress * 0.08;
  const bookClassName = [
    styles.book,
    cursorStyle === "system" ? styles.systemCursor : "",
    isDragging ? styles.grabbing : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <motion.div
      className={bookClassName}
      // The info strip is a child of this element, so it only draws above
      // siblings if the book itself is raised above them while hovered —
      // otherwise a higher-zOrder neighbor paints over the strip (confirmed
      // live: a book dragged-to-front earlier hid the hover strip of a book
      // behind it).
      style={{ x, y, rotate: position.rotation, zIndex: isHovering ? 100_000 : zOrder }}
      drag={!reducedMotion}
      dragMomentum={false}
      dragElastic={0.12}
      onDragStart={handleDragStart}
      onDrag={handleDrag}
      onDragEnd={handleDragEnd}
      onTap={(event) => {
        // Framer Motion's tap gesture is driven by pointerdown/pointerup,
        // which fire *before* a nested button's click event — so a nested
        // button's own `stopPropagation()` (Open scan, Read digest,
        // Publish) can't prevent this from also firing (caught live: both
        // navigations fired, and whichever `navigate()` ran second won).
        // Checking the tap's own target for a nested button is what
        // actually scopes this to "the cover itself was tapped."
        const target = event.target;
        if (target instanceof Element && target.closest("button")) return;
        if (dragDistance.current < DRAG_CLICK_THRESHOLD) open();
      }}
      onPointerEnter={() => setIsHovering(true)}
      onPointerLeave={() => {
        setIsHovering(false);
        setCrownProgress(0);
      }}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="link"
      aria-label={`Open ${resource.title}`}
      animate={{ scale }}
      transition={{ type: "spring", stiffness: 420, damping: 30 }}
    >
      {/* Lift lives on its own wrapper, separate from the outer element's
          x/y motion values (drag position) and from coverWrap's layoutId
          (the doorway transition) — sharing whileHover's y with either of
          those animates it to an *absolute* -4, which for a book dragged
          away from the origin is a multi-hundred-px jump on hover, not a
          few-px lift (the M11 "desk hover jump" bug). */}
      <motion.div
        className={styles.liftWrap}
        whileHover={reducedMotion ? undefined : { y: -4 }}
        transition={{ type: "spring", stiffness: 420, damping: 30 }}
      >
        <motion.div
          className={`${styles.coverWrap} ${isDragging ? styles.lifted : ""}`}
          layoutId={reducedMotion ? undefined : coverLayoutId(resource.id)}
        >
          <BookCover resourceId={resource.id} title={resource.title} />
          {resource.threadCount > 0 && (
            <span className={styles.threadBadge}>{resource.threadCount}</span>
          )}
          {crownProgress > 0 && (
            <div className={styles.crownRing} style={{ opacity: crownProgress }} />
          )}
        </motion.div>
      </motion.div>

      {isHovering && !isDragging && (
        <div className={styles.infoStrip} role="note">
          <div className={styles.infoTitle}>{resource.title}</div>
          <div className={styles.infoMeta}>
            {resource.author && <span>{resource.author}</span>}
            <span>{relativeLastRead(resource.lastReadAt)}</span>
            <span>
              {resource.threadCount} thread{resource.threadCount === 1 ? "" : "s"}
            </span>
            <span>
              {resource.highlightCount} highlight{resource.highlightCount === 1 ? "" : "s"}
            </span>
          </div>
          <div className={styles.infoActions}>
            <Button
              variant="ghost"
              size="sm"
              className={styles.infoAction}
              onClick={(e) => {
                e.stopPropagation();
                openScan(e);
              }}
            >
              Open scan
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={styles.infoAction}
              onClick={(e) => {
                e.stopPropagation();
                openDigest(e);
              }}
            >
              Read digest
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={styles.infoAction}
              disabled={publishing}
              onClick={(e) => {
                e.stopPropagation();
                onPublish(resource.id);
              }}
            >
              {publishing ? "Publishing…" : "Publish"}
            </Button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
