import { useRef } from "react";
import { HeatStrip } from "@marginalia/web";

/*
 * The Scan's heat strip — the whole book at once (M19.5, "the semantic scan:
 * two layers"). Mine is the reader's own highlights as a heat field; Book is
 * the thematic chapter layer underneath. Either can be shown alone or both
 * together, which is what the stories below vary.
 *
 * `warpGeometry` is the CRT barrel distortion in the wrapper's own px — the
 * identity geometry (maxPull 0) is exactly "the effect is off", which is what
 * a still card wants.
 */
const scanScope: React.CSSProperties = {
  ["--color-bg" as string]: "#05070a",
  ["--color-bg-raised" as string]: "#0d1318",
  ["--color-text" as string]: "#cfeeff",
  ["--color-text-muted" as string]: "rgba(207, 238, 255, 0.6)",
  ["--color-border" as string]: "rgba(140, 220, 255, 0.25)",
  ["--color-accent" as string]: "#5ec8ff",
  ["--color-accent-text" as string]: "#04141c",
  ["--color-highlight" as string]: "rgba(94, 200, 255, 0.15)",
  ["--color-highlight-active" as string]: "rgba(94, 200, 255, 0.3)",
  ["--font-mono" as string]: 'ui-monospace, "SF Mono", "Cascadia Code", monospace',
  background: "var(--color-bg)",
  color: "var(--color-text)",
  padding: 18,
  borderRadius: 10,
};

/* ScanChapter percents are fractions (0–1) in the schema, not 0–100. */
const chapters = [
  { title: "Preface", spineIndex: 0, chapterNumber: 0, startPercent: 0, lengthPercent: 0.06 },
  { title: "What Knowing Feels Like", spineIndex: 1, chapterNumber: 1, startPercent: 0.06, lengthPercent: 0.15 },
  { title: "The Curse of Fluency", spineIndex: 2, chapterNumber: 2, startPercent: 0.21, lengthPercent: 0.13 },
  { title: "The Illusion of Explanatory Depth", spineIndex: 3, chapterNumber: 3, startPercent: 0.34, lengthPercent: 0.18 },
  { title: "Desirable Difficulty", spineIndex: 4, chapterNumber: 4, startPercent: 0.52, lengthPercent: 0.16 },
  { title: "Interleaving", spineIndex: 5, chapterNumber: 5, startPercent: 0.68, lengthPercent: 0.23 },
];

const bookChapters = [
  { spineIndex: 0, themes: [], hasThematic: false },
  { spineIndex: 1, themes: ["metacognition", "fluency"], hasThematic: true },
  { spineIndex: 2, themes: ["fluency"], hasThematic: true },
  { spineIndex: 3, themes: ["explanation", "metacognition"], hasThematic: true },
  { spineIndex: 4, themes: ["effort", "retrieval"], hasThematic: true },
  { spineIndex: 5, themes: ["retrieval", "scheduling"], hasThematic: true },
];

/* HighlightKind is the COLOUR name, not the semantic one: rose = revisit,
   sage = definition, honey = quote, slate = question (theme.css, DESIGN.md).
   Passing "revisit" here throws inside phosphorHue, which indexes its
   palette by kind.

   The strip takes ScanHighlight (schemas.ts), NOT the reader's Highlight:
   it carries the scan's own `themes` signal, a fractional positionPercent,
   and denormalised thread facts. Omitting `themes` throws
   "undefined is not iterable" inside the heat field. */
const mk = (
  id: string,
  kind: string,
  positionPercent: number,
  importance: number,
  exact: string,
  themes: string[],
  thread?: { id: string; count: number; first: string; answered: boolean },
) => ({
  id,
  kind,
  exact,
  importance,
  tags: [],
  themes,
  note: "",
  positionPercent,
  threadId: thread?.id ?? null,
  hasAnswer: thread?.answered ?? false,
  threadMessageCount: thread?.count ?? 0,
  threadFirstLine: thread?.first ?? null,
});

const highlights = [
  mk("hl-1", "rose", 0.08, 3, "the feeling of knowing is not knowledge", ["metacognition"]),
  mk("hl-2", "slate", 0.12, 2, "a signal that can be produced without the thing", ["metacognition"], {
    id: "th-1",
    count: 4,
    first: "Why does fluency mislead here?",
    answered: true,
  }),
  mk("hl-3", "sage", 0.24, 1, "fluency", ["fluency"]),
  mk("hl-4", "honey", 0.38, 3, "asking for a mechanism punctures it", ["explanation"]),
  mk("hl-5", "rose", 0.44, 2, "explanatory depth", ["explanation"]),
  mk("hl-6", "sage", 0.57, 3, "desirable difficulty", ["effort"]),
  mk("hl-7", "rose", 0.74, 1, "interleaving beats blocking", ["scheduling"]),
];

const identityWarp = { width: 820, height: 120, cx: 410, cy: 60, r: 311, maxPull: 0 };
const noop = () => {};

function Strip(props: { showMine: boolean; showBook: boolean; litIds?: Set<string>; litTheme?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="register-glass" style={scanScope}>
      <div ref={ref}>
        <HeatStrip
          chapters={chapters}
          highlights={highlights}
          litIds={props.litIds ?? new Set(highlights.map((h) => h.id))}
          showMineLayer={props.showMine}
          bookChapters={bookChapters}
          showBookLayer={props.showBook}
          litTheme={props.litTheme ?? ""}
          onOpenChapter={noop}
          warpGeometry={identityWarp}
          warpWrapperRef={ref}
          onOpen={noop}
          onImportanceChange={noop}
          onTagsChange={noop}
          searchHits={[]}
          searchCursorIndex={0}
          onStepSearchCursor={noop}
          onOpenSearchHit={noop}
        />
      </div>
    </div>
  );
}

/** Both layers: the reader's own heat over the book's thematic bands. */
export function BothLayers() {
  return <Strip showMine showBook />;
}

/** Mine only — the heat field and bands of what you marked, with the book
 *  layer switched off. */
export function MineOnly() {
  return <Strip showMine showBook={false} />;
}

/** Book only — the thematic chapter layer with no highlights over it. A band
 *  with no highlight under it clicks through to the chapter start. */
export function BookOnly() {
  return <Strip showMine={false} showBook />;
}

/** A filter in force: `litIds` narrows which highlights are lit, and
 *  `litTheme` narrows the book bands to one theme. Everything else stays
 *  visible but unlit rather than disappearing. */
export function Filtered() {
  return <Strip showMine showBook litIds={new Set(["hl-4", "hl-5"])} litTheme="explanation" />;
}
