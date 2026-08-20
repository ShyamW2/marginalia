import { SliderDial } from "@marginalia/web";

/*
 * SliderDial is the readout that flies out *under* a Slider while you drag it
 * — `position: absolute; top: calc(100% + 0.4rem)` relative to the control it
 * belongs to. It is normally mounted only for the duration of a gesture, so a
 * card has to supply the positioned ancestor and the room below it. Rendering
 * it directly is the only way to see it statically; in app code you get it for
 * free by dragging a Slider.
 */
/* The dial hangs off the bottom of its positioned ancestor
   (`top: calc(100% + 0.4rem)`), and being absolute it contributes no height.
   So: an outer box that reserves real vertical room for the capture, and a
   short inline anchor inside it that the dial measures itself against. */
const stage: React.CSSProperties = { height: 210, paddingTop: 4 };

/* The dial centres itself on its ancestor (`left: 50%; translateX(-50%)`), so
   that ancestor must be at least as wide as the dial (~290px) or the dial is
   pushed off the left edge and clipped — it renders, it just isn't on screen. */
const anchor: React.CSSProperties = {
  position: "relative",
  display: "block",
  width: 320,
  margin: "0 auto",
  textAlign: "center",
};

const anchorLabel: React.CSSProperties = {
  font: "500 13px var(--font-sans)",
  color: "var(--color-text-muted)",
};

/** The linear dial: a ruler whose ticks are the slider's own detents, the
 *  live value as a formatted readout, and the release/cancel hint. */
export function LinearDial() {
  return (
    <div style={stage}>
      <span style={anchor}>
      <span style={anchorLabel}>Reader pane width</span>
      <SliderDial
        value={68}
        min={40}
        max={100}
        scale="linear"
        dragPxPerUnit={4}
        ticks={[50, 68, 80, 100]}
        formatValue={(v) => `${Math.round(v)}% of page`}
        ariaLabel="Reader pane width"
      />
      </span>
    </div>
  );
}

/** The log2 dial: `dragPxPerUnit` is pixels per *octave* and must match the
 *  slider's own value, or the ruler and the drag disagree. */
export function LogarithmicDial() {
  return (
    <div style={stage}>
      <span style={anchor}>
      <span style={anchorLabel}>Max response tokens</span>
      <SliderDial
        value={16384}
        min={1024}
        max={200000}
        scale="log2"
        dragPxPerUnit={140}
        ticks={[2048, 8192, 32768, 131072]}
        formatValue={(v) => `${Math.round(v).toLocaleString()} tokens`}
        ariaLabel="Max response tokens"
      />
      </span>
    </div>
  );
}

/** `extraTicks` are labelled marks a consumer adds on top of the ruler — the
 *  reader's chapter stops — and `hint` overrides the default footer line. */
export function WithChapterTicks() {
  return (
    <div style={stage}>
      <span style={anchor}>
      <span style={anchorLabel}>Position in book</span>
      <SliderDial
        value={42}
        min={0}
        max={100}
        scale="linear"
        dragPxPerUnit={6}
        ticks={[0, 25, 50, 75, 100]}
        extraTicks={[
          { value: 12, label: "I" },
          { value: 42, label: "II" },
          { value: 74, label: "III" },
        ]}
        formatValue={(v) => `${Math.round(v)}%`}
        ariaLabel="Position in book"
        hint="Release to jump · Esc to cancel"
      />
      </span>
    </div>
  );
}
