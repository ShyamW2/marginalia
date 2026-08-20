import { FindBar } from "@marginalia/web";

/*
 * The reader's find bar (M24.1). Two things it shows rather than implies:
 * the match mode (a reader who searches "the" and gets two marks instead of
 * two hundred deserves to know why), and the result card — a second *view*
 * of the same hits, opened from here because this is where the result set
 * lives.
 */
const noop = () => {};

const hit = (
  spineIndex: number,
  percent: number,
  source: "text" | "highlight" | "note" | "thread",
  snippet: string,
  exact: string,
) => ({
  spineIndex,
  percent,
  highlightId: source === "highlight" ? `hl-${spineIndex}` : null,
  source,
  offset: 0,
  snippet,
  anchor: { exact, prefix: "", suffix: "" },
});

const hits = [
  hit(1, 8, "text", "…the feeling of knowing is not knowledge…", "feeling of knowing"),
  hit(2, 24, "highlight", "…fluency is the feeling that the thing is easy…", "fluency"),
  hit(3, 38, "text", "…asking for a mechanism punctures the feeling…", "mechanism"),
  hit(4, 55, "note", "check this against the interleaving chapter", "interleaving"),
  hit(5, 71, "thread", "…so the feeling is a signal about retrieval, not storage…", "retrieval"),
];

const stage: React.CSSProperties = {
  position: "relative",
  minHeight: 110,
  padding: "10px 0",
};

/** The bar with a live query and hits — the ordinary searching state. */
export function WithHits() {
  return (
    <div style={stage}>
      <FindBar
        query="feeling"
        onQueryChange={noop}
        hits={hits}
        currentIndex={1}
        loading={false}
        onStep={noop}
        onClose={noop}
        onSeeInScan={noop}
        resultsOpen={false}
        onToggleResults={noop}
        matchMode="word"
        onMatchModeChange={noop}
        focusToken={0}
      />
    </div>
  );
}

/** `resultsOpen` is the toggle's own state, not the card: FindBar renders
 *  the "All results" / "Hide results" button (and its aria-pressed), while
 *  ReaderView renders the result card itself. This is what the bar looks
 *  like while that card is open. */
export function ResultsOpen() {
  return (
    <div style={stage}>
      <FindBar
        query="feeling"
        onQueryChange={noop}
        hits={hits}
        currentIndex={1}
        loading={false}
        onStep={noop}
        onClose={noop}
        onSeeInScan={noop}
        resultsOpen
        onToggleResults={noop}
        matchMode="word"
        onMatchModeChange={noop}
        focusToken={0}
      />
    </div>
  );
}

/** `matchMode="substring"` — the other matching rule, shown rather than
 *  implied so the hit count is explicable. */
export function SubstringMode() {
  return (
    <div style={stage}>
      <FindBar
        query="know"
        onQueryChange={noop}
        hits={hits.slice(0, 3)}
        currentIndex={0}
        loading={false}
        onStep={noop}
        onClose={noop}
        onSeeInScan={noop}
        resultsOpen={false}
        onToggleResults={noop}
        matchMode="substring"
        onMatchModeChange={noop}
        focusToken={0}
      />
    </div>
  );
}

/** Searching: the query is in flight and no count can be shown yet. */
export function Loading() {
  return (
    <div style={stage}>
      <FindBar
        query="explanatory depth"
        onQueryChange={noop}
        hits={[]}
        currentIndex={0}
        loading
        onStep={noop}
        onClose={noop}
        onSeeInScan={noop}
        resultsOpen={false}
        onToggleResults={noop}
        matchMode="word"
        onMatchModeChange={noop}
        focusToken={0}
      />
    </div>
  );
}

/** A query with nothing behind it — the empty result state. */
export function NoResults() {
  return (
    <div style={stage}>
      <FindBar
        query="phlogiston"
        onQueryChange={noop}
        hits={[]}
        currentIndex={0}
        loading={false}
        onStep={noop}
        onClose={noop}
        onSeeInScan={noop}
        resultsOpen={false}
        onToggleResults={noop}
        matchMode="word"
        onMatchModeChange={noop}
        focusToken={0}
      />
    </div>
  );
}
