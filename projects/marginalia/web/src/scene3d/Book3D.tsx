import { useEffect, useMemo } from "react";
import { MeshStandardMaterial } from "three";
import { spineArc, spineBulge } from "./bookGeometry.js";
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
const edgeMaterial = new MeshStandardMaterial({ color: COVER_EDGE_COLOR, roughness: 0.8 });
const pageBlockMaterial = new MeshStandardMaterial({ color: PAGE_BLOCK_COLOR, roughness: 0.95 });
const spineMaterial = new MeshStandardMaterial({ color: SPINE_COLOR, roughness: 0.7 });
const fallbackCoverMaterial = new MeshStandardMaterial({ color: FALLBACK_COVER_COLOR, roughness: 0.7 });

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
 * M23 §A: the one book object — boards, spine, page block and an openable
 * front cover, authored once for the Desk, the shelf and the opening to
 * share (settled decision 14). A missing cover falls back to a plain face,
 * mirroring `BookCover.tsx`'s own onError contract, rather than a broken or
 * blank texture.
 *
 * Local space: the spine is the y-axis at **x = 0**, the book extends to
 * x = width, height runs along y **centred on 0**, and thickness runs along z
 * **centred on 0** — so the solid occupies `z ∈ [-thickness/2, +thickness/2]`
 * and the front cover's outward face is at `+thickness/2`. A consumer rotates
 * and positions the whole group to lay it flat on the Desk, stand it upright
 * on the shelf, or swing its cover as it opens; this component doesn't know
 * which surface it's on.
 *
 * ⚠️ The book fills `x ∈ [0, width]` exactly, and nothing may hang outside it:
 * on the Desk that span *is* the DOM hit target (`desk/deskDepthMath.ts`). The
 * round back therefore takes its `bulge` out of the covers, which span
 * `[bulge, width]`, rather than adding it outside the footprint.
 *
 * ⚠️ Centred on z since M23 §B's rework. It previously hung *below* its own
 * origin — the spine box alone reached a full thickness past the back board —
 * so a consumer that laid the book on a surface at its origin buried most of
 * it under that surface. A book that is not the solid its bounds claim is a
 * bug in every consumer at once, which is the whole reason this is one asset.
 */
export function Book3D({ resourceId, width = 1, height = 1.5, thickness = 0.12, openProgress = 0 }: Book3DProps) {
  const texture = useCoverTexture(resourceId);

  const coverMaterial = useMemo(
    () => (texture ? new MeshStandardMaterial({ map: texture, roughness: 0.62 }) : fallbackCoverMaterial),
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

  const boardThickness = Math.max(thickness * 0.09, 0.008 * width);
  const blockThickness = Math.max(thickness - boardThickness * 2, thickness * 0.35);
  // The round back, and the hinge line the boards start at. See
  // `bookGeometry.ts` for why the spine is a curve and not the box it was.
  const bulge = spineBulge(width, thickness);
  const arc = spineArc(thickness, bulge);
  const boardWidth = width - bulge;
  // Pages sit a hair inside the boards on the three cut edges and flush at
  // the spine — the overhang is most of what makes a closed book read as a
  // bound object rather than a slab.
  const pageInset = width * 0.022;
  const pageWidth = boardWidth - pageInset;
  const pageHeight = height - pageInset * 2;
  const angle = -openProgress * MAX_OPEN_ANGLE;

  return (
    <group name={`book-${resourceId}`}>
      {/* Back board. */}
      <mesh position={[bulge + boardWidth / 2, 0, -thickness / 2 + boardThickness / 2]} castShadow receiveShadow>
        <boxGeometry args={[boardWidth, height, boardThickness]} />
        <primitive object={edgeMaterial} attach="material" />
      </mesh>

      {/* Page block. */}
      <mesh position={[bulge + pageWidth / 2, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[pageWidth, pageHeight, blockThickness]} />
        <primitive object={pageBlockMaterial} attach="material" />
      </mesh>

      {/* The round back, closing the book from one board's outer corner to the
          other's. Its end caps run a half-unit past head and tail rather than
          flush with them: flush would put the caps in the boards' own end
          planes facing the same way, which is the tie this curve exists to
          avoid. Half a unit is a half *pixel* on the Desk — under the
          antialiasing, and four orders of magnitude more depth separation than
          the buffer needs at this camera distance. */}
      <mesh position={[arc.centerX, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[arc.radius, arc.radius, height + 1, 32, 1, false, arc.thetaStart, arc.thetaLength]} />
        <primitive object={spineMaterial} attach="material" />
      </mesh>

      {/* The front board: hinged at the spine's joint (local x = bulge), cover
          art on its outward (+z) face. */}
      <group position={[bulge, 0, thickness / 2 - boardThickness / 2]} rotation={[0, angle, 0]}>
        {/* Keyed on the material's uuid: R3F's `attach="material-4"` binding
            was seen reconciling in place across sibling fibers whose textures
            resolved at different times, landing one book's cover on another's
            mesh (M23 §B, NOTES.md). A remount on identity change sidesteps
            whatever that reconciliation was doing. */}
        <mesh key={coverMaterial.uuid} position={[boardWidth / 2, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[boardWidth, height, boardThickness]} />
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
