import { MarginRail } from "@marginalia/web";

/*
 * The reader's margin rail: one mark per highlight in the current section,
 * in the margin beside the text. `unanchoredIds` is the honest failure state
 * — a highlight whose anchor could not be resolved against this rendering is
 * shown as unanchored rather than silently dropped or placed at a guess.
 */
/* HighlightKind is the colour name, not the semantic one: rose = revisit,
   sage = definition, honey = quote, slate = question (theme.css). */
const noop = () => {};

const highlight = (
  id: string,
  kind: "rose" | "sage" | "honey" | "slate",
  exact: string,
  note: string,
  spineIndex: number,
  thread: unknown = null,
) => ({
  id,
  resourceId: "res-1",
  kind,
  importance: 2,
  note,
  panelDx: 0,
  panelDy: 0,
  panelWidth: null,
  panelHeight: null,
  createdAt: "2024-05-15T10:00:00.000Z",
  exact,
  prefix: "",
  suffix: "",
  cfi: `epubcfi(/6/${spineIndex}!/4/2)`,
  spineIndex,
  thread,
});

const thread = {
  id: "th-1",
  highlightId: "hl-2",
  messages: [
    { role: "user", content: "Why does fluency mislead here?" },
    { role: "assistant", content: "Because ease of processing is mistaken for evidence of understanding." },
  ],
};

const highlights = [
  highlight("hl-1", "rose", "the feeling of knowing is not knowledge", "come back to this", 3),
  highlight("hl-2", "slate", "fluency is such a reliable trap", "", 3, thread),
  highlight("hl-3", "sage", "desirable difficulty", "the core term", 3),
  highlight("hl-4", "honey", "like every signal it can be produced without the thing it stands for", "", 3),
];

const stage: React.CSSProperties = {
  position: "relative",
  minHeight: 220,
  padding: "10px 0",
};

/** The rail with a section's worth of marks — one per highlight kind, so the
 *  rose/sage/honey/slate vocabulary is all on the card at once. */
export function WithHighlights() {
  return (
    <div style={stage}>
      <MarginRail
        highlights={highlights}
        currentSpineIndex={3}
        unanchoredIds={new Set<string>()}
        onNavigate={noop}
        onDelete={noop}
        onOpenThread={noop}
      />
    </div>
  );
}

/** `unanchoredIds` — anchors that could not be resolved against this
 *  rendering. Shown as unanchored rather than dropped or guessed at. */
export function WithUnanchored() {
  return (
    <div style={stage}>
      <MarginRail
        highlights={highlights}
        currentSpineIndex={3}
        unanchoredIds={new Set(["hl-3", "hl-4"])}
        onNavigate={noop}
        onDelete={noop}
        onOpenThread={noop}
      />
    </div>
  );
}

/*
 * No "other section" story: MarginRail renders the highlights it is handed
 * and does not filter by `currentSpineIndex` itself (the reader passes the
 * section's own set), so such a cell would be identical to WithHighlights.
 */
