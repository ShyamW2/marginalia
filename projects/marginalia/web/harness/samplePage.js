/**
 * The fake printed page both fold harnesses draw on.
 *
 * Extracted from `pageFold.html` when `pageCone.html` arrived, for one reason
 * that matters: the two harnesses exist to be **compared against each other** —
 * the flat painter's fold beside the hinged mesh's — and two copies of the page
 * generator would let the thing being compared drift out from under the
 * comparison. Nothing here models anything; it is a fixture, close enough to a
 * real epub.js snapshot for judging how a sheet deforms and shades.
 */

/** Reader themes, taken from web/src/theme.css so the harnesses lie about nothing. */
export const THEMES = {
  paper: { bg: "#faf7f0", fg: "#2b2721", head: "#9c8f78" },
  sepia: { bg: "#f4ecd8", fg: "#3b332a", head: "#9c8f78" },
  ink: { bg: "#1c1a17", fg: "#e8e2d6", head: "#7a736a" },
};

export const BODY =
  "from the same campus we stuck together, sharing the load during the morning deliveries and generally looking out for each other. We laughed constantly at the porters' foul-mouthed exchanges. We made a game of things. We had good banter. The mornings flew by whenever our hours coincided, and after a while I began to really fancy her. ¶ But one day something changed. Soph had been moping around through our entire Thursday shift. Every crate of fish we hauled off the trucks suddenly seemed to take her twice the effort. She even complained about the smell, and all of us had deadened to that long ago. It was obvious something was on her mind, so that morning I followed her through the back door of the warehouse, where she always snuck out for a cigarette. ¶ 'Got a spare?' ¶ 'You don't smoke,' she said. ¶ I watched two streams of the stuff billow from her nostrils. 'I'm willing to give it a go.' ¶ 'Bad idea.' ¶ 'I hear you lose weight.'";

export const NEXT =
  "Westermann tried to keep her own body language calm and unflustered, but she'd already wasted an hour she did not have. The bar's aircon was blowing warm and the man opposite her had not once looked up from the datareader he'd brought along. ¶ She sat opposite him. Standard check of her own: no one in the bar watching her now, their attention had moved to other things. From the breast pocket of her cammie tunic, she drew a wafer and laid it on the greasy table, data chip facing up. ¶ Beside it, she piled her winnings. The cash, he scooped away. The wafer, he didn't touch. ¶ 'That is not what we agreed,' he said, still reading. 'You were to bring the whole set, and you have brought me a third of it.' ¶ 'I brought what there was.' ¶ 'Then there is a difficulty, because what there was is not what I paid for.' He set the datareader face down at last, and the noise of the bar seemed to arrive all at once, as though someone had opened a door. 'You understand the position this puts me in.' ¶ She did. She had understood it on the walk over, and had come anyway, which was either courage or the other thing. Outside, the rain had started up again against the awnings, and somewhere down the strip a transport was winding itself up to leave.";

/** A stand-in for a captured page: justified serif body, running head, folio. */
export function makePage(text, theme, folio, { width, height, dpr }) {
  const c = document.createElement("canvas");
  c.width = width * dpr;
  c.height = height * dpr;
  const x = c.getContext("2d");
  x.scale(dpr, dpr);
  x.fillStyle = theme.bg;
  x.fillRect(0, 0, width, height);

  const scale = width / 340;
  x.fillStyle = theme.head;
  x.font = `italic ${9.5 * scale}px Georgia, serif`;
  x.textAlign = "center";
  x.fillText("Circling the Square", width / 2, 28 * scale);

  x.textAlign = "left";
  x.fillStyle = theme.fg;
  x.font = `${13 * scale}px Georgia, serif`;
  const margin = 32 * scale;
  const lineHeight = 18.5 * scale;
  let y = 62 * scale;
  let line = "";
  let indent = 15 * scale;
  for (const word of text.split(/\s+/)) {
    if (word === "¶") {
      if (line) {
        x.fillText(line, margin + indent, y);
        y += lineHeight;
      }
      line = "";
      indent = 15 * scale;
      continue;
    }
    const trial = line ? `${line} ${word}` : word;
    if (x.measureText(trial).width > width - 2 * margin - indent) {
      x.fillText(line, margin + indent, y);
      y += lineHeight;
      line = word;
      indent = 0;
    } else {
      line = trial;
    }
    if (y > height - 48 * scale) break;
  }
  if (line && y <= height - 48 * scale) x.fillText(line, margin + indent, y);

  x.fillStyle = theme.head;
  x.textAlign = "center";
  x.font = `${10 * scale}px Georgia, serif`;
  x.fillText(folio, width / 2, height - 26 * scale);
  return c;
}

/** Two pages side by side on one bitmap — the reader's *card* in spread mode,
 * which is what the fold is handed and what `leafSourceRect` slices. */
export function makeSpread(left, right, theme, folios, { width, height, dpr }) {
  const c = document.createElement("canvas");
  c.width = width * 2 * dpr;
  c.height = height * dpr;
  const x = c.getContext("2d");
  x.drawImage(makePage(left, theme, folios[0], { width, height, dpr }), 0, 0);
  x.drawImage(makePage(right, theme, folios[1], { width, height, dpr }), width * dpr, 0);
  return c;
}

/**
 * The hand-driven fold states worth looking at every time something changes,
 * in **leaf-local** px. Shared between the two harnesses so "drag-50" means
 * the same drag in both, which is the only way the flat painter and the hinged
 * mesh can be held side by side and believed.
 *
 * (`pageFold.html` adds its own `auto-*` states from `syntheticFoldPointer`.
 * Those stay there: that sweep is the flat model's, and a bound sheet cannot
 * follow it — see NOTES.md 2026-08-26.)
 */
export function foldStates(width, height) {
  return {
    "peel-20": ["bottomRight", { x: width - width * 0.4, y: height - height * 0.12 }],
    "drag-50": ["bottomRight", { x: width - width * 0.72, y: height - height * 0.3 }],
    "edge-pull": ["bottomRight", { x: width - width * 0.45, y: height - 6 }],
    "top-corner": ["topRight", { x: width - width * 0.55, y: height * 0.26 }],
  };
}

/**
 * A page that is *only* an orientation cue: one huge glyph, a corner tick and a
 * folio. Prose is unreadable at fold sizes and a mirrored paragraph looks much
 * like an upside-down one, which is how a texture `flipY` and an inverted
 * triangle winding hid behind each other for three renders. A letter cannot.
 */
export function makeMarkerPage(letter, theme, folio, { width, height, dpr }) {
  const c = document.createElement("canvas");
  c.width = width * dpr;
  c.height = height * dpr;
  const x = c.getContext("2d");
  x.scale(dpr, dpr);
  x.fillStyle = theme.bg;
  x.fillRect(0, 0, width, height);
  x.fillStyle = theme.fg;
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.font = `bold ${Math.min(width, height) * 0.55}px Georgia, serif`;
  x.fillText(letter, width / 2, height / 2);
  // A tick in the top-left only: tells top from bottom *and* left from right,
  // which one centred glyph cannot.
  x.fillStyle = "#d2453f";
  x.fillRect(10, 10, width * 0.22, 12);
  x.fillRect(10, 10, 12, height * 0.16);
  x.fillStyle = theme.head;
  x.font = `${11}px Georgia, serif`;
  x.fillText(folio, width / 2, height - 22);
  return c;
}
