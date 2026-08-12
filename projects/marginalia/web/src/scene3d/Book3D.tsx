import { useEffect, useMemo } from "react";
import { MeshStandardMaterial } from "three";
import { useCoverTexture } from "./useCoverTexture.js";

// A real cover doesn't swing to a flat 180° against the desk.
const MAX_OPEN_ANGLE = Math.PI * 0.82;

const PAGE_BLOCK_COLOR = "#f2ead9";
const SPINE_COLOR = "#8a5a3b";
const COVER_EDGE_COLOR = "#6b6259";
const FALLBACK_COVER_COLOR = "#c9b8a0";

// Shared across every mounted book: flat-color faces never differ per book,
// so there is no reason to allocate a material per instance — a shelf holds
// dozens of these at once (M23 §D).
const edgeMaterial = new MeshStandardMaterial({ color: COVER_EDGE_COLOR });
const pageBlockMaterial = new MeshStandardMaterial({ color: PAGE_BLOCK_COLOR });
const spineMaterial = new MeshStandardMaterial({ color: SPINE_COLOR });
const fallbackCoverMaterial = new MeshStandardMaterial({ color: FALLBACK_COVER_COLOR });

export interface Book3DProps {
  resourceId: string;
  /** Scene units, cover-forward (BookCover.module.css's 2:3 aspect by default). */
  width?: number;
  height?: number;
  thickness?: number;
  /** 0 = closed, 1 = open to `MAX_OPEN_ANGLE`. Default closed. */
  openProgress?: number;
}

/**
 * M23 §A: the one book object — cover, spine, page block and an openable
 * front cover, authored once for the Desk, the shelf and the opening to
 * share (settled decision 14). A missing cover falls back to a plain face,
 * mirroring `BookCover.tsx`'s own onError contract, rather than a broken or
 * blank texture.
 *
 * Local space: the spine is the y-axis at x=0, the book extends to x=width,
 * height along y, thickness along z with the cover's outward face toward
 * +z. A consumer rotates and positions the whole group to lay it flat on
 * the Desk, stand it upright on the shelf, or swing its cover as it opens —
 * this component doesn't know which surface it's on.
 */
export function Book3D({ resourceId, width = 1, height = 1.5, thickness = 0.12, openProgress = 0 }: Book3DProps) {
  const texture = useCoverTexture(resourceId);

  const coverMaterial = useMemo(
    () => (texture ? new MeshStandardMaterial({ map: texture }) : fallbackCoverMaterial),
    [texture],
  );

  // The per-texture material above isn't JSX-owned (it's attached via
  // `<primitive>`), so React Three Fiber's usual auto-dispose-on-unmount
  // doesn't cover it — a shelf that scrolls dozens of these in and out
  // would otherwise leak one GPU program per book. Never dispose the shared
  // fallback instance.
  useEffect(() => {
    return () => {
      if (coverMaterial !== fallbackCoverMaterial) coverMaterial.dispose();
    };
  }, [coverMaterial]);

  const coverThickness = thickness * 0.15;
  const pageThickness = thickness - coverThickness;
  const angle = -openProgress * MAX_OPEN_ANGLE;

  return (
    <group name={`book-${resourceId}`}>
      <mesh position={[width / 2, 0, -coverThickness / 2]} castShadow receiveShadow>
        <boxGeometry args={[width, height, pageThickness]} />
        <primitive object={pageBlockMaterial} attach="material" />
      </mesh>
      <mesh position={[coverThickness / 2, 0, -thickness / 2]}>
        <boxGeometry args={[coverThickness, height, thickness]} />
        <primitive object={spineMaterial} attach="material" />
      </mesh>
      {/* The front cover: hinged at the spine (local x = 0). */}
      <group position={[0, 0, thickness / 2 - coverThickness / 2]} rotation={[0, angle, 0]}>
        <mesh key={coverMaterial.uuid} position={[width / 2, 0, 0]} castShadow>
          <boxGeometry args={[width, height, coverThickness]} />
          <primitive object={edgeMaterial} attach="material-0" />
          <primitive object={edgeMaterial} attach="material-1" />
          <primitive object={edgeMaterial} attach="material-2" />
          <primitive object={edgeMaterial} attach="material-3" />
          <primitive object={coverMaterial} attach="material-4" />
          <primitive object={edgeMaterial} attach="material-5" />
        </mesh>
      </group>
    </group>
  );
}
