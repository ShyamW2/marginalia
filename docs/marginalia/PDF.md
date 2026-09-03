# PDF — the format arc (M39–M41)

*Standing specification for PDF support. **Binding for M39, M40, M41.** Decided
2026-09-03 in a design session; the reasoning and the preserved disagreement are in
`docs/decisions.md` under that date. TASKS.md carries the ordered work; this document
carries the rules that must hold however it is built.*

Read alongside: `SPEC.md` (the anchoring rule this amends), `AUDIO.md` (whose cast
depends on §5's document kinds), `docs/REFACTORING.md` (binding for M40 §A).

---

## 1. What is being built, and why in this order

Two reading paths, exactly as the operator framed them:

- **Reflow** (M39) — a digital PDF is transformed at import into a generated EPUB and
  read in the existing reading pane, with every reader feature and every LLM feature
  working unchanged.
- **Native** (M40–M41) — a PDF is rendered as itself, page images and all, with
  highlights and the inline LLM working on top of it.

Reflow ships first **not** because native is optional but because reflow is the cheap
proof that extraction works at all. If the extractor produces garbage, native reading
inherits the same garbage in its text layer, its `resource_text`, its digest and its
scan — it just hides the problem behind a picture of the page. **Extraction quality is
the risk in this arc; the renderer is only the work.**

### The measurement gate (M39 §A, blocking)

Before any UI is designed, the extractor must be run over **five real PDFs of different
shapes** — a two-column paper with figures and equations, a single-column preprint, a
report with tables, a PDF-of-a-book with an outline, and a scanned document — and its
plain-text output read by a person. This gate exists because a plausible-looking
extractor that interleaves columns produces text that is *subtly* wrong: it reads fine in
a diff and destroys every downstream feature silently. Ship nothing until the five
outputs are readable prose in the right order.

---

## 2. Identity, immutability, and the extractor version

Settled decision 5 (immutable-on-import) is what keeps anchors from rotting. An extractor
that will certainly be improved is in direct tension with it: improve the column detector,
and either already-imported PDFs never benefit, or re-extraction rewrites text under live
highlights.

**Ruling.** A PDF resource's id is:

```
sha256(pdfBytes ‖ ":" ‖ EXTRACTOR_VERSION)
```

`EXTRACTOR_VERSION` is a single integer constant in `server/src/library/pdf/version.ts`,
bumped by hand whenever a change to extraction alters its output.

This gives all three properties at once:

- Re-importing the same PDF under the same extractor is a no-op, as it is for EPUB.
- Re-importing after an extractor upgrade produces a **new, separate resource** beside
  the old one. Nothing is ever rewritten in place, so decision 5 holds without exception.
- "Which resources predate the fix" is answerable from the id alone.

**The cost, stated plainly:** highlights do not follow across the upgrade. They are not
lost — the old resource still holds them — but they are on the old copy.

**The migration path is cheap and already exists.** Anchors are text-first
(`shared/anchorText.ts`'s `findAnchorInText`, and `sectionOffsets.ts`'s `locateAnchor`,
which already falls back across every section in spine order). A CLI —
`server/src/cli/reanchorPdf.ts`, `pnpm --filter @marginalia/server reanchor <oldId> <newId>` —
re-locates every highlight from the old resource in the new one by quote + prefix/suffix,
reports how many resolved, and moves the resolved ones with their threads, notes, tags and
panel positions. Highlights that do not resolve stay on the old resource and are reported
by count. **No UI in M39.** A reader must never trigger a silent re-extraction.

⚠️ **EPUB identity does not change.** `importEpub` keeps `sha256(bytes)`. Do not
"unify" the two — an EPUB's extraction is settled and its ids are already in databases.

### 2.1 Import is a job, and its failure paths are designed

**PDF import runs through the existing jobs registry (`server/src/jobs/registry.ts`); EPUB
import stays synchronous.** They are genuinely different costs: EPUB extraction is an unzip
and an HTML parse, while PDF extraction walks every page's text items, detects columns and
rasterizes regions. A 400-page PDF would block the single-process server — and therefore
block *reading* — for the length of the import.

`POST /api/resources` returns a `jobId` for a PDF and the finished `Resource` for an EPUB.
`JobKindSchema` (`shared/src/schemas.ts`) gains `"pdf-import"`, and the Desk shows its
progress through the tray it already has. Progress is reported per page, so "extracting
page 12 of 30" is available rather than an indeterminate spinner.

⚠️ Do not "unify" this by making EPUB import a job too. EPUB import is instant, its
synchronous route is depended on by the Desk's optimistic flow, and changing it is
unrelated work hiding inside this milestone.

**Designed failure states**, each returning a specific error the Desk explains rather than a
generic import failure:

| Condition | Error | What the reader sees |
|---|---|---|
| Password-protected / encrypted | `encrypted_pdf` | "This PDF is password-protected. Marginalia can't open it." |
| Corrupt or not actually a PDF | `invalid_pdf` | "This file isn't a readable PDF." |
| No text layer | *not an error* | Imports as a scan (§6) |
| Over the 200 MB multer limit | existing multer path | unchanged |

### On-disk layout

```
LIBRARY_DIR/<id>.pdf            the original bytes — the resource's identity
LIBRARY_DIR/<id>.reflow.epub    generated, derived; what the reflow pane renders
```

The generated EPUB is a **derived artifact**, not a resource. It may be regenerated from
the PDF at any time by the same extractor version and must be byte-reproducible when it
is (no timestamps, no random ids, no map iteration order in the output). If it is missing
at read time, regenerate it rather than failing.

---

## 3. Extraction

`server/src/library/pdf/` — extraction is **server-side**, matching `epub.ts`. The
server already owns text extraction (adm-zip + htmlparser2 for EPUB); PDF is the same
responsibility with a different parser, not a new home for one.

**Dependencies (decided 2026-09-03, before implementation):** `pdfjs-dist` in its Node
build, plus **`@napi-rs/canvas`**.

`getTextContent()` is pure JS and needs no canvas; `page.render()` — which §3.4's equation
bands, §3.5's figures and the PDF's cover image all go through — does, and Node has none.
`@napi-rs/canvas` was chosen over `canvas` (node-canvas) deliberately: it ships **prebuilt
N-API binaries**, so there is no node-gyp step and no per-Node-ABI rebuild. That matters
here specifically — this repo has already lost time to `better-sqlite3` ABI mismatches
killing the server silently across the Mac (Node 20) / Linux (Node 24) split, and N-API's
forward compatibility across Node majors is precisely the property that failure lacked.

⚠️ **Rasterization degrades; it never fails the import.** If the canvas module is missing or
throws, extraction continues text-only: the figure's caption still enters `resource_text`,
the `<figure>` is omitted rather than half-written, and the import logs once. A reader on a
machine where the native module didn't install gets a readable paper without pictures, not a
library they cannot add to.

Use `pdfjs-dist` in its Node build. `getTextContent()` returns items carrying
`transform` (a 6-element matrix — `transform[4]` is x, `transform[5]` is y), `width`,
`height`, and `fontName`. Everything below is derived from those; no heuristic may depend
on the order `getTextContent()` happens to return items in.

### 3.1 Running headers and footers

Drop an item only when it is **both** in the top or bottom ~7% band **and** its text
repeats (after digit-stripping, so page numbers normalise together) on **three or more
pages**.

⚠️ Position alone is not the test. A paper's title and its first section heading sit in
the top band on page 1, and a band-only rule eats them.

### 3.2 Columns

Per page, after header/footer removal:

1. Build a histogram of item left edges (`transform[4]`).
2. Two columns are declared only when the histogram is bimodal with a gap ≥ 5% of page
   width **and** both modes hold ≥ 25% of the page's items. Anything else is one column.
3. Assign each item to the nearest column by left edge; sort within a column by
   descending y, then ascending x; emit column 1 fully, then column 2.

Single-column is the default and the fallback. A wrongly-declared two-column page is far
more destructive than a missed one.

⚠️ **Full-width elements break the column model** — a paper's title block, an abstract,
and figures spanning both columns. An item wider than 70% of the page width is emitted in
y-order at its own position, outside the column sort, or the title lands in the middle of
the introduction.

### 3.3 Lines, hyphens, paragraphs

- **Line**: items whose y differ by less than 0.5 × the page's median line height.
- **Join**: items on a line join with a single space, unless the gap between them is
  under ~0.15 × font size, in which case they join with none (kerned runs arrive as
  separate items).
- **De-hyphenate**: a line ending in `-` immediately followed by a lowercase-initial
  line joins with the hyphen removed. Never de-hyphenate before a capital or a digit —
  "Fourier-Transform" and "GPT-4" are not line breaks.
- **Paragraph break**: a vertical gap > 1.4 × median line spacing, **or** a line whose
  left edge exceeds the column's modal left edge by more than ~1 em (an indent).

### 3.4 Equations — do not reconstruct

A display equation arrives as dozens of tiny glyph items with erratic transforms and
mixed font names. Reconstructing it as text produces garbage that then poisons the
digest, search, and the audio narration.

**Rule: detect and rasterize.** A run of lines whose item-count-per-character exceeds
~2.5 and whose items span three or more distinct `fontName`s is an equation band. Replace
it with an image (§3.5's mechanism) and emit **nothing** into `resource_text` for it.

Inline math inside a paragraph is out of scope — it stays as whatever text extraction
gives, and that is accepted.

### 3.5 Figures, tables, and the images that survive

A **figure region** is a rectangle of the page containing no text items, bounded by
whitespace, with area > 4% of the page, whose nearest line above or below matches
`/^(Fig(ure)?|Table|Algorithm|Chart|Scheme)\.?\s*\d+/i`.

Rasterize the region at 2× scale to PNG via pdf.js's canvas renderer with a clip, and
embed it in the generated EPUB as `images/fig-p<page>-<n>.png`, placed as a `<figure>` at
the reading position of its caption.

⚠️ **The image never enters `resource_text`. The caption always does.** The caption is
how the digest, the scan and search find a figure at all; the image is not text and must
not become a row of pixels-as-characters in the book's text substrate.

---

## 4. The spine

**The spine unit for a converted PDF is a detected section, never a page.**

This is the single most consequential extraction decision. Every LLM feature in the app
is chapter-shaped — the digest's unit, the scan's bands, the context ladder's selection
(decision 8), the spoiler mask's `spine_index <= bookmark` filter, audio's per-section
manifests. Make each page a spine item and a 30-page paper becomes a 30-chapter book
whose digest is 30 paragraph summaries and whose scan is meaningless.

**Fallback ladder, in order:**

1. **The PDF outline** (`getOutline()`), if present. Authoritative — most PDF books and
   many papers have one. Use it and stop.
2. **Detected headings.** A line is a heading when its font size exceeds the document's
   modal body size by ≥ 15%, it is under ~120 characters, and it begins a line. Common
   paper section names (`Abstract`, `Introduction`, `Related Work`, `Method(s)`,
   `Results`, `Discussion`, `Conclusion`, `References`, `Appendix`) match
   case-insensitively as a secondary signal, never as the only one.
3. **One section for the whole document**, if it is under 40 pages. Correct for a paper —
   the digest degrades gracefully to a single chapter, which is the right shape for a
   12-page document.
4. **Fixed groups of 10 pages** otherwise, labelled "Pages 1–10" and so on. Honest about
   being arbitrary.

⚠️ **Outline destinations are page-anchored; sections are not.** A `getOutline()` entry
resolves to a page, but a section that begins one-third of the way down a page must split
that page's text at the heading, not round to the page boundary. Rounding makes
`resource_text` disagree with what the reader shows, and every text-based anchor in the
system is then off by a paragraph.

`href` values are `section-000.xhtml`, `section-001.xhtml`, … — stable, zero-padded, and
stored in `resource_text.href`, so they may not be renumbered by a later extractor change
without a version bump (§2).

### 4.1 The generated EPUB must be a real EPUB

⚠️ A nav-less generated EPUB renders correctly and looks broken everywhere else.
`web/src/reader/toc.ts` reads `book.navigation`; `ChapterNav`, the chapter ticks on the
progress bar, and the percent mapping all hang off it. The generator emits a valid
`container.xml`, a valid OPF with a spine in reading order, **and** an EPUB 3 nav
document with one entry per section.

Section titles go into `metadata.chapterTitles` by the same route EPUB's own
`extractChapterTitles` uses, keyed by `String(spineIndex)`.

---

## 5. Document kinds

The digest is fiction-shaped at the **schema** level, not the copy level
(`server/src/digest/build.ts`): chapter digests return `characters`, and the book reduce
returns `cast` and `narratorGender`. Asking those of a scientific paper produces noise
that then flows into the context ladder and the scan, and `cast` cannot simply be dropped
because it is what drives multi-voice audio casting (AUDIO.md).

**Ruling: one new axis, `resources.kind`, with exactly two values.**

⚠️ **"Scanned" is not a third kind.** Genre and "does this have a text layer" are
independent — a scanned novel is a real thing the day OCR arrives — so the text layer is a
separate flag, `resources.text_layer INTEGER NOT NULL DEFAULT 1` (§6). A `scan` value in
this enum would give one kind no schema to select, which is this ruling broken by its own
encoding.

| kind | default for | chapter schema | book schema |
|---|---|---|---|
| `prose` | every EPUB; every existing row (backfill) | `summary`, `themes`, `characters`, `title` | `synopsis`, `cast`, `narratorGender`, `themes` |
| `document` | every reflowed PDF | `summary`, `contributions`, `methods`, `findings`, `limitations`, `themes`, `title` | `synopsis`, `keyClaims`, `methods`, `themes` |

Rules that make this contained rather than a second digest system:

- **`kind` selects a prompt/schema pair. It selects nothing else.** The job machinery,
  the substrate, the thematic layer, the scan, the context ladder and the vault compiler
  are unchanged and must stay unchanged. The thematic layer in particular is already
  genre-neutral and gets no variant.
- **A `document` produces an empty `cast`.** Audio then falls back to M21 single-voice
  narration, which already exists and is the correct behaviour for a paper. No new audio
  path.
- **`kind` is settable by the reader**, in the book's settings, both directions. Detection
  picks the default; a PDF of a novel and an EPUB of a textbook both exist, and neither
  should be stuck.
- **Changing `kind` does not invalidate an existing digest.** It changes what the *next*
  run produces. A stored digest is displayed with whatever shape it was built with — the
  renderer keys off the stored object's fields, not off today's `kind`.

### 5.1 Naming

"Plot" is the wrong word for both kinds once `document` exists. The user-facing control
becomes **"Summarise"**, and the pairing in the reading pane and the Digest is
**Summarise / Analyse Themes**.

This is copy only — roughly six strings (`web/src/digest/DigestPage.tsx` at the Analyse
submenu label, the chapter badge title and the failure notice; `web/src/reader/ReaderView.tsx`'s
`digestCluster`). **Column names, job kinds, API field names and stored JSON keys do not
change.** Renaming those buys nothing and costs a migration.

---

## 6. Scans

A scanned PDF has no text layer. It is a **designed state**, not a failure.

**Detection is per-document, not per-page** (a digital paper with a scanned appendix is
common, and is still a digital paper): a document is a scan when more than 50% of its
pages yield fewer than 100 extracted characters.

A scan imports with `format: 'pdf'`, `text_layer = 0`, its `kind` set by detection like
any other PDF (it is simply unused until OCR exists), **zero `resource_text` rows**, and
opens in the native pane in preview mode: page images, page navigation, zoom. No
highlights, no threads, no LLM, no audio, no digest. The Desk card and the reader strip
both say so plainly — "No text layer — preview only. OCR isn't supported yet." — rather
than showing controls that do nothing.

⚠️ **Zero `resource_text` rows must not crash anything.** The digest, scan, search,
audio and context routes all currently assume at least one section exists. Each needs an
explicit empty path returning an empty result, and each needs a test that passes a
resource with no text rows. This is the most likely source of M39 crash bugs.

OCR is explicitly out of scope for this arc. When it is taken up, it is a new
`EXTRACTOR_VERSION` and a new resource per §2 — never an in-place upgrade of a scan
already in the library.

---

## 7. The renderer seam (M40)

*This section is **not** PDF-specific, and it is the reason M40 is worth its own
milestone: the seam has three consumers, only one of which is a PDF — a scrolling EPUB
surface (§7.4), the native PDF pane, and the scan preview. A seam validated by one new
implementation is weakly validated; three genuinely different surfaces is a real test.*

`ResourceRenderer` is named in CLAUDE.md's engineering discipline as one of the four
narrow seams. **As of 2026-09-03 it does not exist** — grep returns zero hits, and the
reading pane is epub.js top to bottom. M40 is where the document stops lying.

### 7.1 Extract before you add (M40 §A, blocking)

`web/src/reader/ReaderView.tsx` is **4,750 lines with 116 `useState`/`useRef`**. Measured
against `docs/REFACTORING.md`'s own test, it is the textbook "long *and* stateful"
outlier, it is about to receive risky work, and REFACTORING.md's highest-value timing is
"immediately before risky work in the same area."

So M40 begins with a **pure refactor**: lift the epub.js-specific rendering out of
`ReaderView` into `EpubRenderer` behind the interface below, changing no behaviour. Only
then is `PdfRenderer` written as the second implementation.

⚠️ **`ReaderView` must not fork.** The chrome — the strip, the margin rail, the
annotation lifecycle, threads, the ask flow, audio transport, the nav cluster — stays in
one place and stays format-blind. Only the pane's inner rendering is behind the seam. Two
copies of a 4,750-line component is the worst outcome available in this arc, and it is
the outcome that happens by default if the refactor is skipped "for now".

### 7.2 The interface

Prescriptive, not pseudocode — this is the shape M40 §A1 writes, in
`web/src/reader/renderer/types.ts`. Where it is underspecified it says so; do not fill a
gap silently.

```ts
// ── Position ──────────────────────────────────────────────────────────────
/** Format-neutral position. Offsets are into the section's own text — the
 *  domain `resource_text` stores. `cfi` is EPUB's fast path, never required. */
export interface Locator {
  sectionIndex: number;
  offset: number;
  /** 0 for a caret (a reading position) rather than a range (a highlight). */
  length: number;
  cfi?: string;
}

/** What goes into `reading_state.location` (TEXT NOT NULL) and comes back out.
 *  ⚠️ A bare CFI string is valid input — every row written before M40 is one —
 *  so the parser accepts both and the writer emits the new form. */
export type SerializedLocator = string;

// ── Capabilities: the chrome asks these, never the format ────────────────
export interface RendererCapabilities {
  spread: boolean;
  fontScale: boolean;
  margins: boolean;
  pageFold: boolean;
  pageNumbers: boolean;
  textSelection: boolean;
  /** "page"   — discrete turns (today's EPUB pane)
   *  "scroll" — continuous within a section (M40 §C)
   *  "image"  — fixed pages, no reflow (M41's native PDF)
   *  Drives which progress readout the strip shows. */
  advance: "page" | "scroll" | "image";
}

// ── Events ────────────────────────────────────────────────────────────────
export interface RendererEvents {
  /** Fires on every position change, however this surface produces one — a
   *  page turn, a scroll, a jump. `bookPercent` is null until locations are
   *  ready; `sectionPercent` is always available. */
  relocated: (pos: {
    locator: Locator;
    bookPercent: number | null;
    sectionPercent: number;
  }) => void;
  selected: (sel: {
    text: string; prefix: string; suffix: string; locator: Locator;
  }) => void;
  markClicked: (highlightId: string) => void;
  /** M32's chapter-end trigger, however this surface defines "the end" —
   *  the last page, or scrolled to the bottom. */
  sectionEnd: () => void;
  error: (err: Error) => void;
}

export interface RendererOptions {
  flow: "paginated" | "scrolled";
  spread: SpreadMode;
  fontScale: number;
  marginPx: number;
}

export interface ResourceRenderer {
  mount(container: HTMLElement, resource: Resource, opts: RendererOptions): Promise<void>;
  destroy(): void;

  goTo(loc: Locator): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  currentLocation(): Locator | null;

  /** Returns an unsubscribe function. ⚠️ Not an `onSelection(cb)` with no way
   *  off — `ReaderView` mounts and unmounts these across route changes. */
  on<K extends keyof RendererEvents>(event: K, cb: RendererEvents[K]): () => void;

  paintMark(highlightId: string, loc: Locator, kind: HighlightKind): void;
  removeMark(highlightId: string): void;
  /** The transient, non-highlight tint — audio's sentence follow. At most one
   *  at a time; null clears. Deliberately separate from paintMark, because
   *  `ReaderView` already keeps these two bookkeepings apart (`tintCfiRef` vs
   *  `cfiOwnersRef`) and merging them re-introduces a bug that was already fixed. */
  setTint(loc: Locator | null): void;
  /** Viewport rect of a painted mark, for positioning its annotation panel.
   *  Null when the mark is not currently on screen. */
  markRect(highlightId: string): DOMRect | null;

  applyTheme(vars: ReaderThemeVars): void;
  setFontScale(scale: number): void;
  setMargins(px: number): void;

  readonly capabilities: RendererCapabilities;
}
```

**Four things this shape exists to force:**

- **`on()` returns an unsubscribe.** `ReaderView` mounts and unmounts renderers across
  route changes; a callback with no way off is a listener leak into a destroyed iframe.
- **`markRect` is what makes annotation panels survive a non-paginated surface.**
  `ThreadPanel`'s `panelDx`/`panelDy` are a *drag offset from the mark's anchor*, not an
  absolute position, so the anchor has to be recomputable. On a paginated surface it moves
  only on a turn; on a scrolling one it moves continuously. ⚠️ Without this, panels detach
  from their highlights the first time you scroll — and it will look like a `ThreadPanel`
  bug rather than a seam bug.
- **`sectionEnd` is an event, not a page-number comparison.** M32's chapter-end prompt
  currently infers "end of chapter" from paginated state. Each surface defines its own end.
- **`ReaderThemeVars`, not `EpubThemeVars`.** `useEpubThemeVars.ts`'s exported type is
  renamed as part of M40 §A; a type with a format in its name cannot sit on a
  format-neutral seam.

**Deliberately not in the interface**, so nobody adds them speculatively: search (the find
bar acts through `resource_text` + `goTo`), the TOC (the chrome reads it from resource
metadata, not from the renderer), and anything 3D (the fold is chrome that a capability
switches off, not a renderer concern).

### 7.3 The anchor model, amended

`SPEC.md` and the header comment of `web/src/reader/anchorResolution.ts` both state that
**the CFI is the primary anchor**, with text search as fallback. That rule cannot hold
for a format with no CFI.

**Amendment: `Locator` — `(sectionIndex, offset, length)` — is the primary anchor.
The CFI demotes to an EPUB-only fast path.** Resolution order becomes:

1. `loc.cfi`, if present and it resolves (EPUB only — unchanged behaviour, unchanged speed)
2. text search on quote + prefix/suffix (`findAnchorInText`) — unchanged
3. `(sectionIndex, offset, length)` against the section text
4. unanchored, but never dropped — unchanged

⚠️ This is a **reordering, not a replacement**, and step 1 must stay first for EPUB.
Nothing about existing EPUB anchoring behaviour may change in M40; it is a refactor.
Settled decision 11's 2026-08-31 clarification already permits this: an offset that
*code computed* by locating model- or user-selected text is the decision being followed,
and a char offset into `resource_text` cannot rot because the resource is immutable
(decision 5).

⚠️ **`highlights.cfi` is `TEXT NOT NULL`** (migration 1, `migrations.ts:51`). A PDF
highlight has no CFI. SQLite cannot relax `NOT NULL` in place — this needs a table
rebuild migration (create, copy, drop, rename), which is the single riskiest migration in
this arc because `highlights` is the table everything references. Do it in its own
migration version, with a test that round-trips a populated database.

⚠️ **`reading_state.location` is a CFI too** (`migrations.ts:41`, `TEXT NOT NULL`), and
it is easy to miss because it is not on the `highlights` table. It needs **no migration** —
it is already TEXT — but it needs a **serialization convention**: write a `SerializedLocator`,
and accept a bare CFI on read, because every row written before M40 is one. A reader whose
position parser assumes a CFI will throw on the first PDF, or silently reopen a book at
chapter 1.

⚠️ `resource_locations` (the cached `book.locations.save()` blob, migration 19) is
epub.js-specific and stays that way. It is correct for reflowed PDFs — they *are* EPUBs —
and meaningless for the native pane, whose `bookPercent` comes from `resource_text`
character offsets instead. Do not try to generalise the blob.

### 7.4 Continuous scroll — the seam's second consumer

Requested 2026-09-03, in the same conversation that scoped this arc. ⚠️ **This reopens a
settled decision**: PRODUCT.md records "pagination vs. scroll: **pagination won** (shipped
in M2, feel confirmed)", and TASKS.md's future arcs already analysed it (decisions.md
2026-07-29, "A scrolling manuscript mode"). It is a deliberate re-opening, and the earlier
analysis stands: a scroll mode is **a second reading mode with its own affordances, not a
toggle on the existing one**, because every reader effect built since M10 assumes pages.

What changed since that entry is *where it lives*. In July, scroll meant another branch
inside `ReaderView` — which is exactly the fork M40 §A exists to prevent. With the seam it
is a **capability profile**, and it is the reason the seam earns its milestone.

**Ruling on the question decisions.md 2026-07-29 explicitly left open** ("epub.js offers
`flow: 'scrolled-doc'` per section; genuinely continuous cross-chapter scrolling is a
different manager… decide *which* before building, because they are different products"):

> **Per-section `flow: "scrolled-doc"` with `manager: "default"`. Not the continuous
> manager.**

The argument is the product's own shape, not the library's quality. This app is
chapter-shaped everywhere that matters: the digest's unit is a chapter (M17), the spoiler
mask filters at `spine_index <= bookmark` (decision 8a), audio manifests are per-section,
`resource_text` rows are per-section, and **M32 built a chapter-end prompt** — a designed
moment at exactly the boundary infinite scroll would dissolve. A surface that pre-renders
the next chapter into view also quietly undermines the mask's whole premise. Per-section
scroll matches the model; continuous scroll fights it in four places.

*(A secondary concern — that epub.js's continuous manager is its least-maintained path and
prone to scroll-position jitter as sections load — is **reasoned, not measured**. Do not
cite it as established. The product argument above is sufficient on its own.)*

**One `EpubRenderer`, two flows — not two classes.** `flow` is a `renderTo` option fixed at
construction, so switching modes destroys and recreates the rendition; but marks, CFI
handling, selection, and theming are all shared. Two classes duplicates ~95% of the code.

**The capability profile:**

| capability | paginated | scrolled |
|---|---|---|
| `advance` | `"page"` | `"scroll"` |
| `spread` | ✓ | ✗ — there is no gutter to spread across |
| `pageFold` | ✓ | ✗ |
| `pageNumbers` | ✓ | ✗ |
| `fontScale` | ✓ | ✓ |
| `margins` | ✓ | ✓ — M14's margin survives; only the *gutter* half of `gap` is meaningless |
| `textSelection` | ✓ | ✓ |

**Progress readout.** With `pageNumbers: false`, the strip shows two percentages:

- **Book %** — unchanged, from `book.locations`, the same source the progress indicator
  and the chapter ticks already share.
- **Chapter %** — `scrollTop / (scrollHeight - clientHeight)` of the section container.
  ⚠️ **Do not derive it from `location.start.displayed.page / .total`.** That pair is what
  `pageNumber.ts`'s `"chapter"` mode reads today, and it is a *paginated* measure; in
  `scrolled-doc` it does not mean what its name suggests. Measure the scroll directly.

`PageNumberMode` (`shared`) gains no new value — the mode is unchanged and simply has no
effect when `capabilities.pageNumbers` is false. The strip decides from the capability.

⚠️ **Traps specific to this surface**, each of which will present as a bug in an unrelated
component:

- **Annotation panels drift.** `ThreadPanel`'s `panelDx`/`panelDy` are offsets from the
  mark's anchor rect; on a scrolling surface that rect moves continuously. This is what
  §7.2's `markRect` + a `relocated` on scroll are for. Throttle to animation frames.
- **The chapter-end prompt needs a scroll definition.** M32 infers "chapter end" from
  paginated state. In scroll it is "scrolled to the bottom of the section" — emitted as
  `sectionEnd`, and it must fire **once** per arrival, not on every scroll event at the
  bottom.
- **Reading position gets finer than a page.** Save on a debounced scroll, not on every
  frame, or `PUT /position` runs hot for the whole session.
- **The turn zones and drag-to-peel (M11, M20) must be off, not merely invisible.** A
  pointer handler still bound over a scrolling surface eats the scroll gesture.

### 7.5 What the native pane must rebuild

Named here so the M41 estimate is honest. None of this is inherited from the EPUB pane:

| Concern | Native PDF approach |
|---|---|
| Selection | pdf.js text layer (absolutely-positioned transparent spans over the canvas) — real DOM Ranges, so `getSelectionContext` works unchanged |
| Highlight painting | client rects from the text-layer Range → absolutely-positioned divs. `marks-pane` is CFI-keyed and is **not** reused |
| Pagination | fixed pages; `capabilities.reflowable = false`, so spread/margins/font-scale/fold are all hidden rather than reimplemented |
| Find bar | pdf.js `findController`, or the same text search against `resource_text` with text-layer rect painting |
| Audio follow | the sentence-tint path re-expressed over text-layer rects |
| Page turn | plain page-to-page; the M20/M27 fold does **not** apply and must not be faked |

---

## 8. What is deliberately not in this arc

- **OCR.** §6.
- **Reconstructing math as text.** §3.4.
- **Markdown import.** Unrelated, still parked.
- **PDF annotation export / writing highlights back into the PDF file.** Would violate
  decision 5 outright.
- **Reflow of a scan.** There is nothing to reflow.
