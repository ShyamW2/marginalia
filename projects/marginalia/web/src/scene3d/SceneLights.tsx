import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { type DirectionalLight, type Object3D } from "three";

/** How far past the viewport edge the shadow frustum reaches, in px — enough
 * that a book straddling the edge still casts, without paying for acres of
 * off-screen map every frame. */
const SHADOW_MARGIN = 300;
/** Against a viewport-fitted frustum this lands around two world units per
 * texel, which is a soft contact shadow rather than a crisp outline — the
 * right look for a desk lamp, and a quarter of the per-frame cost of the
 * 2048² map it replaced. */
const SHADOW_MAP_SIZE = 1024;

/**
 * Shared across every consumer — a surface registering its own lights would
 * double them up the moment two are mounted together, which the seam's own
 * "one narrow seam" rule (CLAUDE.md) says belongs here.
 *
 * Both the key light and its shadow camera are sized in **viewport pixels**,
 * per `Scene3D.tsx`'s coordinate convention: a directional light's shadow frustum
 * does not follow the scene on its own, and three.js's default (a ±5-unit
 * box at the world origin) covers roughly the top-left corner pixel of the
 * page — which is why `castShadow` was on and no surface ever had a shadow.
 */
export function SceneLights() {
  const { size } = useThree();
  const keyRef = useRef<DirectionalLight>(null);
  const targetRef = useRef<Object3D>(null);

  useEffect(() => {
    const key = keyRef.current;
    const target = targetRef.current;
    if (!key || !target) return;

    const centerX = size.width / 2;
    const centerZ = size.height / 2;
    target.position.set(centerX, 0, centerZ);
    target.updateMatrixWorld();
    key.target = target;
    // Up and back over the reader's left shoulder, so objects throw their
    // shadows down and to the right — the direction a page of text is lit
    // from in every other room.
    key.position.set(centerX - size.width * 0.35, 1600, centerZ - size.height * 0.45);

    // ⚠️ Fitted to the viewport plus one margin, not generously oversized.
    // The shadow map is re-rendered **every frame** (the Desk runs a
    // continuous frameloop to follow drags), so its area is a per-frame cost:
    // an earlier ±(0.75·size + 400) frustum spent three quarters of a
    // 2048² map on empty space off-screen, and the resulting texel density
    // was low enough that the shadows were mush *and* slow. Off-screen books
    // need no shadow — nothing off-screen is visible to shade.
    const halfWidth = size.width / 2 + SHADOW_MARGIN;
    const halfHeight = size.height / 2 + SHADOW_MARGIN;
    const shadowCamera = key.shadow.camera;
    shadowCamera.left = -halfWidth;
    shadowCamera.right = halfWidth;
    shadowCamera.top = halfHeight;
    shadowCamera.bottom = -halfHeight;
    shadowCamera.near = 100;
    shadowCamera.far = 4000;
    shadowCamera.updateProjectionMatrix();
    // Roughly one texel of the fitted map above. At this scale (a couple of
    // world units per texel) plain `bias` either leaves acne or detaches the
    // shadow from the object that casts it; `normalBias` offsets along the
    // surface normal instead and holds at both window sizes.
    key.shadow.normalBias = 2;
    key.shadow.needsUpdate = true;
  }, [size]);

  return (
    <>
      {/* ⚠️ These look ~3x too high and are not. three.js runs every light
          through `BRDF_Lambert`, which divides by π, so an up-facing surface
          renders at its true colour only when the intensities reaching it sum
          to about π — at a "reasonable-looking" 0.6/0.55 the whole desk came
          out at 36% of its own CSS token, which reads as a broken material
          rather than as dim light (found live, measured off the canvas). Keep
          `ambient + directional·cos(θ) ≈ 3.14` for the desk plane. */}
      <ambientLight intensity={1.7} />
      <directionalLight
        ref={keyRef}
        intensity={1.55}
        castShadow
        shadow-mapSize-width={SHADOW_MAP_SIZE}
        shadow-mapSize-height={SHADOW_MAP_SIZE}
      />
      <object3D ref={targetRef} />
    </>
  );
}
