import { useEffect, useRef, useState, type KeyboardEvent, type WheelEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { motion, type MotionValue, type PanInfo } from "motion/react";
import type { CursorStyleChoice, ResourceSummary, ShelfState } from "@marginalia/shared";
import { captureOverlayOrigin, setPendingOverlayOrigin } from "../controls/overlayOrigin.js";
import { BookCover } from "../library/BookCover.js";
import { coverLayoutId } from "../library/coverLayoutId.js";
import { setPendingOpeningPose, type OpeningPose } from "../scene3d/openingPose.js";
import { reportPutDownDestination, usePutDownRequest } from "../scene3d/putDown.js";
import { preloadReaderPage } from "../reader/preload.js";
import { DwellRing } from "../reader/DwellRing.js";
import { BookActionCard } from "./BookActionCard.js";
import { TOUCH_DWELL_MS, useTouchCardDwell } from "./useTouchCardDwell.js";
import {
  BOOK_BASE_ELEVATION,
  BOOK_DRAG_LIFT,
  BOOK_HOVER_LIFT,
  bookThickness,
} from "./deskDepthMath.js";
import styles from "./BookObject.module.css";

// Total accumulated |wheel delta| needed to "wind the crown" all the way in.
const CROWN_THRESHOLD = 260;
// A pointer that moved less than this during a drag gesture is a click, not
// a rearrangement — open the book instead of persisting a near-zero move.
const DRAG_CLICK_THRESHOLD = 4;

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
  /** M23 §C: where the book's cover is right now, mid-drag, so the desk can
   * light a drop target under it. `null` when the drag ends. This component
   * reports its own rect and knows nothing about what may be under it — the
   * desk owns the targets (`DeskCanvas.tsx`). */
  onDragOver?: (coverRect: DOMRect | null) => void;
  /** Offer the released book to the desk's drop targets. `true` means one took
   * it, and this book is *not* placed here: it is on its way somewhere. */
  onDrop?: (coverRect: DOMRect) => boolean;
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
  onDragOver,
  onDrop,
}: BookObjectProps) {
  const navigate = useNavigate();
  const [zOrder, setZOrder] = useState(position.zOrder);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [crownProgress, setCrownProgress] = useState(0);
  const dragDistance = useRef(0);
  const openedRef = useRef(false);
  const coverRef = useRef<HTMLDivElement>(null);
  const touch = useTouchCardDwell();

  // M33 §A2: touch has no hover, so a completed dwell stands in for it —
  // everything downstream of `isHovering` (the card, the z-index bump, the
  // 3D lift) then just works for touch too, with no separate branch. §A4's
  // drag-disarm is `touch.settled`, kept apart from this because it must
  // stay true even after a later movement toggles `revealed` back off.
  useEffect(() => {
    setIsHovering(touch.revealed);
  }, [touch.revealed]);

  // M23 §B: the same reaction the 2D presentation gets from `whileHover`'s
  // few-px lift and `.lifted`'s deeper shadow, handed to the 3D layer as a
  // real height above a real desk — which is where its shadow then comes from
  // for free. Written unconditionally: it costs nothing when 3D is off, and
  // gating it on `show3D` would leave the value stale at whatever it held
  // when the context was lost.
  useEffect(() => {
    lift.set(isDragging ? BOOK_DRAG_LIFT : isHovering ? BOOK_HOVER_LIFT : 0);
  }, [lift, isDragging, isHovering]);

  /**
   * M20.7 "the opening": the same click-time-rect handoff Scan/Digest use
   * (openScan/openDigest below) — the cover's own rect, not the whole
   * draggable book, is what BookOpening.tsx flies from.
   *
   * M23 §E adds the book's *pose*, which is what lets the opening continue
   * this exact object instead of starting a new one. Dimensions come from
   * `offsetWidth`/`offsetHeight` and only the centre from the rect, because a
   * rotated element's `getBoundingClientRect` is its axis-aligned bounding box
   * — wider and shorter than the book — while its centre is still the book's.
   *
   * ⚠️ The one thing not carried is `stackElevation`'s few px of anti-z-fight
   * lift, which `DeskCanvas.tsx` computes from the whole desk and this
   * component cannot see. It is capped at ~4px of height in a top-down view,
   * where height off the plane costs *no* screen displacement on the optical
   * axis and a fraction of a px away from it.
   */
  /** The pose math alone, reused by `captureOpening` below (click time) and
   * by the M33 §C put-down's own report effect (mount time, once this book
   * is the one a departing reader is looking for) — one seam computing this
   * book's pose, not two copies that can drift. */
  function buildPose(): OpeningPose | null {
    if (!coverRef.current) return null;
    const el = coverRef.current;
    const rect = el.getBoundingClientRect();
    const thickness = bookThickness(resource.id);
    return {
      surface: "desk",
      width: el.offsetWidth,
      height: el.offsetHeight,
      thickness,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      // The book's own centre, not its footprint: it rests on the desk, so
      // half its thickness is above the plane it rests on.
      centerZ: BOOK_BASE_ELEVATION + lift.get() + thickness / 2,
      yaw: 0,
      // A CSS rotation is clockwise on screen; a positive rotation about the
      // axis pointing at the viewer is counter-clockwise. `DeskScene3D` negates
      // the same value for the same reason.
      roll: -(position.rotation * Math.PI) / 180,
    };
  }

  function captureOpening() {
    const pose = buildPose();
    if (!pose || !coverRef.current) return;
    setPendingOverlayOrigin(captureOverlayOrigin(coverRef.current));
    setPendingOpeningPose(pose);
  }

  // M33 §C3: "the destination comes from the Desk after it mounts" — this
  // book answers a put-down in progress the instant it has a real rect to
  // offer, the mirror of `captureOpening`'s click-time capture above. Guarded
  // on `!putDown.destination` so the first surface to lay this book out wins
  // (only one of Desk/shelf/list is ever mounted for a given resource at
  // once, so this is a safety net against a double report, not a real race).
  const putDown = usePutDownRequest();
  useEffect(() => {
    if (putDown.resourceId !== resource.id || putDown.destination || !coverRef.current) return;
    const pose = buildPose();
    if (!pose) return;
    reportPutDownDestination(resource.id, {
      origin: captureOverlayOrigin(coverRef.current),
      pose,
    });
    // `buildPose`/`position`/`lift` are all read fresh inside the effect body
    // and `resource.id` covers the one thing that actually needs to retrigger
    // this — a new put-down request naming a different (or the same) book.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [putDown.resourceId, putDown.destination]);

  function open() {
    if (openedRef.current) return;
    openedRef.current = true;
    captureOpening();
    // M22 "the desk tool": while lit, a plain open behaves like the
    // explicit "Listen" action below — the tool is the charm, not a
    // separate gate other opens have to know about.
    navigate(`/read/${resource.id}`, listeningEngaged ? { state: { listenOnOpen: true } } : undefined);
  }

  // M21 "Listen" (AUDIO.md: "the tool is the charm, not the gate" — this
  // plain action is the canonical path, same DESIGN.md accessibility rule
  // as everywhere else). Opens the reader room itself (unlike Scan/Digest,
  // it isn't a popup), so it shares `open()`'s origin-capture and its
  // openedRef gate rather than openScan/openDigest's ungated pattern.
  // Also the landing for M23 §C's turntable drop, which is why it stays here
  // rather than moving into `BookActionCard` with the other three actions.
  function openListen() {
    if (openedRef.current) return;
    openedRef.current = true;
    captureOpening();
    navigate(`/read/${resource.id}`, { state: { listenOnOpen: true } });
  }

  function handleDragStart() {
    dragDistance.current = 0;
    setIsDragging(true);
    setZOrder(onBringToFront(resource.id));
  }

  function handleDrag(_event: unknown, info: PanInfo) {
    dragDistance.current += Math.abs(info.delta.x) + Math.abs(info.delta.y);
    // The *cover's* rect, not the whole draggable element's: the cover is the
    // book, and the element around it carries the hover info strip.
    if (coverRef.current) onDragOver?.(coverRef.current.getBoundingClientRect());
  }

  function handleDragEnd() {
    setIsDragging(false);
    onDragOver?.(null);
    if (dragDistance.current < DRAG_CLICK_THRESHOLD) {
      open();
      return;
    }
    // M23 §C: offered to the desk's drop targets before it is placed. A book
    // dropped on the turntable is being *played*, not arranged, so its shelf
    // position stays where it was — nothing is persisted on this path, and
    // coming back from the reader finds the book where it was left.
    if (coverRef.current && onDrop?.(coverRef.current.getBoundingClientRect())) {
      openListen();
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
      // §A4: once a touch has settled into a long-press (the card has been
      // out at least once this touch), drag stays off for the rest of it —
      // even after a later movement dismisses the card again — so it never
      // resumes dragging out from under a card the reader is about to tap.
      drag={!reducedMotion && !touch.settled}
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
      onPointerDown={(event) => {
        dragDistance.current = 0;
        touch.onPointerDown(event);
      }}
      onPointerMove={touch.onPointerMove}
      onPointerUp={touch.onPointerUp}
      onPointerCancel={touch.onPointerCancel}
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
      onPointerEnter={(event) => {
        // §A1: unfiltered, a touchscreen tap fires this (the card appears)
        // *and* `onTap` (the book opens) — the card flashes and is gone.
        // Touch earns the card from `useTouchCardDwell` instead (§A2).
        if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
        setIsHovering(true);
        // The room this book opens into, fetched while the pointer is still on
        // it — see `preloadReaderPage` for the gap this closes.
        void preloadReaderPage();
      }}
      onFocus={() => void preloadReaderPage()}
      onPointerLeave={(event) => {
        if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
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
        <BookActionCard
          resource={resource}
          publishing={publishing}
          onPublish={onPublish}
          openOriginRef={coverRef}
          onCaptureOpening={captureOpening}
        />
      )}

      {/* §A3: portaled — `position: fixed` would otherwise resolve against
          this element's own `transform` (framer's x/y/rotate), not the
          viewport, since a transformed ancestor is a containing block for
          fixed descendants. */}
      {touch.dwellRing &&
        createPortal(
          <DwellRing
            key={touch.dwellRing.key}
            x={touch.dwellRing.x}
            y={touch.dwellRing.y}
            durationMs={TOUCH_DWELL_MS}
            refused={false}
          />,
          document.body,
        )}
    </motion.div>
  );
}
