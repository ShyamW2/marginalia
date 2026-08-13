import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { motion, motionValue, type MotionValue } from "motion/react";
import type { CursorStyleChoice, ResourceSummary, ShelfState } from "@marginalia/shared";
import { useScene3DAvailable, useScene3DLayer } from "../scene3d/Scene3D.js";
import { BookObject } from "./BookObject.js";
import { Notepad } from "./Notepad.js";
import { CursorTrail } from "./CursorTrail.js";
import { ListeningTool } from "./ListeningTool.js";
import { useDeskParallax } from "./useDeskParallax.js";
import { defaultShelfState } from "./shelfDefaults.js";
import { DeskScene3D, type DeskBookPlacement } from "./DeskScene3D.js";
import { isOverPlatter } from "./turntableMath.js";
import styles from "./DeskCanvas.module.css";

// BookCover.module.css fixes the cover at 168px wide, 2:3 — a book's own
// footprint, independent of where it's dragged.
const BOOK_CARD_HEIGHT = 168 * 1.5;
// Room below the lowest book for its hover info strip plus a margin that
// echoes shelfDefaults.ts's own 32px edge padding.
const CONTENT_BOTTOM_PADDING = 160;

interface DeskCanvasProps {
  resources: ResourceSummary[];
  reducedMotion: boolean;
  cursorStyle: CursorStyleChoice;
  cursorTrailEnabled: boolean;
  publishingId: string | null;
  onPublish: (resourceId: string) => void;
  onToast: (toast: { message: string; tone: "success" | "error" }) => void;
  /** M22 "the desk tool": while engaged, a plain click on a book opens it
   * listening instead of reading. */
  listeningEngaged: boolean;
  onToggleListening: () => void;
}

/**
 * The Desk's freeform workspace (DESIGN.md "Room 1"): books as
 * cover-forward draggable objects on a tiltable surface, plus the notepad
 * and the ambient cursor trail. Position/z-order live in React state,
 * seeded from persisted `shelf` values (or a deterministic default for a
 * book that's never been arranged) and written back on drag end.
 */
export function DeskCanvas({
  resources,
  reducedMotion,
  cursorStyle,
  cursorTrailEnabled,
  publishingId,
  onPublish,
  onToast,
  listeningEngaged,
  onToggleListening,
}: DeskCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tiltLayerRef = useRef<HTMLDivElement>(null);
  const turntableRef = useRef<HTMLButtonElement>(null);
  const [positions, setPositions] = useState<Record<string, ShelfState>>({});
  // M23 §C: a book is currently over the turntable. Owned here rather than in
  // `BookObject` because the *desk* knows what its drop targets are — a book
  // only ever reports where it is.
  const [dropOnTurntable, setDropOnTurntable] = useState(false);
  const zCounter = useRef(0);
  const show3D = useScene3DAvailable();
  // ⚠️ The ambient CSS parallax is a *2D* effect on this DOM subtree, and the
  // 3D camera does not share it. Left on alongside 3D it rotates every book's
  // real hit target a degree or two away from the object drawn for it — small
  // at rest, worst at the corners, and exactly the DOM/3D disagreement the
  // 1:1 desk plane exists to prevent. The 3D presentation earns its depth from
  // the camera instead, so the tilt is the 2D presentation's alone.
  const { rotateX, rotateY, onPointerMove, onPointerLeave } = useDeskParallax(!reducedMotion && !show3D);

  // M23 §B: one motion-value bundle per book, owned here rather than inside
  // `BookObject` so the desk's 3D depth layer (`DeskScene3D.tsx`) can read the
  // same live values every frame and follow an in-progress drag — if each
  // `BookObject` kept its own via `useMotionValue`, the 3D layer would have no
  // way to see a drag before it commits to `positions` state. `lift` carries
  // the hover/drag gesture the same way: the DOM owns the gesture, the 3D
  // object owns how it looks.
  const motionValues = useRef(
    new Map<string, { x: MotionValue<number>; y: MotionValue<number>; lift: MotionValue<number> }>(),
  ).current;

  // Books are absolutely positioned, so they never contribute to the
  // surface's natural height — without this, arranging enough books to
  // fill more than a viewport's worth of rows would silently clip under
  // the surface's `overflow: hidden` instead of growing so the page can
  // scroll to them (TASKS.md M20.7 "size it to the viewport with room to
  // scroll"). Fed to DeskCanvas.module.css as `--desk-content-height`.
  const contentHeight = useMemo(() => {
    const maxBottom = Object.values(positions).reduce(
      (max, position) => Math.max(max, position.y + BOOK_CARD_HEIGHT),
      0,
    );
    return maxBottom + CONTENT_BOTTOM_PADDING;
  }, [positions]);

  useEffect(() => {
    setPositions((prev) => {
      const next = { ...prev };
      resources.forEach((resource, index) => {
        if (!next[resource.id]) {
          next[resource.id] = resource.shelf ?? defaultShelfState(resource.id, index);
        }
      });
      for (const id of Object.keys(next)) {
        if (!resources.some((r) => r.id === id)) delete next[id];
      }
      return next;
    });
    const maxZ = resources.reduce((max, resource, index) => {
      const z = (resource.shelf ?? defaultShelfState(resource.id, index)).zOrder;
      return Math.max(max, z);
    }, 0);
    zCounter.current = Math.max(zCounter.current, maxZ);

    // Keep the motion-value map in step with the resource list — a plain
    // side effect, not folded into the `setPositions` updater above, since
    // that updater must stay pure (React may invoke it more than once).
    const activeIds = new Set(resources.map((r) => r.id));
    resources.forEach((resource, index) => {
      if (motionValues.has(resource.id)) return;
      const seed = resource.shelf ?? defaultShelfState(resource.id, index);
      motionValues.set(resource.id, { x: motionValue(seed.x), y: motionValue(seed.y), lift: motionValue(0) });
    });
    for (const id of motionValues.keys()) {
      if (!activeIds.has(id)) motionValues.delete(id);
    }
  }, [resources, motionValues]);

  function bringToFront(resourceId: string): number {
    zCounter.current += 1;
    const z = zCounter.current;
    setPositions((prev) => ({
      ...prev,
      [resourceId]: { ...prev[resourceId], zOrder: z },
    }));
    return z;
  }

  function persistPosition(resourceId: string, next: ShelfState) {
    setPositions((prev) => ({ ...prev, [resourceId]: next }));
    fetch(`/api/resources/${resourceId}/shelf`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    }).catch(() => {
      // best-effort — the next reload falls back to the deterministic default
    });
  }

  /** Is a book's cover, right now, over the turntable's platter? */
  const overTurntable = useCallback((coverRect: DOMRect | null): boolean => {
    const tool = turntableRef.current?.getBoundingClientRect();
    return !!coverRect && !!tool && isOverPlatter(coverRect, tool);
  }, []);

  const handleDragOver = useCallback(
    (coverRect: DOMRect | null) => {
      // Called on every frame of a drag, so it must not re-render on every
      // frame of a drag.
      const over = overTurntable(coverRect);
      setDropOnTurntable((prev) => (prev === over ? prev : over));
    },
    [overTurntable],
  );

  const handleDrop = useCallback(
    (coverRect: DOMRect) => {
      setDropOnTurntable(false);
      return overTurntable(coverRect);
    },
    [overTurntable],
  );

  const deskBooks: DeskBookPlacement[] = useMemo(
    () =>
      resources.flatMap((resource) => {
        const position = positions[resource.id];
        const values = motionValues.get(resource.id);
        if (!position || !values) return [];
        return [
          {
            resourceId: resource.id,
            title: resource.title,
            rotationDeg: position.rotation,
            zOrder: position.zOrder,
            ...values,
          },
        ];
      }),
    [resources, positions, motionValues],
  );
  const deskSceneNode = useMemo(
    () => (
      <DeskScene3D
        books={deskBooks}
        deskRef={tiltLayerRef}
        turntable={{ toolRef: turntableRef, engaged: listeningEngaged, dropActive: dropOnTurntable }}
      />
    ),
    [deskBooks, listeningEngaged, dropOnTurntable],
  );
  useScene3DLayer("desk", deskSceneNode);

  return (
    <motion.div
      ref={containerRef}
      className={[styles.surface, cursorStyle === "system" ? styles.systemCursor : "", show3D ? styles.surfaceIs3D : ""]
        .filter(Boolean)
        .join(" ")}
      style={{ rotateX, rotateY, "--desk-content-height": `${contentHeight}px` } as CSSProperties}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      {!show3D && <div className={styles.grain} aria-hidden="true" />}
      <div className={styles.tiltLayer} ref={tiltLayerRef}>
        {resources.map((resource) => {
          const position = positions[resource.id];
          const values = motionValues.get(resource.id);
          if (!position || !values) return null;
          return (
            <BookObject
              key={resource.id}
              resource={resource}
              position={position}
              x={values.x}
              y={values.y}
              lift={values.lift}
              reducedMotion={reducedMotion}
              cursorStyle={cursorStyle}
              onBringToFront={bringToFront}
              onPositionChange={persistPosition}
              onPublish={onPublish}
              publishing={publishingId === resource.id}
              listeningEngaged={listeningEngaged}
              show3D={show3D}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            />
          );
        })}
        <Notepad onToast={onToast} />
        <ListeningTool
          toolRef={turntableRef}
          engaged={listeningEngaged}
          onToggle={onToggleListening}
          show3D={show3D}
          dropActive={dropOnTurntable}
        />
      </div>
      <CursorTrail containerRef={containerRef} enabled={cursorTrailEnabled && !reducedMotion} />
    </motion.div>
  );
}
