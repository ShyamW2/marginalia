import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { CanvasTexture, MathUtils, MeshStandardMaterial, SRGBColorSpace, type Group, type Mesh } from "three";
import {
  angularVelocity,
  PLATTER_RPM,
  PLINTH_HEIGHT,
  spinUp,
  tonearmAngle,
  turntableLayout,
} from "./turntableMath.js";
import { useDeskThemeColors } from "./useDeskThemeColors.js";

const PLATTER_THICKNESS = 5;
/** The tonearm is authored at this length and scaled to whatever the layout
 * asks for, so its post, tube and headshell keep their proportions to each
 * other at any deck size. */
const ARM_UNIT_LENGTH = 50;
/** One tile of the record's surface. Square: it maps onto a disc. */
const VINYL_TEXTURE_SIZE = 512;

/**
 * The record, painted once per theme into a 2D canvas — grooves, label, and the
 * light catching one side of it. A texture rather than more geometry because
 * concentric grooves as meshes would be hundreds of coplanar rings, which is
 * exactly the depth-buffer tie `scene3d/bookGeometry.ts` documents; and rather
 * than a shader because 2D canvas is already how this app draws
 * (`DeskScene3D.tsx`'s grain, `CursorTrail.tsx`).
 */
function makeVinylTexture(accent: string): CanvasTexture | null {
  const canvas = document.createElement("canvas");
  canvas.width = VINYL_TEXTURE_SIZE;
  canvas.height = VINYL_TEXTURE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const center = VINYL_TEXTURE_SIZE / 2;

  ctx.fillStyle = "#15120f";
  ctx.fillRect(0, 0, VINYL_TEXTURE_SIZE, VINYL_TEXTURE_SIZE);

  // Grooves, banded rather than evenly ruled so the disc reads as pressed
  // sides and run-outs rather than as a dartboard.
  ctx.strokeStyle = "#2f2925";
  ctx.lineWidth = 1;
  for (let r = center * 0.42; r < center * 0.985; r += 2.4) {
    ctx.globalAlpha = 0.22 + 0.34 * Math.abs(Math.sin(r * 0.09));
    ctx.beginPath();
    ctx.arc(center, center, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // The sheen a record throws back at a light, baked in. The key light is
  // fixed over the desk and the platter turns under it, so a highlight that
  // travels with the disc is what actually reads as "it is spinning" from
  // straight above — a featureless black circle rotating is invisible.
  const sheen = ctx.createLinearGradient(0, 0, VINYL_TEXTURE_SIZE, VINYL_TEXTURE_SIZE);
  sheen.addColorStop(0, "rgba(255, 246, 228, 0)");
  sheen.addColorStop(0.42, "rgba(255, 246, 228, 0.13)");
  sheen.addColorStop(0.5, "rgba(255, 246, 228, 0.24)");
  sheen.addColorStop(0.58, "rgba(255, 246, 228, 0.13)");
  sheen.addColorStop(1, "rgba(255, 246, 228, 0)");
  ctx.fillStyle = sheen;
  ctx.beginPath();
  ctx.arc(center, center, center, 0, Math.PI * 2);
  ctx.fill();

  // Label, in the room's accent.
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(center, center, center * 0.36, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
  ctx.lineWidth = 2;
  for (const r of [center * 0.3, center * 0.22]) {
    ctx.beginPath();
    ctx.arc(center, center, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Spindle hole, so the pin below reads as going *through* the record.
  ctx.fillStyle = "#15120f";
  ctx.beginPath();
  ctx.arc(center, center, center * 0.035, 0, Math.PI * 2);
  ctx.fill();

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

export interface Turntable3DProps {
  /** The DOM button that *is* this object. Its rect is the footprint, read
   * every frame — the same contract the books have with their `BookObject`, so
   * what you click and what you see cannot drift apart. */
  toolRef: RefObject<HTMLElement>;
  /** Listening mode is on: the platter turns and the arm comes down. */
  engaged: boolean;
  /** A book is being dragged over the platter right now. */
  dropActive: boolean;
}

/**
 * M23 §C: the listening tool as a real deck standing on the desk, replacing
 * `ListeningTool.tsx`'s flat SVG wherever the 3D layer is running.
 *
 * ⚠️ **It is the charm, never the gate** (AUDIO.md, and `ListeningTool.tsx`'s
 * own docstring). This component draws and handles no input at all: the button
 * underneath keeps the click, the focus ring, the accessible name and the
 * pressed state, and everything here is driven by props that button owns.
 * Delete this file and listening still works exactly as it did — which is also
 * what happens under reduced motion and after a lost context, where no canvas
 * exists and the SVG is what renders.
 */
export function Turntable3D({ toolRef, engaged, dropActive }: Turntable3DProps) {
  const groupRef = useRef<Group>(null!);
  const plinthRef = useRef<Mesh>(null!);
  const platterRef = useRef<Group>(null!);
  const spindleRef = useRef<Mesh>(null!);
  const armRef = useRef<Group>(null!);
  const ringRef = useRef<Mesh>(null!);
  const lampRef = useRef<Mesh>(null!);
  // The tool's last known box — see the frame callback for why the live one
  // isn't enough.
  const lastRectRef = useRef<DOMRect | null>(null);
  const spinRef = useRef(0);
  const engagementRef = useRef(0);
  const playingSecondsRef = useRef(0);
  const colors = useDeskThemeColors();

  const materials = useMemo(
    () => ({
      plinth: new MeshStandardMaterial({ roughness: 0.55, metalness: 0.08 }),
      metal: new MeshStandardMaterial({ roughness: 0.34, metalness: 0.5 }),
      vinylEdge: new MeshStandardMaterial({ color: "#15120f", roughness: 0.42 }),
      // ⚠️ The record's rim and its underside are the *same* black, and they
      // still get an instance each. R3F attaches a `<primitive>` by remembering
      // what it displaced, so attaching one material object to two slots of one
      // mesh leaves the first slot **empty** once the second attaches — measured
      // 2026-08-16: `mesh.material` came out `[null, face, edge]`, so the rim
      // was drawn with three.js's default white, and any traversal that reads
      // every material in the layer hit a hole. That traversal exists
      // (`Scene3D.tsx`'s `FadingLayer`), and the hole stopped the shared
      // canvas's frame loop dead during the opening's landing.
      vinylUnder: new MeshStandardMaterial({ color: "#15120f", roughness: 0.42 }),
      vinylFace: new MeshStandardMaterial({ roughness: 0.36 }),
      lamp: new MeshStandardMaterial({ roughness: 0.4 }),
      ring: new MeshStandardMaterial({ roughness: 0.5, transparent: true, opacity: 0.85 }),
    }),
    [],
  );

  useEffect(() => {
    materials.plinth.color.set(colors.plinth);
    materials.metal.color.set(colors.metal);
    materials.ring.color.set(colors.accent);
    materials.ring.emissive.set(colors.accent);
    materials.ring.emissiveIntensity = 0.9;
    materials.lamp.emissive.set(colors.accent);
    const texture = makeVinylTexture(colors.accent);
    materials.vinylFace.map = texture;
    // Tint comes from the tile, so the material's own colour goes white —
    // multiplying the two would darken the record on every theme read
    // (`DeskScene3D.tsx`'s surface carries the same note).
    materials.vinylFace.color.set(texture ? "#ffffff" : "#15120f");
    materials.vinylFace.needsUpdate = true;
    return () => texture?.dispose();
  }, [colors, materials]);

  useEffect(() => {
    return () => {
      for (const material of Object.values(materials)) material.dispose();
    };
  }, [materials]);

  useFrame((_state, delta) => {
    const live = toolRef.current?.getBoundingClientRect();
    // ⚠️ The **last** rect, not only the live one. While the opening holds this
    // layer on the canvas (`Scene3D.tsx`'s `useScene3DHold`) the desk goes on
    // rendering after its DOM has gone, and a tool that hides the moment its
    // element disappears pops off the desk you are still looking at — every
    // other object on this surface freezes in place instead, because it reads
    // a cached origin. Same rule, applied here.
    if (live && live.width > 0 && live.height > 0) lastRectRef.current = live;
    const rect = lastRectRef.current;
    // Hidden rather than unmounted when the tool has never been laid out: a
    // mount/unmount per frame would rebuild geometry on a surface that runs a
    // continuous frameloop.
    if (!rect) {
      groupRef.current.visible = false;
      return;
    }
    groupRef.current.visible = true;
    // Clamped for the reason `DeskScene3D` clamps: a backgrounded tab resumes
    // with a delta of whole seconds, and every damp below would snap.
    const step = Math.min(delta, 0.05);
    const layout = turntableLayout(rect.width, rect.height);

    groupRef.current.position.set(rect.left + rect.width / 2, 0, rect.top + rect.height / 2);

    // Sized from the live rect rather than baked in, so the tool can change
    // size (or a stylesheet can) without the drawn deck sliding off it.
    plinthRef.current.scale.set(rect.width, PLINTH_HEIGHT, rect.height);
    plinthRef.current.position.set(0, PLINTH_HEIGHT / 2, 0);

    platterRef.current.position.set(layout.platterX, PLINTH_HEIGHT, layout.platterZ);
    platterRef.current.scale.set(layout.platterRadius, 1, layout.platterRadius);
    spinRef.current = spinUp(spinRef.current, engaged ? angularVelocity(PLATTER_RPM) : 0, step);
    platterRef.current.rotation.y += spinRef.current * step;

    spindleRef.current.position.set(layout.platterX, PLINTH_HEIGHT, layout.platterZ);

    engagementRef.current = MathUtils.damp(engagementRef.current, engaged ? 1 : 0, 3.2, step);
    playingSecondsRef.current = engaged ? playingSecondsRef.current + step : 0;
    armRef.current.position.set(layout.postX, PLINTH_HEIGHT, layout.postZ);
    armRef.current.rotation.y = tonearmAngle(layout, engagementRef.current, playingSecondsRef.current);
    // Scaled so a bigger deck gets a proportionally longer arm, not a stubby
    // one — the layout is the single source of the arm's reach.
    armRef.current.scale.setScalar(layout.armLength / ARM_UNIT_LENGTH);

    // The drop cue is a lit ring around the platter — on the deck, where the
    // book is going, rather than on the book, which is under the cursor and
    // already moving.
    ringRef.current.visible = dropActive;
    ringRef.current.position.set(layout.platterX, PLINTH_HEIGHT + PLATTER_THICKNESS + 0.6, layout.platterZ);
    ringRef.current.scale.setScalar(layout.platterRadius);

    lampRef.current.position.set(rect.width * 0.34, PLINTH_HEIGHT, rect.height * 0.3);
    materials.lamp.color.set(engaged ? colors.accent : colors.metal);
    materials.lamp.emissiveIntensity = engagementRef.current * 1.7;
  });

  return (
    <group ref={groupRef}>
      {/* Cabinet. Scaled from the live rect above, so a unit box here. */}
      <mesh ref={plinthRef} castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <primitive object={materials.plinth} attach="material" />
      </mesh>

      {/* The record. A unit-radius cylinder scaled in x/z, so its size follows
          the tool's rect without rebuilding geometry. Face and edge are
          separate materials: only the top carries the grooves. */}
      <group ref={platterRef}>
        <mesh position={[0, PLATTER_THICKNESS / 2, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[1, 1, PLATTER_THICKNESS, 64]} />
          <primitive object={materials.vinylEdge} attach="material-0" />
          <primitive object={materials.vinylFace} attach="material-1" />
          <primitive object={materials.vinylUnder} attach="material-2" />
        </mesh>
      </group>

      {/* Spindle, struck up through the record from inside the cabinet rather
          than stood on top of it, so no face of it lands in the record's own
          plane facing the same way (scene3d/bookGeometry.ts). */}
      <mesh ref={spindleRef} castShadow>
        <cylinderGeometry args={[1.5, 1.5, 20, 12]} />
        <primitive object={materials.metal} attach="material" />
      </mesh>

      {/* Drop cue: a lit ring standing just proud of the record. */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[1.03, 1.19, 48]} />
        <primitive object={materials.ring} attach="material" />
      </mesh>

      {/* Tonearm — post, arm, headshell — swinging about the post. Authored at
          `ARM_UNIT_LENGTH` and scaled to the layout's own arm length, pointing
          along −x at rotation 0, which is the convention `turntableMath.ts`'s
          `stylusPosition` inverts to solve for these angles. */}
      <group ref={armRef}>
        <mesh position={[0, 4, 0]} castShadow>
          <cylinderGeometry args={[4.2, 4.8, 8, 20]} />
          <primitive object={materials.metal} attach="material" />
        </mesh>
        <mesh position={[-ARM_UNIT_LENGTH / 2, 9.2, 0]} castShadow>
          <boxGeometry args={[ARM_UNIT_LENGTH, 1.9, 1.9]} />
          <primitive object={materials.metal} attach="material" />
        </mesh>
        <mesh position={[-ARM_UNIT_LENGTH + 2.5, 7.8, 0]} castShadow>
          <boxGeometry args={[7, 3.2, 4.2]} />
          <primitive object={materials.metal} attach="material" />
        </mesh>
      </group>

      {/* The lamp that says it is on — the 3D half of `.engaged`'s glow. */}
      <mesh ref={lampRef} castShadow>
        <cylinderGeometry args={[2.6, 2.6, 1.8, 16]} />
        <primitive object={materials.lamp} attach="material" />
      </mesh>
    </group>
  );
}
