import { useEffect, useMemo } from "react";
import { MeshBasicMaterial, MeshStandardMaterial } from "three";
import { PAGE_LIFT, bookParts, spineArc } from "./bookGeometry.js";
import { spineTexture } from "./spineTexture.js";
import { useCoverTexture } from "./useCoverTexture.js";
import { useSpinePalette } from "./useSpinePalette.js";
import { useSpreadTexture } from "./useSpreadTexture.js";

/** A real cover doesn't swing to a flat 180° against a desk — the page block
 * is in the way. The opening (M23 §E) is the one caller that overrides this,
 * because a book being *read* does lie flat and its spread is the whole point. */
const MAX_OPEN_ANGLE = Math.PI * 0.82;

const PAGE_BLOCK_COLOR = "#f2ead9";

// Shared across every mounted book: the page block never differs per book, so
// there is no reason to allocate a material per instance — a shelf holds
// dozens of these at once (M23 §D).
const pageBlockMaterial = new MeshStandardMaterial({ color: PAGE_BLOCK_COLOR, roughness: 0.95 });

export interface Book3DProps {
  resourceId: string;
  /** Lettered down the spine. A book with no title renders a plain binding —
   * the spine is still dyed, it just says nothing. */
  title?: string;
  /** Scene units, cover-forward (BookCover.module.css's 2:3 aspect by default). */
  width?: number;
  height?: number;
  thickness?: number;
  /** 0 = closed, 1 = open to `maxOpenAngle`. Default closed. */
  openProgress?: number;
  /** How far `openProgress: 1` swings the front board, in radians. Defaults to
   * the 148° a cover reaches against a page block; the opening passes π, where
   * the board lies flat and the two halves become a spread. */
  maxOpenAngle?: number;
  /** Overrides the page block's colour, and with it the front board's inner
   * face — the two faces a flat-open book shows as its spread. The opening
   * passes the reader's own paper (`--color-bg`), so the crossfade at the end
   * of the landing is a swap between two sheets of the same colour rather than
   * a flash. Costs one material per instance, which is why it is opt-in: the
   * shelf renders dozens of books and shares one. */
  paperColor?: string;
  /**
   * A picture of the page the book is about to become, as a `data:` URL, laid
   * across the open spread — the left half on the front board's inner face,
   * the right half on the page block (`useSpreadTexture`).
   *
   * ⚠️ **Only the opening passes this, and only while the book is open.**
   * DESIGN.md's rule was "blank paper planes, never real epub pages"; it was
   * amended on 2026-08-14 (decisions.md) to permit exactly this: one *still*
   * of the pane, on a book that is holding still, so the reader you are about
   * to be in is already in your hands. What the rule was protecting against —
   * animating real page content, which PAGE_CURL.md prices — is untouched.
   */
  spreadImage?: string | null;
}

/**
 * M23 §A: the one book object — boards, spine, page block and an openable
 * front cover, authored once for the Desk, the shelf and the opening to
 * share (settled decision 14). A missing cover falls back to a plain bound
 * board, mirroring `BookCover.tsx`'s own onError contract, rather than a
 * broken or blank texture.
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
 *
 * ## The binding (M23 §D)
 *
 * Cloth colour comes from the cover art (`coverPalette.ts`) and the title is
 * lettered onto the spine (`spineTexture.ts`), so a book is identifiable from
 * its edge alone — which is the entire proposition of a shelf, and reads on
 * the Desk too the moment a book is dragged off the optical axis and starts
 * showing its binder.
 */
export function Book3D({
  resourceId,
  title,
  width = 1,
  height = 1.5,
  thickness = 0.12,
  openProgress = 0,
  maxOpenAngle = MAX_OPEN_ANGLE,
  paperColor,
  spreadImage = null,
}: Book3DProps) {
  const texture = useCoverTexture(resourceId);
  const palette = useSpinePalette(resourceId);
  const spread = useSpreadTexture(spreadImage);

  // The round back, and the hinge line the boards start at. See
  // `bookGeometry.ts` for why the spine is a curve and not the box it was.
  const parts = bookParts(width, height, thickness);
  const { bulge } = parts;
  const arc = spineArc(thickness, bulge);
  const arcLength = arc.radius * arc.thetaLength;

  // Bound in the cover's own colour: boards, and the front board's edges where
  // the cloth turns over. Per book rather than shared, which is the price of a
  // shelf that reads as a row of different objects.
  const bindingMaterial = useMemo(
    () => new MeshStandardMaterial({ color: palette.binding, roughness: 0.78 }),
    [palette.binding],
  );

  const spineMaterial = useMemo(() => {
    const map = title
      ? spineTexture({ resourceId, title, palette, lengthPx: height, widthPx: arcLength })
      : null;
    return new MeshStandardMaterial({ color: map ? "#ffffff" : palette.binding, map, roughness: 0.7 });
    // `arcLength` is a function of width/thickness and changes with them; it is
    // in the list rather than the two inputs so the texture is repainted only
    // when the size it was painted for actually moves.
  }, [resourceId, title, palette, height, arcLength]);

  const coverMaterial = useMemo(
    () => new MeshStandardMaterial(texture ? { map: texture, roughness: 0.62 } : { color: palette.binding, roughness: 0.7 }),
    [texture, palette.binding],
  );

  // Shared unless a caller asks for its own paper — see `paperColor`.
  //
  // ⚠️ **Unlit** when a caller does ask, and that is the whole point of asking.
  // A lit `#fbf8f1` is not `#fbf8f1`: `SceneLights` is a desk lamp, so a
  // MeshStandardMaterial handed the reader's paper renders it a good deal
  // brighter than the pane it is supposed to be the same colour as, which is why
  // the opening's spread read as white paper over a cream room ("would be nice
  // if the book could open with the pages already matching the reading pane
  // colours", 2026-08-14). Unlit, what you see is literally the token — and the
  // crossfade at the end of the landing becomes a swap between two sheets of the
  // same colour, which is the claim this prop was always making.
  const paperMaterial = useMemo(
    () => (paperColor ? new MeshBasicMaterial({ color: paperColor }) : pageBlockMaterial),
    [paperColor],
  );
  useEffect(() => {
    if (paperMaterial === pageBlockMaterial) return;
    return () => paperMaterial.dispose();
  }, [paperMaterial]);

  // The printed spread, when the opening has one. Two materials rather than
  // one because the two halves are on different solids that move
  // independently — the left page is on a board that swings.
  //
  // Unlit for the same reason as the paper above, and one more: the snapshot is
  // already a picture of a lit room, so relighting it is lighting it twice.
  const pageMaterials = useMemo(
    () =>
      spread
        ? {
            left: new MeshBasicMaterial({ map: spread.left }),
            right: new MeshBasicMaterial({ map: spread.right }),
          }
        : null,
    [spread],
  );
  useEffect(() => {
    if (!pageMaterials) return;
    return () => {
      pageMaterials.left.dispose();
      pageMaterials.right.dispose();
    };
  }, [pageMaterials]);

  // None of these are JSX-owned (they're attached via `<primitive>`), so React
  // Three Fiber's usual auto-dispose-on-unmount doesn't cover them — a shelf
  // that scrolls dozens of books in and out would otherwise leak one GPU
  // program per book. The *textures* they carry are cached and shared, and are
  // deliberately not disposed here.
  useEffect(() => () => bindingMaterial.dispose(), [bindingMaterial]);
  useEffect(() => () => spineMaterial.dispose(), [spineMaterial]);
  useEffect(() => () => coverMaterial.dispose(), [coverMaterial]);

  const { boardThickness, blockThickness, boardWidth, pageWidth, pageHeight } = parts;
  const angle = -openProgress * maxOpenAngle;

  // ⚠️ **The spread's two leaves are drawn as leaves, printed or not**
  // (2026-08-14). They used to exist only when a caller handed over a
  // `spreadImage`, so a book that had opened but whose snapshot had not arrived
  // yet showed its *left* page on the swung-open board (`boardWidth × height`,
  // up at the board's own face) against a *right* page that was the page
  // block's top face — a `pageInset` narrower on three sides and a board
  // thickness lower. The operator saw both halves of that: "it still has a
  // larger left page than right". `openSpread`'s coplanarity fix had corrected
  // the printed case only, which is the half of the sequence that comes last.
  //
  // Past 90° the front board is edge-on and the page block's face is what a
  // reader would be looking at, so that is where the leaves appear — under a
  // closed or half-open cover they would simply be paper floating over the
  // artwork (they sit `PAGE_LIFT` above the *front* board's face, not the
  // block's; see `openSpread.paperZ`).
  const spreadOpen = openProgress * maxOpenAngle > Math.PI / 2;
  const leftPage = pageMaterials?.left ?? paperMaterial;
  const rightPage = pageMaterials?.right ?? paperMaterial;

  return (
    <group name={`book-${resourceId}`}>
      {/* Back board. */}
      <mesh position={[bulge + boardWidth / 2, 0, -thickness / 2 + boardThickness / 2]} castShadow receiveShadow>
        <boxGeometry args={[boardWidth, height, boardThickness]} />
        <primitive object={bindingMaterial} attach="material" />
      </mesh>

      {/* Page block. */}
      <mesh key={paperMaterial.uuid} position={[bulge + pageWidth / 2, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[pageWidth, pageHeight, blockThickness]} />
        <primitive object={paperMaterial} attach="material" />
      </mesh>

      {/* The round back, closing the book from one board's outer corner to the
          other's, and carrying the lettering. Its end caps run a half-unit past
          head and tail rather than flush with them: flush would put the caps in
          the boards' own end planes facing the same way, which is the tie this
          curve exists to avoid. Half a unit is a half *pixel* on the Desk —
          under the antialiasing, and four orders of magnitude more depth
          separation than the buffer needs at this camera distance.
          ⚠️ That overhang is also why the spine texture is painted for
          `height`, not for the cylinder's own length: the extra unit is off the
          ends of the artwork, where the head margin already leaves cloth. */}
      <mesh key={spineMaterial.uuid} position={[arc.centerX, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[arc.radius, arc.radius, height + 1, 32, 1, false, arc.thetaStart, arc.thetaLength]} />
        <primitive object={spineMaterial} attach="material" />
      </mesh>

      {/* The right-hand page of the open spread — the snapshot's right half
          once the opening has one, and plain paper until then. Only ever
          present on a book that is open past the cover's own halfway point
          (`spreadOpen`); every other surface draws the block and nothing else.

          ⚠️ Sized to the **board**, not to the page block, and floated onto
          `openSpread`'s `paperZ` rather than resting on the block — the two
          things that make the printed spread exactly the rect the landing aims
          at (`openingGeometry.ts`'s `spreadRect`) and exactly coplanar with its
          other half. It was the page block's own size and height, which is what
          a real leaf inside its boards' overhang looks like, and which put the
          picture at a different scale and a different magnification from the
          left page. Realism lost to the crossfade: the last frame of this and
          the first frame of the reader have to be the same picture. */}
      {spreadOpen && (
        <mesh key={rightPage.uuid} position={[bulge + boardWidth / 2, 0, thickness / 2 + PAGE_LIFT]}>
          <planeGeometry args={[boardWidth, height]} />
          <primitive object={rightPage} attach="material" />
        </mesh>
      )}

      {/* The front board: hinged at the spine's joint (local x = bulge), cover
          art on its outward (+z) face, cloth on the four edges the binding
          wraps, and **paper on its inward (−z) face** — the pastedown endpaper
          a bound book actually has there, and the left half of the spread once
          the opening swings this board flat (M23 §E). Invisible while closed,
          which is every other surface. */}
      <group position={[bulge, 0, thickness / 2 - boardThickness / 2]} rotation={[0, angle, 0]}>
        {/* Keyed on the material's uuid: R3F's `attach="material-4"` binding
            was seen reconciling in place across sibling fibers whose textures
            resolved at different times, landing one book's cover on another's
            mesh (M23 §B, NOTES.md). A remount on identity change sidesteps
            whatever that reconciliation was doing. */}
        <mesh key={coverMaterial.uuid} position={[boardWidth / 2, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[boardWidth, height, boardThickness]} />
          <primitive object={bindingMaterial} attach="material-0" />
          <primitive object={bindingMaterial} attach="material-1" />
          <primitive object={bindingMaterial} attach="material-2" />
          <primitive object={bindingMaterial} attach="material-3" />
          <primitive object={coverMaterial} attach="material-4" />
          <primitive object={paperMaterial} attach="material-5" />
        </mesh>
        {/* And the left-hand page, on the board's inner face, so it swings with
            it and is simply *there* the moment the board lies flat. Board-sized
            and a `PAGE_LIFT` off that face — which, once the board is flat, is
            `openSpread`'s `paperZ`, the same plane the right page floats on. See
            that comment for why the two halves must agree about both.

            ⚠️ The `[0, π, 0]` is not decoration. A plane faces its own +z, and
            this one has to face the board's −z (the inner face); turning it
            about y does that **and** puts its +u back along world +x once the
            board itself has swung through π — two mirrorings that cancel. Drop
            it and the page is legible only in a mirror. */}
        {spreadOpen && (
          <mesh
            key={leftPage.uuid}
            position={[boardWidth / 2, 0, -(boardThickness / 2 + PAGE_LIFT)]}
            rotation={[0, Math.PI, 0]}
          >
            <planeGeometry args={[boardWidth, height]} />
            <primitive object={leftPage} attach="material" />
          </mesh>
        )}
      </group>
    </group>
  );
}
