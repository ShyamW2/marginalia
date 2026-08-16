import { useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { Group } from "three";
import type { MotionValue } from "motion/react";
import { Book3D } from "../scene3d/Book3D.js";
import { CameraRig } from "../scene3d/CameraRig.js";
import { FrontKeyLight } from "../scene3d/FrontKeyLight.js";
import { useThemeColor } from "../scene3d/useThemeColor.js";
import { DESK_CAMERA_UP, deskViewFrame } from "../desk/deskDepthMath.js";
import { shelfViewFrame } from "../desk/shelfLayout.js";
import type { OpeningPose } from "../scene3d/openingPose.js";
import {
  flattenTowardPane,
  landingStep,
  lerpToLanding,
  openingStep,
  type OpeningStep,
  type Rect,
} from "./openingGeometry.js";

/** The board lies flat: the opening is the one caller that opens a book past
 * the 148° a cover reaches against a page block, because the flat spread *is*
 * what it is revealing. */
const FLAT = Math.PI;

/** `--color-bg`'s value if the stylesheet hasn't applied yet — the reader's
 * paper in the Paper theme. */
const PAPER_FALLBACK = "#fbf8f1";

export interface BookOpening3DProps {
  pose: OpeningPose;
  resourceId: string;
  title: string;
  /** 0 → 1 across travel/open/recentre, driven by `BookOpening.tsx`. Read every
   * frame rather than held in state: the DOM owns the sequence, the object owns
   * how it looks — the same split the Desk and the shelf use for hover lift. */
  progress: MotionValue<number>;
  /** 0 → 1 across the landing. Only meaningful once `stage` is set. */
  landing: MotionValue<number>;
  /** 0 → 1 across the settle beat, once the page is printed: how far the book
   * has relaxed toward the pane's proportions (`flattenTowardPane`). */
  settle: MotionValue<number>;
  /** The live reading pane's rect, measured when the landing starts. Null until
   * then — and null forever if the reader never produced one, in which case the
   * book simply holds its open pose and the overlay fades. */
  stage: Rect | null;
  /** The pane's width ÷ height, known a beat before its rect is (see
   * `BookOpening.tsx`). Null until the page has been printed. */
  paneAspect: number | null;
  /** A still of the reading pane, laid across the open spread once the reader
   * underneath has produced one (`BookOpening.tsx`'s hold). Null until then,
   * and null if the capture failed — in which case the spread stays blank
   * paper, exactly as it was before. */
  spreadImage: string | null;
  /** The pane's margin band, which the still does not depict — printed as the
   * page's own margins rather than stretched over (`snapshotInset`). */
  spreadInset: { x: number; y: number } | null;
}

/**
 * M23 §E: the opening, as a consumer of the one shared canvas
 * (`scene3d/Scene3D.tsx`).
 *
 * The book that opens **is** the book that was clicked: same asset, same
 * dimensions, same camera, continuing from the exact pose the Desk or the shelf
 * left it in. `openingGeometry.ts` carries the arithmetic and the reasoning —
 * in particular why the camera never moves, and why both entry points share
 * every phase after the first (TASKS.md: "one opening, two approaches").
 *
 * What lives here is only the three things that need a GPU: the camera, the
 * light, and writing the computed pose onto a group every frame.
 *
 * ⚠️ **The frame group is the whole desk/shelf difference.** Everything below it
 * is authored in stage coordinates — x right, y down, z toward the camera — and
 * that group either rotates the plane onto the Desk's `y = 0` or leaves it on
 * the shelf's `z = 0`. Adding a per-surface fork anywhere *else* in this file
 * is how "one opening, two approaches" quietly becomes two openings.
 */
export function BookOpening3D({
  pose,
  resourceId,
  title,
  progress,
  landing,
  settle,
  stage,
  paneAspect,
  spreadImage,
  spreadInset,
}: BookOpening3DProps) {
  const poseRef = useRef<Group>(null!);
  const bookRef = useRef<Group>(null!);
  const { size } = useThree();
  const paper = useThemeColor("--color-bg", PAPER_FALLBACK);
  // The front board's angle is a prop, not a ref write: it drives geometry
  // three.js rebuilds through React, so it goes through state at whatever rate
  // the frame loop sets it. Quantized to keep that at a few dozen distinct
  // values rather than one per frame.
  const [openProgress, setOpenProgress] = useState(0);

  useFrame(() => {
    const step = currentStep(
      progress.get(),
      landing.get(),
      settle.get(),
      pose,
      size,
      stage,
      paneAspect,
    );
    const group = poseRef.current;
    // Stage coords → the frame group's local space: y runs down on screen and
    // up in the world, and that negation is the entire conversion (settled
    // decision 14a — same units, different camera).
    group.position.set(step.position.x, -step.position.y, step.position.z);
    group.rotation.set(0, step.yaw, step.roll);
    group.scale.set(step.scale.x, step.scale.y, step.scale.z);
    // `Book3D` is authored spine-at-x-0; this offset re-anchors it on its own
    // closed centre, and then carries the recentring that walks the crease onto
    // the group's origin as the cover opens.
    bookRef.current.position.x = step.recentre - pose.width / 2;
    setOpenProgress((prev) =>
      Math.abs(prev - step.openProgress) < 0.02 && step.openProgress !== 1 && step.openProgress !== 0
        ? prev
        : step.openProgress,
    );
  });

  return (
    <>
      <CameraRig
        fit={pose.surface === "desk" ? deskViewFrame : shelfViewFrame}
        up={pose.surface === "desk" ? DESK_CAMERA_UP : undefined}
      />
      {/* The book turns its cover to the camera almost immediately, and the
          shared lights are a desk lamp — see `FrontKeyLight`. On the Desk's own
          framing the lamp *is* behind the camera, so it only needs the extra
          key on the shelf's. */}
      {pose.surface === "shelf" && <FrontKeyLight />}
      <group rotation={pose.surface === "desk" ? [-Math.PI / 2, 0, 0] : [0, 0, 0]}>
        <group ref={poseRef}>
          <group ref={bookRef}>
            <Book3D
              resourceId={resourceId}
              title={title}
              width={pose.width}
              height={pose.height}
              thickness={pose.thickness}
              openProgress={openProgress}
              maxOpenAngle={FLAT}
              paperColor={paper}
              spreadImage={spreadImage}
              spreadInset={spreadInset}
            />
          </group>
        </group>
      </group>
    </>
  );
}

/** The sequence, the settle's flattening over the top of it, then the landing
 * over the top of that — kept out of the frame callback so it is a plain
 * function of its inputs.
 *
 * Order matters: the flattening is part of *where the landing starts from*, so
 * it goes on before the lerp, never after. Applying it afterwards would drag
 * the landing's own endpoint off the pane. */
function currentStep(
  progress: number,
  landing: number,
  settle: number,
  pose: OpeningPose,
  viewport: { width: number; height: number },
  stage: Rect | null,
  paneAspect: number | null,
): OpeningStep {
  const step = flattenTowardPane(openingStep(progress, pose, viewport), pose, paneAspect, settle);
  if (!stage || landing <= 0) return step;
  return lerpToLanding(step, landingStep(pose, stage), landing);
}
