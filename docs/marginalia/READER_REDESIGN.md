# Reader chrome v2 — implementation brief

## What this is

A rework of the Marginalia reader's chrome: the strip above the page, the bar
below it, the annotation editor, in-book search, and a new fullscreen mode. The
driving problem: as the reading pane widens or narrows, controls were being
dropped to avoid colliding with the floating nav — so the digest state and the
progress indicator vanished exactly when the reader wanted them. The fix is to
stop hiding things and start *nesting* them: expanding clusters for grouped
functions, progress moved to its own bottom line, per-pane responsive rows.

Design source: `templates/reader-chrome-v2/ReaderChromeV2.dc.html` in the
Marginalia design-system project (the sub-frames are live — hover, drag, expand
them). Frames: `ReaderShellV2`, `ReaderStripStackedV2`, `AnnotationEditorV2`,
`SearchPebbleV2`, `FullscreenReaderV2`.

**Read the design files, don't measure the screenshots.** Exact spacing, radii
and token usage only exist in the inline styles of those `.dc.html` files. They
are inline-styled React templates for previewing — translate to our CSS modules,
don't copy the markup. Reference values already fixed there: strip rows
`padding:8px 10px` / `min-height:44px` (top) and `6px 10px` / `40px` (second
row), foot `8px 10px` / `40px`, card radius `14px`, pebbles `border-radius:999px`
with `2px 4px` padding and `box-shadow:var(--control-shadow-rest)`, icons `16px`,
row separators `1px solid color-mix(in srgb, var(--color-border) 60%,
transparent)`, metadata in `12px var(--control-font)`, body in `14px/1.75
var(--font-serif)`.

## 1. Top strip → one 48px line

Left cluster (reader functions): annotation count chip · ‹ chapter › · digest ·
listening. Centre: cover + title + author. Right: nav pebble (library, search,
scan, settings, theme trio).

- Remove the clock icon entirely.
- Digest and listening are **expanding clusters**, not rows of buttons.
- Job state ("Digesting… 40%") renders as a ring on the digest icon, never as a
  width change in the strip.

### Expand behaviour (shared)
Pointer: open on hover after 120ms, close 140ms after pointer-out (so crossing
between icons doesn't flicker). Touch: long-press ~380ms. Click pins open; Esc
or outside-click closes. Panel grows from its control — use `FlyPanel`.

Digest panel: Digest this chapter · Open digest · digest model select.
Listening panel: ⏮ ▶ ⏭ · read-from-here · speed · cast target.

## 2. Bottom bar

‹ page-turn ··· `Page n of m` | `nn%` ··· page-turn › and an instruments pebble
(heat strip, search, fullscreen) at the right. Dragging the % raises the real
`SliderDial` popover with its chapter tick (`extraTicks`).

## 3. Responsive

Breakpoint on the **pane** width via container query, not the viewport.

- `> 600px`: single line as above.
- `<= 600px`: two rows. Row 1 = cover + title + nav pebble (theme collapses to a
  single cycling icon). Row 2 = annotations · ‹ chapter › (label takes the slack,
  centred) · digest · listening · fullscreen. Foot shows `1 / 11` + `%` only.

## 4. Annotation editor

Query model moves here from the strip. Preferred treatment: a small model
`<select>` immediately left of **Ask** (variant A). Cog-to-settings (variant B)
is the fallback if more than one setting ever lands here.

Narrow (~300px, the realistic docked width): *Web search* becomes a globe icon
toggle; model select shows short names only. Action row order is always
ladder (Off/Digest/Full) · web search · model · Ask. Below ~280px, wrap the
model select above the row rather than compressing Ask.

**Narrow variants — resolved.** These were explored as tweaks on
`ReaderChromeV2.dc.html` and settled; build these, don't re-open them:

| Control | Wide | Narrow (~300px) |
| --- | --- | --- |
| Context ladder | 3-segment Off/Digest/Full | **dropdown** (single select) |
| Web search | labelled toggle | globe icon toggle |
| Model | full names | **dropdown**, short names |
| Ask | labelled button | **labelled** — keep the word "Ask", not `›` |

The point of collapsing the ladder and model to dropdowns is precisely to buy
the width that keeps Ask legible. An icon-only Ask is the thing to avoid.

## 5. Search vs Scan (new)

- Magnifier = **Search** (find in book). Scan gets its own glyph: bars inside a
  rounded frame, echoing the heat strip it opens. Both live in the nav pebble.
- Search UI becomes a **pebble**, floating over the page, not a full-width band:
  magnifier · query input · match count · ‹ › · whole-word toggle · **List**
  toggle · open-in-Scan · close.
- `List` opens a movable results window reusing the annotation-window shell
  (drag handle, close, remembers position).

### Results window hierarchy
1. Title bar: `"query"` + `23 in 4 chapters` + order control + close.
2. Sticky chapter headers with per-chapter counts.
3. Rows: snippet in the serif reading face (single line, ellipsised), page and %
   in a quiet tabular right column. Only the selected row is coloured — 2px
   accent left edge + accent wash at ~12%.
4. Footer: `↑↓ move · ⏎ jump · ⇧⏎ open in Scan` + `Show all 23`.

Dropped from the old list: per-row chapter name, per-row highlight boxes (only
the *current* match is marked, in the page), the second metadata line.

## 6. Fullscreen (F)

No card, no strips, no rail. Vignette holds the column; position is a 2px
hairline on the bottom edge; highlights become faint dots at the right edge.
Pointer movement wakes one pebble (page, %, digest, listening, exit) that sleeps
after ~2s. Open questions: does text selection open the editor inline or a
fullscreen-native side sheet; should scroll re-sleep the pebble.

## Components to touch

**Existing** — these are real files in the repo; find and extend them rather than
rewriting: `FindBar` (becomes the search pebble), `NavCluster`, `ChapterNav`,
`SliderDial`, `ProgressPopover`, `FlyPanel`, `HeatStrip`, `ProviderPicker`,
`AskPill`, `IconButton`.

**New** — the names below are *proposals from the design, not existing files*.
Don't hunt for them; create them, and rename freely to match repo convention:
`ScanIcon`, `GlobeIcon`, `SearchResultsWindow`, `ExpandingCluster` (the shared
hover / long-press wrapper from §1), `ImmersiveOverlay`.

Styling comes from the tokens already in `styles.css` — no new colours; the
selected-row wash is `color-mix(in srgb, var(--color-accent) 12%, transparent)`.

## Ground rules

- No new colour values. Everything resolves to existing tokens; use
  `color-mix()` against them for washes and softened borders.
- Responsive decisions key off the **pane** (container query), never the
  viewport — the reader can be docked beside other panes.
- Nothing disappears to make room. If it doesn't fit, it nests inside an
  expanding cluster or moves to the second row.
- Motion uses `--ease-standard` / `--duration-standard`; controls use
  `--control-hover-transform` / `--control-pressed-transform`.
- Every expanding cluster and pebble needs a keyboard path: Esc closes, focus
  returns to the control, and the panel is a proper focus trap while pinned.

## Open questions for the build

1. Fullscreen text selection — inline editor over the column, or a
   fullscreen-native side sheet?
2. Should scrolling re-sleep the fullscreen pebble, or only pointer idle?
3. Search results window and the annotation window share a shell — do they share
   a single remembered position, or one each?
