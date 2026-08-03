import { useEffect, useRef } from "react";
import type { CardLayout } from "./cardSnapshot.js";
import styles from "./PageSlide.module.css";

interface PageSlideProps {
  /** The departing card's page bitmap, **already decoded** — see
   * `captureCardImage` in usePageTurnAnimation.ts. Handed over as a live
   * element rather than a `src` string so mounting it cannot cost a decode
   * at the exact moment the reader grabs the page. */
  image: HTMLImageElement;
  /** Where that bitmap sits inside the card, in the card's own CSS px. */
  layout: CardLayout;
  /** The card's computed background — the margin band around the bitmap.
   * Null only if nothing up the tree paints one, in which case the band is
   * left transparent rather than guessed at. */
  paper: string | null;
}

/**
 * M20 step 3 (decisions.md 2026-08-03): the **departing** page of a slide
 * turn, held perfectly still underneath the live stage.
 *
 * The slide is the same gesture as the curl with a different renderer, and
 * the difference in cost is the whole point of offering it: the curl mounts
 * two canvases and repaints ~25 bands a frame; this mounts one already-
 * decoded image and never repaints at all. The motion is a single
 * `transform` on `.marginWrapper` (the live stage), written straight to the
 * DOM by `usePageTurnAnimation` — the incoming page moves, this does not.
 *
 * **No canvas mounts here, deliberately.** "Slide means never curl" is
 * checkable as `document.querySelectorAll("canvas").length === 0` through a
 * whole turn, and it stays checkable only if the departing card is not
 * itself a canvas. `pageSnapshot` already returns a PNG data URL, so the
 * canvas `cardSnapshot.ts` composites into is pure overhead here: its only
 * job is filling the reader margin with one flat colour, which is this
 * element's `background`.
 */
export function PageSlide({ image, layout, paper }: PageSlideProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    image.className = styles.snapshot;
    image.style.left = `${layout.offsetX}px`;
    image.style.top = `${layout.offsetY}px`;
    image.style.width = `${layout.contentWidth}px`;
    image.style.height = `${layout.contentHeight}px`;
    host.appendChild(image);
    return () => {
      image.remove();
    };
  }, [image, layout]);

  return (
    <div
      ref={hostRef}
      className={styles.wrap}
      aria-hidden="true"
      style={{ background: paper ?? undefined }}
    />
  );
}
