import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { motionValue, type MotionValue } from "motion/react";
import type { ResourceSummary } from "@marginalia/shared";
import { captureOverlayOrigin, setPendingOverlayOrigin } from "../controls/overlayOrigin.js";
import { useScene3DAvailable, useScene3DLayer } from "../scene3d/Scene3D.js";
import { useSpinePalette } from "../scene3d/useSpinePalette.js";
import { BookActionCard } from "./BookActionCard.js";
import { ShelfScene3D, type ShelfBookPlacement } from "./ShelfScene3D.js";
import { SHELF_HOVER_LIFT, layoutShelf, type ShelfSlot } from "./shelfLayout.js";
import styles from "./ShelfView.module.css";

/** Clear space above the tallest book, where the action card floats. Sized for
 * the card at its tallest (a long title wrapping to two lines over four
 * actions) so it never has to flip to the other side of the book. */
const CARD_HEADROOM = 178;
/** How much of the plank shows below the books. */
const PLANK_HEADROOM = 54;

interface ShelfViewProps {
  resources: ResourceSummary[];
  publishingId: string | null;
  onPublish: (resourceId: string) => void;
  /** M22 "the desk tool": while lit, a plain open opens the book listening —
   * the same rule the Desk's own books follow. */
  listeningEngaged: boolean;
}

/**
 * M23 §D: the shelf — a third way of looking at the library, alongside the
 * Desk (`d`) and the list (`l`), on `b`.
 *
 * ⚠️ **It is a third view, never a replacement.** `LibraryGrid` remains the
 * library's accessibility floor (settled decision 15, DESIGN.md:67-68). This
 * surface still owes its own keyboard path — every book is a real focusable
 * control, focus lifts the book and opens its card exactly as hover does, and
 * with 3D off (reduced motion, or a lost context) the same elements render as
 * flat CSS spines rather than as nothing at all.
 *
 * The DOM owns the row and the 3D layer follows it: books are absolutely
 * positioned in a scrolling strip, and `ShelfScene3D` reads that strip's live
 * rect every frame. Scrolling is therefore free and exact — the browser moves
 * the strip, the scene lands on it the same frame, and no scroll offset is
 * duplicated into React state where it could lag behind momentum.
 */
export function ShelfView({ resources, publishingId, onPublish, listeningEngaged }: ShelfViewProps) {
  const navigate = useNavigate();
  const railRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const slotRefs = useRef(new Map<string, HTMLElement>()).current;
  const [railWidth, setRailWidth] = useState(0);
  // Hovered *or* focused — the shelf makes no distinction, which is the whole
  // of TASKS.md §D's "from keyboard focus, not hover alone".
  const [activeId, setActiveId] = useState<string | null>(null);
  const show3D = useScene3DAvailable();

  // One lift value per book, owned here rather than inside the slot so the 3D
  // layer can read the same live value every frame — the same split the Desk
  // uses (`DeskCanvas.tsx`): the DOM owns the gesture, the 3D object owns how
  // it looks.
  const lifts = useRef(new Map<string, MotionValue<number>>()).current;

  const row = useMemo(
    () => layoutShelf(resources.map((r) => r.id), railWidth),
    [resources, railWidth],
  );

  useEffect(() => {
    const active = new Set(resources.map((r) => r.id));
    for (const resource of resources) {
      if (!lifts.has(resource.id)) lifts.set(resource.id, motionValue(0));
    }
    for (const id of lifts.keys()) if (!active.has(id)) lifts.delete(id);
  }, [resources, lifts]);

  useEffect(() => {
    for (const [id, lift] of lifts) lift.set(id === activeId ? SHELF_HOVER_LIFT : 0);
  }, [activeId, lifts]);

  // The strip's minimum width is its container's, so a short library still
  // lays a plank across the whole room instead of a huddle of books at the
  // left. Measured rather than assumed: the room is inside the Desk page's own
  // padding, not the viewport.
  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const observer = new ResizeObserver(([entry]) => setRailWidth(entry.contentRect.width));
    observer.observe(rail);
    setRailWidth(rail.clientWidth);
    return () => observer.disconnect();
  }, []);

  // A horizontal rail that only answers a horizontal wheel is a rail most
  // mice cannot scroll at all. Registered by hand because React's own wheel
  // listener is passive, and this one has to be able to claim the gesture.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    function onWheel(event: WheelEvent) {
      const el = railRef.current;
      if (!el || event.ctrlKey) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      el.scrollLeft += event.deltaY;
      event.preventDefault();
    }
    rail.addEventListener("wheel", onWheel, { passive: false });
    return () => rail.removeEventListener("wheel", onWheel);
  }, []);

  const open = useCallback(
    (resource: ResourceSummary) => {
      const el = slotRefs.get(resource.id);
      // The opening flies from the book's own spine — the thing that was
      // actually clicked (M20.7's click-time-rect handoff).
      if (el) setPendingOverlayOrigin(captureOverlayOrigin(el));
      navigate(`/read/${resource.id}`, listeningEngaged ? { state: { listenOnOpen: true } } : undefined);
    },
    [navigate, listeningEngaged, slotRefs],
  );

  const placements: ShelfBookPlacement[] = useMemo(
    () =>
      row.slots.flatMap((slot) => {
        const resource = resources.find((r) => r.id === slot.resourceId);
        const lift = lifts.get(slot.resourceId);
        if (!resource || !lift) return [];
        return [{ slot, title: resource.title, lift }];
      }),
    [row.slots, resources, lifts],
  );

  const baseline = CARD_HEADROOM + row.tallest;
  const deepest = row.slots.reduce((max, slot) => Math.max(max, slot.depth), 0);
  const sceneNode = useMemo(
    () =>
      placements.length > 0 ? (
        <ShelfScene3D books={placements} stripRef={stripRef} baseline={baseline} deepest={deepest} />
      ) : null,
    [placements, baseline, deepest],
  );
  useScene3DLayer("shelf", sceneNode);

  if (resources.length === 0) return null;

  return (
    <div className={styles.room}>
      <div className={styles.rail} ref={railRef}>
        <div
          className={styles.strip}
          ref={stripRef}
          style={{ width: row.width, height: baseline + PLANK_HEADROOM }}
        >
          {/* Only when there is no 3D plank to stand on. */}
          {!show3D && <div className={styles.plank} style={{ top: baseline }} aria-hidden="true" />}
          {row.slots.map((slot) => {
            const resource = resources.find((r) => r.id === slot.resourceId);
            if (!resource) return null;
            return (
              <ShelfBook
                key={slot.resourceId}
                slot={slot}
                resource={resource}
                baseline={baseline}
                active={activeId === slot.resourceId}
                show3D={show3D}
                publishing={publishingId === slot.resourceId}
                onPublish={onPublish}
                onActivate={() => open(resource)}
                onActiveChange={(isActive) =>
                  setActiveId((prev) => (isActive ? slot.resourceId : prev === slot.resourceId ? null : prev))
                }
                registerRef={(el) => {
                  if (el) slotRefs.set(slot.resourceId, el);
                  else slotRefs.delete(slot.resourceId);
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ShelfBook({
  slot,
  resource,
  baseline,
  active,
  show3D,
  publishing,
  onPublish,
  onActivate,
  onActiveChange,
  registerRef,
}: {
  slot: ShelfSlot;
  resource: ResourceSummary;
  baseline: number;
  active: boolean;
  show3D: boolean;
  publishing: boolean;
  onPublish: (resourceId: string) => void;
  onActivate: () => void;
  onActiveChange: (active: boolean) => void;
  registerRef: (el: HTMLElement | null) => void;
}) {
  // Mutable rather than `useRef<T>(null)`: this element is both scrolled into
  // view from here and handed to `BookActionCard` as the rect the opening
  // flies from, so the ref is written by the callback below rather than by
  // React's own `ref` binding.
  const ref = useRef<HTMLDivElement | null>(null);
  // The same binding the 3D book is dyed with, so the flat presentation is the
  // same book rather than a grey stand-in for it. A hook from the seam
  // returning plain colour strings — no three.js type crosses into this
  // component (settled decision 14).
  const palette = useSpinePalette(slot.resourceId);

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onActivate();
    }
  }

  return (
    <div
      ref={(el) => {
        ref.current = el;
        registerRef(el);
      }}
      className={[styles.slot, active ? styles.lifted : ""].filter(Boolean).join(" ")}
      style={{
        left: slot.left,
        top: baseline - slot.height,
        width: slot.width,
        height: slot.height,
      }}
      role="link"
      tabIndex={0}
      aria-label={`Open ${resource.title}`}
      onClick={(event) => {
        // The card's own buttons live inside this element; without this its
        // actions would each also open the book (the same guard the Desk's
        // `onTap` carries).
        if (event.target instanceof Element && event.target.closest("button")) return;
        onActivate();
      }}
      onKeyDown={handleKeyDown}
      onPointerEnter={() => onActiveChange(true)}
      onPointerLeave={() => onActiveChange(false)}
      onFocus={() => {
        onActiveChange(true);
        // Tabbing to a book off the end of the rail has to bring it into the
        // room, or the keyboard path walks into books nobody can see.
        ref.current?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
      }}
      onBlur={(event) => {
        // Focus moving *into* the card (its four actions are children) is not
        // leaving the book.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        onActiveChange(false);
      }}
    >
      <div
        className={[styles.spine, show3D ? styles.spineIs3D : ""].filter(Boolean).join(" ")}
        // Type scaled off the spine's own width, the same rule
        // `spineLayout.ts` applies to the 3D lettering — a fatter book letters
        // its title larger on both presentations.
        style={{
          background: palette.binding,
          color: palette.ink,
          fontSize: `${Math.max(10, Math.round(slot.width * 0.34))}px`,
        }}
        aria-hidden="true"
      >
        <span className={styles.spineTitle}>{resource.title}</span>
      </div>
      {active && (
        <BookActionCard
          resource={resource}
          publishing={publishing}
          onPublish={onPublish}
          placement="above"
          openOriginRef={ref}
        />
      )}
    </div>
  );
}
