import { BookCover } from "@marginalia/web";

/*
 * BookCover renders the extracted cover for a resource. With no server behind
 * the card the image request fails and the component falls back to its
 * generated typographic cover — a deliberate, shipped state (the spine/cover
 * palette is derived from the title, see scene3d/coverPalette.ts), not a
 * broken one. That fallback is what these cards show.
 */
/* BookCover fills the width it is given — in the app that width comes from
   the library card it sits in. A card has to supply the same constraint, or
   one cover expands to the whole preview. 132px is the library card's own
   cover width. */
const shelf: React.CSSProperties = {
  display: "flex",
  gap: 18,
  alignItems: "flex-start",
  flexWrap: "wrap",
  padding: "6px 0",
};

const slot: React.CSSProperties = { width: 132, flex: "0 0 auto" };

/** A single cover at its natural size. */
export function Single() {
  return (
    <div style={shelf}>
      <div style={slot}><BookCover resourceId="res-1" title="The Feeling of Knowing" /></div>
    </div>
  );
}

/** Several covers together, at the library card's own width. The fallback
 *  cover sets the title's initial over a warm gradient; the palette is
 *  title-derived but stays deliberately close across books, so a shelf reads
 *  as one material rather than as four competing swatches. */
export function Shelf() {
  return (
    <div style={shelf}>
      <div style={slot}><BookCover resourceId="res-1" title="The Feeling of Knowing" /></div>
      <div style={slot}><BookCover resourceId="res-2" title="Interleaving" /></div>
      <div style={slot}><BookCover resourceId="res-3" title="Desirable Difficulty" /></div>
      <div style={slot}><BookCover resourceId="res-4" title="The Curse of Fluency" /></div>
    </div>
  );
}

/*
 * No "long vs short title" story: the fallback cover renders only the
 * title's initial, so title length changes nothing about what is drawn.
 * A story for it would be two identical cells.
 */
