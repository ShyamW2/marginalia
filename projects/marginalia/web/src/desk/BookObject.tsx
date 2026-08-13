import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type WheelEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion, type MotionValue, type PanInfo } from "motion/react";
import type { CursorStyleChoice, ResourceSummary, ShelfState } from "@marginalia/shared";
import { captureOverlayOrigin, setPendingOverlayOrigin } from "../controls/overlayOrigin.js";
import { BookCover } from "../library/BookCover.js";
import { coverLayoutId } from "../library/coverLayoutId.js";
import { IconButton } from "../controls/IconButton.js";
import { BrainIcon, MagnifierIcon, PlayIcon, PublishIcon } from "../controls/icons.js";
import { BOOK_DRAG_LIFT, BOOK_HOVER_LIFT } from "./deskDepthMath.js";
import styles from "./BookObject.module.css";

// Total accumulated |wheel delta| needed to "wind the crown" all the way in.
const CROWN_THRESHOLD = 260;
// A pointer that moved less than this during a drag gesture is a click, not
// a rearrangement — open the book instead of persisting a near-zero move.
const DRAG_CLICK_THRESHOLD = 4;
// M22.6 §D: how close the info strip is allowed to sit to the viewport edge
// before it gets nudged back in.
const EDGE_MARGIN = 8;

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
  /** Owned by `DeskCanvas.tsx`, not this component (M23 §B) — the desk's 3D
   * depth layer follows these same values every frame so it moves with an
   * in-progress drag instead of only updating once it commits. */
  x: MotionValue<number>;
  y: MotionValue<number>;
  /** Written, never read, by this component: how high the 3D layer should
   * float this book, in px above the desk. The gesture lives here (this is
   * the real hit target); how it looks lives in `DeskScene3D.tsx`. */
  lift: MotionValue<number>;
  reducedMotion: boolean;
  cursorStyle: CursorStyleChoice;
  onBringToFront: (resourceId: string) => number;
  onPositionChange: (resourceId: string, next: ShelfState) => void;
  onPublish: (resourceId: string) => void;
  publishing: boolean;
  /** M22 "the desk tool": while lit, a plain open (click, Enter, or the
   * wheel-wound crown) opens the book listening — the explicit "Listen"
   * action in the info strip does this unconditionally regardless. */
  listeningEngaged: boolean;
  /** M23 §B: the desk's 3D depth layer is rendering this book — hide the
   * flat 2D cover image so the tilted 3D one shows through instead. The DOM
   * element stays exactly where it was (opacity only): it's still the real
   * drag/drop hit target and still in the accessibility tree. */
  show3D: boolean;
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
  x,
  y,
  lift,
  reducedMotion,
  cursorStyle,
  onBringToFront,
  onPositionChange,
  onPublish,
  publishing,
  listeningEngaged,
  show3D,
}: BookObjectProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [zOrder, setZOrder] = useState(position.zOrder);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [crownProgress, setCrownProgress] = useState(0);
  const dragDistance = useRef(0);
  const openedRef = useRef(false);
  const coverRef = useRef<HTMLDivElement>(null);
  const infoStripRef = useRef<HTMLDivElement>(null);
  const [edgeShift, setEdgeShift] = useState(0);

  // M22.6 §D: the strip is centred on the book by default (left: 50%,
  // transform: translateX(-50%)), which pushes it off-screen for a book
  // dragged near the desk's left or right edge — nothing clamps drag
  // position today. Measured after it mounts, since centring depends on its
  // own rendered width.
  useEffect(() => {
    if (!isHovering) {
      setEdgeShift(0);
      return;
    }
    const strip = infoStripRef.current;
    if (!strip) return;
    const rect = strip.getBoundingClientRect();
    if (rect.right > window.innerWidth - EDGE_MARGIN) {
      setEdgeShift(window.innerWidth - EDGE_MARGIN - rect.right);
    } else if (rect.left < EDGE_MARGIN) {
      setEdgeShift(EDGE_MARGIN - rect.left);
    } else {
      setEdgeShift(0);
    }
  }, [isHovering]);

  // M23 §B: the same reaction the 2D presentation gets from `whileHover`'s
  // few-px lift and `.lifted`'s deeper shadow, handed to the 3D layer as a
  // real height above a real desk — which is where its shadow then comes from
  // for free. Written unconditionally: it costs nothing when 3D is off, and
  // gating it on `show3D` would leave the value stale at whatever it held
  // when the context was lost.
  useEffect(() => {
    lift.set(isDragging ? BOOK_DRAG_LIFT : isHovering ? BOOK_HOVER_LIFT : 0);
  }, [lift, isDragging, isHovering]);

  function open() {
    if (openedRef.current) return;
    openedRef.current = true;
    // M20.7 "the opening": the same click-time-rect handoff Scan/Digest use
    // (openScan/openDigest below) — the cover's own rect, not the whole
    // draggable book, is what BookOpening.tsx flies from.
    if (coverRef.current) {
      setPendingOverlayOrigin(captureOverlayOrigin(coverRef.current));
    }
    // M22 "the desk tool": while lit, a plain open behaves like the
    // explicit "Listen" action below — the tool is the charm, not a
    // separate gate other opens have to know about.
    navigate(`/read/${resource.id}`, listeningEngaged ? { state: { listenOnOpen: true } } : undefined);
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

  // M21 "Listen" (AUDIO.md: "the tool is the charm, not the gate" — this
  // plain action is the canonical path, same DESIGN.md accessibility rule
  // as everywhere else). Opens the reader room itself (unlike Scan/Digest,
  // it isn't a popup), so it shares `open()`'s origin-capture and its
  // openedRef gate rather than openScan/openDigest's ungated pattern.
  function openListen() {
    if (openedRef.current) return;
    openedRef.current = true;
    if (coverRef.current) {
      setPendingOverlayOrigin(captureOverlayOrigin(coverRef.current));
    }
    navigate(`/read/${resource.id}`, { state: { listenOnOpen: true } });
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
      // M20.7 verify (found live): a real drag followed by an immediate,
      // stationary click left `dragDistance.current` at the previous drag's
      // large value — `onTap` fires on pointerdown/pointerup without ever
      // reaching `handleDragStart` (Framer only calls that once movement
      // clears its own drag-recognition threshold), so the stale value
      // silently failed `< DRAG_CLICK_THRESHOLD` and swallowed the open.
      // Resetting on every pointerdown, not just once a drag is recognized,
      // means each new gesture is measured from zero regardless of which
      // way it resolves.
      onPointerDown={() => {
        dragDistance.current = 0;
      }}
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
      {/* Under 3D the hover lift belongs to the object, not to its hit target
          (see the `lift` effect above). Moving this wrapper as well would
          slide the info strip — its child — a few px out from under the book
          it describes, and shift the rect `layoutId` hands to the opening. */}
      <motion.div
        className={styles.liftWrap}
        whileHover={reducedMotion || show3D ? undefined : { y: -4 }}
        transition={{ type: "spring", stiffness: 420, damping: 30 }}
      >
        <motion.div
          ref={coverRef}
          className={[styles.coverWrap, isDragging ? styles.lifted : "", show3D ? styles.coverWrapIs3D : ""]
            .filter(Boolean)
            .join(" ")}
          layoutId={reducedMotion ? undefined : coverLayoutId(resource.id)}
        >
          {/* M23 §B: while the desk's 3D layer is drawing this book, the
              flat cover art underneath is redundant with (and would double
              up the shadow of) the tilted 3D one — hidden rather than
              unmounted, so the element stays the same size for `layoutId`'s
              doorway transition and stays in the accessibility tree. */}
          <div className={show3D ? styles.coverArtHidden : undefined}>
            <BookCover resourceId={resource.id} title={resource.title} />
          </div>
          {resource.threadCount > 0 && (
            <span className={styles.threadBadge}>{resource.threadCount}</span>
          )}
          {crownProgress > 0 && (
            <div className={styles.crownRing} style={{ opacity: crownProgress }} />
          )}
        </motion.div>
      </motion.div>

      {isHovering && !isDragging && (
        <div
          ref={infoStripRef}
          className={styles.infoStrip}
          role="note"
          style={edgeShift ? { transform: `translateX(calc(-50% + ${edgeShift}px))` } : undefined}
        >
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
          {/* M22.6 §D: the same control system as the reader's own action
              row (ReaderActionsCluster) — IconButton plus the same icon
              components — so a control means the same thing on both
              surfaces (settled decision 12). stopPropagation stays on every
              one: without it the card's own click also opens the book
              (BookObject.tsx's onTap handler), caught live. */}
          <div className={styles.infoActions}>
            <IconButton
              variant="ghost"
              size="sm"
              icon={<BrainIcon size={16} />}
              label="Read digest"
              onClick={(e) => {
                e.stopPropagation();
                openDigest(e);
              }}
            />
            <IconButton
              variant="ghost"
              size="sm"
              icon={<MagnifierIcon size={16} />}
              label="Open scan"
              onClick={(e) => {
                e.stopPropagation();
                openScan(e);
              }}
            />
            <IconButton
              variant="ghost"
              size="sm"
              icon={<PlayIcon size={16} />}
              label="Listen"
              onClick={(e) => {
                e.stopPropagation();
                openListen();
              }}
            />
            <IconButton
              variant="ghost"
              size="sm"
              icon={<PublishIcon size={16} />}
              label={publishing ? "Publishing…" : "Publish"}
              disabled={publishing}
              onClick={(e) => {
                e.stopPropagation();
                onPublish(resource.id);
              }}
            />
          </div>
        </div>
      )}
    </motion.div>
  );
}
