# design-sync notes — Marginalia

## What is being synced

`@marginalia/web` is an **application**, not a published component library: no
Storybook, no library `dist/`, no `main`/`module` entry. The design system is
the `controls/` primitives kit + `theme.css` tokens + the reusable UI around
them. Three sync-only files make it convertible (all committed, all outside
`src/` so the app build is untouched):

- `projects/marginalia/web/_ds-entry.ts` — hand-written barrel; the converter's
  `--entry`. **Do not** let the converter synthesize an entry from `src/`: it
  does `export * from` every `.tsx`, which includes `main.tsx` — that calls
  `ReactDOM.createRoot()` at module scope and throws "root element not found"
  the moment the bundle loads, taking every preview with it.
- `projects/marginalia/web/_ds-preview-provider.tsx` — `cfg.provider` wrapper.
- `projects/marginalia/web/tsconfig.ds-types.json` + `tsconfig.ds-sync.json`.

## Gotchas found while building this

- **Register classes are load-bearing.** Every `--control-*` token is defined
  only under `.register-paper` / `.register-glass` (`controls/registers.css`).
  A control with no register ancestor has no background, border or radius and
  renders **invisible** — this was the cause of the first run's blank Button /
  IconButton / FlyPanel cards. The preview provider puts `.register-paper` on
  `<body>` (see the scaffolding section for why body and not a wrapper); Scan
  components nest their own `.register-glass`.
- **`scheduler` must not hit the converter's react shim.** `@react-three/fiber`
  imports `scheduler` directly (`dist/events-*.esm.js`), and the shim replaces
  every `scheduler` import with a stub that throws `[SCHEDULER_MISSING]` — a
  guard meant for design systems that leaked react-dom into their dist. Here
  it is legitimate, and the throw emptied `window.Marginalia` entirely.
  Fix: `tsconfig.ds-sync.json` maps `scheduler` to the real package; the
  converter's tsconfig-paths plugin runs *before* the react shim, so the stub
  never fires. **This is a lockfile-derived path** (`.pnpm/scheduler@0.21.0`).
- **Prop extraction needs a real `.d.ts` tree.** With none, every emitted
  `<Name>.d.ts` degrades to `[key: string]: unknown` and the design agent gets
  no API contract. `tsconfig.ds-types.json` emits declarations to
  `web/types/`, and `web/index.d.ts` is the entry `lib/dts.mjs` looks for
  (`<pkgDir>/index.d.ts` when package.json declares no `types` field). Both
  are gitignored; regenerate before every build:
  `cd projects/marginalia/web && ./node_modules/.bin/tsc -p tsconfig.ds-types.json`
- **The capture harness freezes the clock, and `motion` never finishes its
  entrance.** `package-capture.mjs` calls `page.clock.setFixedTime(...)` for
  deterministic screenshots. `motion` animates off rAF/`performance.now()`, so
  with time frozen a component whose root is a `motion.div` with
  `initial={{ opacity: 0 }}` keeps that inline `opacity: 0` and screenshots
  **completely blank** — while rendering perfectly in a real browser and in
  `package-validate.mjs` (which does *not* freeze the clock). Cost half an
  hour on SliderDial before it was traced. Fix is global, in
  `_ds-preview-provider.tsx`: a `<style>` injected into `<head>` (not into the
  card tree — see the scaffolding section) forcing `[style*="opacity: 0;"]` to
  `opacity: 1 !important; transform: none !important`. The trailing semicolon
  in the selector matters (`opacity: 0` alone also matches `opacity: 0.5`).
  Class-based hidden states are untouched, so KeyCapAnchor's resting keycap
  still renders correctly hidden.
- **A component that centres on its ancestor needs a wide enough ancestor.**
  SliderDial is `left: 50%; translateX(-50%)`; anchored to a narrow inline
  element it renders at a negative x and is clipped off-screen — visible in
  the DOM, invisible in the shot. Its preview anchors on a 320px block.
- **`cfg.tokensGlob` does not work here.** `copyTokens` returns early without
  `cfg.tokensPkg` and resolves globs inside `node_modules/<tokensPkg>`; this
  workspace has no self-link. `theme.css` and `registers.css` are instead
  imported at the top of `_ds-entry.ts`, so they lead `_ds_bundle.css`, which
  `styles.css` @imports — the closure a rendered design actually receives.
  Consequence: `tokens/` ships empty by design.
- **Icons are bundled but not carded.** The 12 icon exports are importable from
  `window.Marginalia` and documented in the conventions header, but excluded
  from the component list (`componentSrcMap: null`) to hold the agreed scope.
  Authoring cards for them is a cheap future re-sync.
- **`[FONT_MISSING]` is expected and correct.** The repo ships no font files
  and has no `@font-face` anywhere; "Iowan Old Style", "Palatino", "Cascadia
  Code" are members of deliberate system-font stacks with real terminal
  fallbacks (`Georgia, serif` / `monospace`). There is no webfont to source.

## Build commands

```sh
cd projects/marginalia/web && ./node_modules/.bin/tsc -p tsconfig.ds-types.json   # types first
cd - && node .ds-sync/package-build.mjs --config .design-sync/config.json \
  --node-modules projects/marginalia/web/node_modules \
  --entry ./projects/marginalia/web/_ds-entry.ts --out ./ds-bundle
node .ds-sync/package-validate.mjs ./ds-bundle
```

playwright 1.62.1 matches the already-cached chromium build 1234 — no browser
download needed on this machine.

## Preview scaffolding (`_ds-preview-provider.tsx`)

`cfg.provider` supplies four things, all preview-only:

1. **`.register-paper` on `<body>`** — deliberately on body, *not* a wrapper
   element. A wrapper makes the card root always report one child, which
   defeats the converter's floor-card detection ("no children and no text"),
   so a component that legitimately renders nothing shows an empty card
   instead of the honest floor. Guard `document.body` — it is null when the
   converter evaluates the bundle for its export-evidence check, and an
   unguarded access there throws at module scope and leaves
   `window.Marginalia` completely unassigned (`[BUNDLE_EXPORT] 32/32`).
2. **MemoryRouter** — NavCluster, LibraryGrid, SettingsModal/Page use links.
3. **JobsProvider** and **ChromeSlotProvider** — `useJobs()` and
   `useRegisterChromeSlot()` both throw outside their providers.
4. **A `fetch` stub** for the GETs the synced components call
   (`/api/jobs`, `/api/settings`, `/api/audio/voices`, `/api/usage/summary`,
   `/api/provider-profiles`, `/api/provider-roles`,
   `/api/resources/:id/context-ladder`). Everything else falls through to the
   real fetch. Payloads are shaped by the zod schemas in `@marginalia/shared`
   — **derive them from the schema, not from a first read of it**: several
   hours went into shape mismatches (`UsageBreakdownRow` uses
   `costUsd`/`costBasis`, not `billedCostUsd`; `HeatStrip` takes
   `ScanHighlight`, not `Highlight`).

## Gotchas that cost real time

- **`HighlightKind` is the colour name**, not the semantic one: `rose`
  (revisit), `sage` (definition), `honey` (quote), `slate` (question).
  Passing `"revisit"` throws inside `phosphorHue`, which indexes its palette
  by kind, and blanks the whole card.
- **Scan percents are fractions (0–1)**, not 0–100 (`ScanChapterSchema`).
- **`ProviderPicker` needs `role` *and* `variant`** — rendering it bare
  throws on `ROLE_COPY[undefined]`.

## Components that cannot render statically

- **`ReaderPage`** — needs a route param, a live resource fetch and epub.js
  rendering a real EPUB over HTTP. Ships the floor card by design.
- **`ServerStatusBanner`** — renders *only* after two failed `/api/health`
  polls 3 s apart (deliberate anti-flap). A capture screenshots long before
  that, so its only visible state is unreachable. Ships the floor card.
- **`TasksTray`** — the open tray needs a click; the card shows its resting
  collapsed trigger (with a live job-count badge), which is correct.

## Known render warns (expected — not new)

- `[FONT_MISSING]` for "Iowan Old Style", "Palatino Linotype", "Palatino",
  "Cascadia Code" — see above; system-font stacks, nothing to ship.
- `ChapterNav`'s `Compact` card is deliberately tiny: `.labelCompact` is
  `max-width: 1.75rem`.

## Re-sync risks — what can silently go stale

- **The `scheduler` path in `tsconfig.ds-sync.json` is lockfile-derived**
  (`.pnpm/scheduler@0.21.0/...`). A scheduler bump, a pnpm layout change, or
  a different package manager breaks it — loudly, as `[SCHEDULER_MISSING]`
  with every preview blank. Re-point the path.
- **The fetch stubs are inlined copies of API shapes.** If a schema in
  `@marginalia/shared` changes, the stubs rot silently: the component renders
  its error/empty branch and the card just looks wrong rather than failing.
  Re-check them against `schemas.ts` whenever the API moves.
- **`types/` and `index.d.ts` are generated and gitignored.** A fresh clone
  must run `tsc -p tsconfig.ds-types.json` *before* the converter, or every
  `<Name>.d.ts` silently degrades to `[key: string]: unknown`.
- **The working tree had a pre-existing type error** when this ran
  (`ReaderView.tsx` passes FindBar without `resultsOpen`/`onToggleResults`).
  Declaration emit continues through it, so it does not block the sync — but
  it means `types/` was emitted from a tree that does not typecheck.
- **The 12 icon exports are bundled but not carded** (`componentSrcMap:
  null`). Authoring cards for them is a cheap incremental re-sync.
- Node 24 / pnpm 10 on this machine; playwright 1.62.1 matched the cached
  chromium build 1234, so no browser download was needed.
