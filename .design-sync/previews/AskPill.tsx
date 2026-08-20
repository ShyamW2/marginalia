import { AskPill } from "@marginalia/web";

/* "The highlight is the prompt": AskPill is the pill that appears over a text
   selection. It is absolutely positioned at (left, top), so the stage supplies
   a page-like ground with some real prose for it to sit over. */
const stage: React.CSSProperties = {
  position: "relative",
  height: 190,
  padding: "18px 20px",
  borderRadius: 10,
  background: "var(--color-bg)",
  border: "1px solid var(--color-border)",
  overflow: "hidden",
};

const prose: React.CSSProperties = {
  margin: 0,
  maxWidth: 520,
  font: "400 15px/1.7 var(--font-serif)",
  color: "var(--color-text)",
};

const selected: React.CSSProperties = {
  background: "var(--color-highlight)",
  borderRadius: 2,
};

const noop = () => {};

/** The pill over a live selection — the four highlight kinds plus Ask and
 *  "play from here", exactly the choice the reader is offered. */
export function OverSelection() {
  return (
    <div style={stage}>
      <p style={prose}>
        The feeling of knowing is not knowledge. It is a signal, and{" "}
        <span style={selected}>like every signal it can be produced without the thing it stands for</span> —
        which is why fluency is such a reliable trap.
      </p>
      <AskPill left={190} top={110} onPickKind={noop} onAsk={noop} onPlayFromHere={noop} />
    </div>
  );
}

/** Positioned near the top of the pane, as it is when the selection is on the
 *  first line — the pill is placed by the caller, not self-positioning. */
export function NearTop() {
  return (
    <div style={stage}>
      <p style={prose}>
        <span style={selected}>Desirable difficulty</span> is the name for effort that pays.
      </p>
      {/* `left` is the pill's CENTRE, so keep it at least half the pill's
          width from the stage edge or the leading kind dot is clipped. */}
      <AskPill left={170} top={64} onPickKind={noop} onAsk={noop} onPlayFromHere={noop} />
    </div>
  );
}
