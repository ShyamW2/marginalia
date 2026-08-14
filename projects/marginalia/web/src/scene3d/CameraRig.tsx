import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { PerspectiveCamera } from "three";

export interface CameraFrame {
  /** Vertical field of view, in **degrees** (three.js's PerspectiveCamera unit). */
  fov: number;
  aspect: number;
  position: readonly [number, number, number];
  target: readonly [number, number, number];
  near: number;
  far: number;
}

/**
 * The camera half of settled decision 14a: **consumers share the units and
 * bring their own camera**. A surface supplies a `fit` that turns the current
 * viewport size into a frame — the Desk hangs one above the plane `y = 0`
 * looking down (`desk/deskDepthMath.ts`), the shelf stands one in front of
 * `z = 0` looking along −Z (`desk/shelfLayout.ts`), and the opening borrows
 * whichever of the two the book it is continuing came from
 * (`reader/openingGeometry.ts`) — and this owns the three pieces of R3F
 * plumbing all of them need identically.
 *
 * Extracted at M23 §E, when the opening would have been the third verbatim
 * copy. Two of the three pieces exist because of live bugs and are worth
 * having in one place rather than three:
 *
 * ⚠️ **`manual = true`.** R3F overwrites a camera's projection on every size
 * change unless told the camera is managed by hand (`updateCamera` in its
 * source). Without it, the frustum fitted below is silently stomped and R3F's
 * *default* camera — never removed from the scene, just no longer the active
 * one — is what actually renders. It showed up as a keystoned book that had
 * nothing to do with the geometry.
 *
 * ⚠️ **The up vector is part of the frame.** The Desk needs `(0, 0, −1)`,
 * because screen-down is +Z there and that is what makes world `(x, 0, z)`
 * land on screen pixel `(x, z)` rather than on its vertical mirror. A
 * front-facing surface takes the default.
 *
 * The frame is refitted every frame rather than on resize, so a mid-animation
 * window change can't leave the projection behind.
 */
export function CameraRig({
  fit,
  up,
}: {
  fit: (width: number, height: number) => CameraFrame;
  /** Defaults to three.js's own `(0, 1, 0)`. */
  up?: readonly [number, number, number];
}) {
  const cameraRef = useRef<PerspectiveCamera>(null!);
  const { size, set, camera: previousCamera } = useThree();
  // Read inside useFrame so a surface can pass an inline closure without
  // re-running the one-shot effect below on every render.
  const fitRef = useRef(fit);
  fitRef.current = fit;

  useEffect(() => {
    const camera = cameraRef.current;
    // Untyped in three.js's own Camera — R3F's convention, not a public property.
    (camera as PerspectiveCamera & { manual?: boolean }).manual = true;
    if (up) camera.up.set(up[0], up[1], up[2]);
    set({ camera });
    return () => set({ camera: previousCamera });
    // Runs once: `set`/`previousCamera` come from the R3F store and aren't meant
    // to re-trigger this, and `up` is a property of the surface, not of a render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame(() => {
    const camera = cameraRef.current;
    const frame = fitRef.current(size.width, size.height);
    camera.fov = frame.fov;
    camera.aspect = frame.aspect;
    camera.near = frame.near;
    camera.far = frame.far;
    camera.position.set(frame.position[0], frame.position[1], frame.position[2]);
    camera.lookAt(frame.target[0], frame.target[1], frame.target[2]);
    camera.updateProjectionMatrix();
  });

  return <perspectiveCamera ref={cameraRef} />;
}
