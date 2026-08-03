import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { motion } from "motion/react";
import type { CursorStyleChoice, ResourceSummary, ShelfState } from "@marginalia/shared";
import { BookObject } from "./BookObject.js";
import { Notepad } from "./Notepad.js";
import { CursorTrail } from "./CursorTrail.js";
import { useDeskParallax } from "./useDeskParallax.js";
import { defaultShelfState } from "./shelfDefaults.js";
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
}: DeskCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<Record<string, ShelfState>>({});
  const zCounter = useRef(0);
  const { rotateX, rotateY, onPointerMove, onPointerLeave } = useDeskParallax(!reducedMotion);

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
  }, [resources]);

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

  return (
    <motion.div
      ref={containerRef}
      className={cursorStyle === "system" ? `${styles.surface} ${styles.systemCursor}` : styles.surface}
      style={{ rotateX, rotateY, "--desk-content-height": `${contentHeight}px` } as CSSProperties}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <div className={styles.grain} aria-hidden="true" />
      <div className={styles.tiltLayer}>
        {resources.map((resource) => {
          const position = positions[resource.id];
          if (!position) return null;
          return (
            <BookObject
              key={resource.id}
              resource={resource}
              position={position}
              reducedMotion={reducedMotion}
              cursorStyle={cursorStyle}
              onBringToFront={bringToFront}
              onPositionChange={persistPosition}
              onPublish={onPublish}
              publishing={publishingId === resource.id}
            />
          );
        })}
        <Notepad onToast={onToast} />
      </div>
      <CursorTrail containerRef={containerRef} enabled={cursorTrailEnabled && !reducedMotion} />
    </motion.div>
  );
}
