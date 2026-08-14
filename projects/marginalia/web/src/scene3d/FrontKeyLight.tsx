import { useThree } from "@react-three/fiber";

/**
 * A key light for a surface whose subject faces the **camera** rather than the
 * sky.
 *
 * ⚠️ The shared `SceneLights` is a *desk lamp*: it hangs above the plane `y = 0`
 * and points down, so it grazes a viewer-facing face at almost zero incidence
 * and leaves it lit by ambient alone — flat, and about half its true colour.
 * The shelf found this first (decisions.md 2026-08-13); the opening hits it for
 * the same reason, since a book that has turned its cover to the camera on the
 * shelf's plane is exactly that geometry.
 *
 * Front-left and slightly above, matching the direction every other room's light
 * comes from (`SceneLights.tsx`: "over the reader's left shoulder"), so these
 * surfaces are lit like the same room rather than a different one. No shadow
 * map: the shared key light already grounds objects, and a second
 * shadow-casting light is a second full shadow pass every frame.
 *
 * ⚠️ Safe **only** while the surfaces that use it are mutually exclusive with
 * the Desk — the shelf and the opening both are (`DeskPage.tsx` renders one view
 * mode; the opening lives in the reader room). If a surface ever mounts one of
 * them alongside the Desk, this light moves into `SceneLights` and is balanced
 * there instead of doubling up the Desk's exposure.
 */
export function FrontKeyLight({ intensity = 1.15 }: { intensity?: number }) {
  const { size } = useThree();
  return <directionalLight intensity={intensity} position={[-size.width * 0.3, size.height * 0.4, 1400]} />;
}
