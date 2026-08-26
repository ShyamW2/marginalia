import { useEffect, useRef } from "react";
import { leafSourceRect } from "./pageFold.js";
import styles from "./FarLeafCover.module.css";

interface FarLeafCoverProps {
  /** The departing card's bitmap — the same one the turning sheet's front
   * face samples (`PageCurlState.image`). */
  image: HTMLCanvasElement;
  /** Where the far leaf sits on it, and the card's own width — the same
   * numbers `leafSourceRect` already turns a leaf rect into a bitmap crop
   * with, reused rather than re-derived. */
  farX: number;
  leafWidth: number;
  leafHeight: number;
  stageWidth: number;
}

/**
 * M27's far-leaf-pre-flip fix, and a bug in the shipped 2D curl too — this
 * covers whichever leaf is *not* turning, for as long as a fold is live.
 *
 * The drag advances the rendition at grab time (M20 step 2) so the turning
 * leaf's own back, and the page it reveals, are both ready the moment the
 * sheet lifts. In spread mode that steps *both* halves of the spread at
 * once — so the far leaf's live DOM shows the destination spread's content
 * from the very first frame, visible past the fold, which only ever draws
 * over the turning leaf. This crops the departing card's own bitmap (the
 * page as it looked *before* the advance) to the far leaf's rect and holds
 * it there until the caller unmounts this alongside the fold, at which
 * point the live DOM underneath — by then showing the correct spread,
 * whether the turn committed or sprang back — shows through unchanged.
 *
 * A plain crop, not a fold: this leaf never moves, so there is nothing here
 * for `pageFold.ts` to do. Renders nothing in single-page mode, where there
 * is no far leaf — the caller decides that by comparing `farX` to the
 * turning leaf's own `leafX` rather than this component re-deriving
 * `spreadMode`.
 */
export function FarLeafCover({ image, farX, leafWidth, leafHeight, stageWidth }: FarLeafCoverProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pxWidth = Math.max(1, Math.round(leafWidth * dpr));
    const pxHeight = Math.max(1, Math.round(leafHeight * dpr));
    canvas.width = pxWidth;
    canvas.height = pxHeight;
    const source = leafSourceRect(image.width, image.height, farX, leafWidth, stageWidth);
    ctx.drawImage(image, source.x, source.y, source.width, source.height, 0, 0, pxWidth, pxHeight);
    // One blit, undistorted, for the life of this mount — the same "every
    // dep fixed for the life of one turn" rule `PageCurl`'s own effect
    // follows, and for the same reason: the bitmap never changes mid-fold.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, farX, leafWidth, leafHeight, stageWidth]);

  return (
    <div
      className={styles.wrap}
      aria-hidden="true"
      style={{ left: farX, width: leafWidth, height: leafHeight }}
    >
      <canvas ref={canvasRef} className={styles.canvas} />
    </div>
  );
}
