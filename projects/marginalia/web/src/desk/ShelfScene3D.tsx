import { useEffect, useMemo, useRef, type MutableRefObject, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { MathUtils, MeshStandardMaterial, type Group, type Mesh } from "three";
import type { MotionValue } from "motion/react";
import { Book3D } from "../scene3d/Book3D.js";
import { CameraRig } from "../scene3d/CameraRig.js";
import { useDepartedBook } from "../scene3d/departedBook.js";
import { FrontKeyLight } from "../scene3d/FrontKeyLight.js";
import { shelfViewFrame, type ShelfSlot } from "./shelfLayout.js";
import { useDeskThemeColors } from "./useDeskThemeColors.js";
import { GRAIN_TILE_HEIGHT, GRAIN_TILE_WIDTH, makeWoodTexture } from "./woodTexture.js";

/** Exponential-decay rate for the hover lift, in e-folds per second
 * (`MathUtils.damp`'s lambda) — the Desk's own `LIFT_LAMBDA`, so a book reacts
 * at the same speed on both surfaces. */
const LIFT_LAMBDA = 13;
/** How far the plank projects in front of the books' spine faces, and how
 * thick it is. Small: it is a ledge to stand on, not furniture in its own
 * right. */
const PLANK_LIP = 16;
const PLANK_THICKNESS = 12;
/** How far the plank runs back behind the deepest book. Tight, because the
 * whole board is seen from above and every extra px of depth is another band
 * of bare wood competing with the books standing on it. */
const PLANK_BACK_MARGIN = 14;

export interface ShelfBookPlacement {
  slot: ShelfSlot;
  title: string;
  /** Target height above the plank, in px — written by the DOM element that
   * owns the hover/focus gesture and damped toward here, exactly as the Desk
   * does it (`DeskScene3D.tsx`). */
  lift: MotionValue<number>;
}

interface Origin {
  x: number;
  y: number;
}

/**
 * M23 §D: the shelf's 3D layer, registered into the one shared canvas
 * (`scene3d/Scene3D.tsx`) by `ShelfView.tsx`. Books stand spine-out on a plank,
 * seen square on through a real perspective camera — see `shelfLayout.ts` for
 * the camera's construction, for why the spine face lands on the viewport 1:1,
 * and for why every book stands upright.
 *
 * Like the Desk's layer this only ever *reads* the DOM: the strip's live
 * `getBoundingClientRect()` every frame is where the row is, which is what
 * makes scrolling free — a scroll moves the DOM, the scene follows it in the
 * same frame, and there is no scroll position duplicated in React state to fall
 * behind under momentum.
 */
export function ShelfScene3D({
  books,
  stripRef,
  baseline,
  deepest,
}: {
  books: ShelfBookPlacement[];
  /** The scrolling strip the books are laid out in. */
  stripRef: RefObject<HTMLElement>;
  /** Where the books stand, in px from the strip's top — the plank's surface. */
  baseline: number;
  /** The deepest book's depth, so the plank reaches behind all of them. */
  deepest: number;
}) {
  const originRef = useRef<Origin>({ x: 0, y: 0 });
  // The book the opening has pulled out of this row, if any — the Desk's own
  // arrangement, and `departedBook.ts` carries the reasoning. Without it a book
  // that has left the shelf is still standing in it.
  const departed = useDepartedBook();

  useFrame(() => {
    const rect = stripRef.current?.getBoundingClientRect();
    if (rect) {
      originRef.current.x = rect.left;
      originRef.current.y = rect.top;
    }
  });

  return (
    <>
      <ShelfCameraRig />
      {/* The shared `SceneLights` is a desk lamp and grazes a viewer-facing
          spine at almost zero incidence — see `FrontKeyLight` for the whole
          story, including why a second key light here is safe. */}
      <FrontKeyLight />
      <ShelfPlank stripRef={stripRef} originRef={originRef} baseline={baseline} deepest={deepest} />
      {books
        .filter((book) => book.slot.resourceId !== departed)
        .map((book) => (
          <ShelfBook3D key={book.slot.resourceId} book={book} originRef={originRef} baseline={baseline} />
        ))}
    </>
  );
}

/**
 * A perspective camera standing in front of the viewport's centre, refitted
 * every frame, whose field of view puts the shelf plane (`z = 0`) on the
 * viewport 1:1 — `shelfLayout.ts`'s `shelfViewFrame` does the arithmetic, and
 * `scene3d/CameraRig.tsx` owns the R3F plumbing.
 *
 * Anchored to the **viewport**, not to the strip: the row slides under a fixed
 * eye as it scrolls, which is what a shelf does when you walk along it.
 */
function ShelfCameraRig() {
  return <CameraRig fit={shelfViewFrame} />;
}

/**
 * The plank the books stand on: a board running the whole width of the row,
 * with its front edge projecting a little past the spines so the books read as
 * standing *on* something rather than floating in front of it.
 *
 * Sized from the strip's own rect every frame, like the Desk's surface, so it
 * always covers the row's real (scrollable) extent rather than whatever
 * happens to be on screen.
 *
 * ⚠️ A ledge, and nothing else. A back panel was built first and turned the
 * room into a bookcase: at any height tall enough to sit behind the books it
 * fills most of the viewport, and a flat wall of desk colour is what the eye
 * then lands on instead of the books. The plank alone grounds them, and the
 * page's own paper stays the background — which is also what DESIGN.md's
 * anti-goals ask for (nothing in the scene that isn't doing a job).
 */
function ShelfPlank({
  stripRef,
  originRef,
  baseline,
  deepest,
}: {
  stripRef: RefObject<HTMLElement>;
  originRef: MutableRefObject<Origin>;
  baseline: number;
  deepest: number;
}) {
  const boardRef = useRef<Mesh>(null!);
  const colors = useDeskThemeColors();

  const boardMaterial = useMemo(() => new MeshStandardMaterial({ roughness: 0.8, metalness: 0 }), []);

  // The Desk's own board, same grain and same theme colours — one piece of
  // furniture seen from two angles, not two.
  useEffect(() => {
    const texture = makeWoodTexture(colors.surface, colors.grain);
    if (texture) {
      // Tint comes from the tile, so the material's own colour goes white —
      // multiplying the two would darken the plank on every theme read.
      boardMaterial.color.set("#ffffff");
      boardMaterial.map = texture;
    } else {
      boardMaterial.color.set(colors.surface);
      boardMaterial.map = null;
    }
    boardMaterial.needsUpdate = true;
    return () => texture?.dispose();
  }, [colors, boardMaterial]);

  useEffect(() => () => boardMaterial.dispose(), [boardMaterial]);

  useFrame(() => {
    const rect = stripRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const depth = deepest + PLANK_BACK_MARGIN + PLANK_LIP;
    const centerX = originRef.current.x + rect.width / 2;
    // The plank's top is the baseline the books stand on; the box hangs below.
    const topY = -(originRef.current.y + baseline);

    boardRef.current.scale.set(rect.width, PLANK_THICKNESS, depth);
    boardRef.current.position.set(centerX, topY - PLANK_THICKNESS / 2, PLANK_LIP - depth / 2);
    const map = boardMaterial.map;
    // Repeat in world px, not in box-local UVs — otherwise the grain stretches
    // with the room instead of the plank simply showing more of the same board.
    if (map) map.repeat.set(rect.width / GRAIN_TILE_WIDTH, depth / GRAIN_TILE_HEIGHT);
  });

  return (
    <mesh ref={boardRef} receiveShadow castShadow>
      <boxGeometry args={[1, 1, 1]} />
      <primitive object={boardMaterial} attach="material" />
    </mesh>
  );
}

/**
 * One book, standing on the plank and followed live off the DOM element's own
 * lift motion value so it rises in step with hover or focus.
 *
 * The group's origin is the **bottom-left corner of the spine face** — the
 * corner of the one face that lies on the camera's 1:1 plane — because that
 * face is exactly the DOM hit target (`shelfLayout.ts`). The body then recedes
 * from it into −Z, where foreshortening costs nothing that is aimed at.
 */
function ShelfBook3D({
  book,
  originRef,
  baseline,
}: {
  book: ShelfBookPlacement;
  originRef: MutableRefObject<Origin>;
  baseline: number;
}) {
  const groupRef = useRef<Group>(null!);
  const liftRef = useRef(0);
  const { slot } = book;

  useFrame((_state, delta) => {
    const group = groupRef.current;
    // Clamped: a backgrounded tab resumes with a delta of whole seconds, and
    // an unclamped damp over that snaps rather than settles.
    liftRef.current = MathUtils.damp(liftRef.current, book.lift.get(), LIFT_LAMBDA, Math.min(delta, 0.05));
    group.position.set(
      originRef.current.x + slot.left,
      -(originRef.current.y + baseline) + liftRef.current,
      0,
    );
  });

  return (
    <group ref={groupRef}>
      {/* `Book3D` is authored spine-at-x=0, height centred on y, thickness
          centred on z (its docstring). Standing it up spine-out is a **+90°**
          yaw: that turns the book's own +x — the direction its fore edge lies
          in — into world −z, so the body recedes away from the viewer and the
          spine is the face left on the camera's 1:1 plane. ⚠️ −90° is the
          plausible-looking mistake and was made once: it points the same book
          *out of the screen*, so the shelf shows you a row of page blocks
          coming at you with the spines buried behind the plank.
          The offsets then move the book from "centred on its own origin" to
          "standing on it, spine's left edge at it". */}
      <group position={[slot.width / 2, slot.height / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <Book3D
          resourceId={slot.resourceId}
          title={book.title}
          width={slot.depth}
          height={slot.height}
          thickness={slot.width}
        />
      </group>
    </group>
  );
}
