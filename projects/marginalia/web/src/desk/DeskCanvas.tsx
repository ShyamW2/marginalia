import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { CursorStyleChoice, ResourceSummary, ShelfState } from "@marginalia/shared";
import { BookObject } from "./BookObject.js";
import { Notepad } from "./Notepad.js";
import { CursorTrail } from "./CursorTrail.js";
import { useDeskParallax } from "./useDeskParallax.js";
import { defaultShelfState } from "./shelfDefaults.js";
import styles from "./DeskCanvas.module.css";

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
      className={styles.surface}
      style={{ rotateX, rotateY }}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
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
