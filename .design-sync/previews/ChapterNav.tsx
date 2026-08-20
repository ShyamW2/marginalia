import { ChapterNav } from "@marginalia/web";

type Toc = {
  label: string;
  href: string;
  spineIndex: number | null;
  percent: number | null;
  depth: number;
};

/* A realistic table of contents: `toc` is the full nested list (subitems
   included, `depth` drives the indent) for browsing, while `chapterStops` is
   the deduped one-per-spine-index list that governs prev/next and the label. */
const toc: Toc[] = [
  { label: "Preface", href: "p.xhtml", spineIndex: 0, percent: 0, depth: 0 },
  { label: "I · What Knowing Feels Like", href: "c1.xhtml", spineIndex: 1, percent: 6, depth: 0 },
  { label: "The feeling of knowing", href: "c1.xhtml#s1", spineIndex: 1, percent: 8, depth: 1 },
  { label: "Fluency and its traps", href: "c1.xhtml#s2", spineIndex: 1, percent: 13, depth: 1 },
  { label: "II · The Curse of Fluency", href: "c2.xhtml", spineIndex: 2, percent: 21, depth: 0 },
  { label: "III · The Illusion of Explanatory Depth", href: "c3.xhtml", spineIndex: 3, percent: 34, depth: 0 },
  { label: "Asking for a mechanism", href: "c3.xhtml#s1", spineIndex: 3, percent: 38, depth: 1 },
  { label: "IV · Desirable Difficulty", href: "c4.xhtml", spineIndex: 4, percent: 52, depth: 0 },
  { label: "V · Interleaving", href: "c5.xhtml", spineIndex: 5, percent: 68, depth: 0 },
  { label: "Afterword", href: "a.xhtml", spineIndex: 6, percent: 91, depth: 0 },
];

const chapterStops = toc.filter((t) => t.depth === 0);
const chapterNumbers = new Map<number, number>(chapterStops.map((c, i) => [c.spineIndex as number, i]));
const noop = () => {};

const stage: React.CSSProperties = { padding: "10px 4px" };

/** Mid-book: both prev and next available, full chapter label. */
export function MidBook() {
  return (
    <div style={stage}>
      <ChapterNav
        toc={toc}
        chapterStops={chapterStops}
        currentChapter={chapterStops[3]}
        chapterNumbers={chapterNumbers}
        onSelect={noop}
        onPrev={noop}
        onNext={noop}
        hasPrev
        hasNext
      />
    </div>
  );
}

/** The first chapter — `hasPrev={false}` disables the backward step. */
export function AtStart() {
  return (
    <div style={stage}>
      <ChapterNav
        toc={toc}
        chapterStops={chapterStops}
        currentChapter={chapterStops[0]}
        chapterNumbers={chapterNumbers}
        onSelect={noop}
        onPrev={noop}
        onNext={noop}
        hasPrev={false}
        hasNext
      />
    </div>
  );
}

/** `compact` caps the label at `max-width: 1.75rem` (~28px), so it collapses
 *  to the section stub regardless of title length — deliberate, not a bug:
 *  the reader turns it on when its actions no longer sit beside the card and
 *  the label would otherwise crowd the top row. Prev/next stay full size. */
export function Compact() {
  return (
    <div style={stage}>
      <ChapterNav
        toc={toc}
        chapterStops={chapterStops}
        currentChapter={chapterStops[5]}
        chapterNumbers={chapterNumbers}
        onSelect={noop}
        onPrev={noop}
        onNext={noop}
        hasPrev
        hasNext
        compact
      />
    </div>
  );
}
