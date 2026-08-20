# Building with Marginalia

Marginalia is a reading environment: a Desk (where books live), a Book (the
reader), and instruments you put *on top* of what you're in — the Scan, the
Digest, Settings, Annotations. Build with that grain: rooms are quiet and
material; instruments are overlays, never new pages.

## 1. Wrap in a register — or your controls render invisible

Every control token (`--control-*`) is defined **only** under a register
class. A `Button` with no register ancestor has no background, no border and
no radius. This is the single most common way to get a blank screen.

```jsx
// The whole tree — or at least every control-bearing subtree.
<div className="register-paper">
  <Button variant="solid">Publish to vault</Button>
</div>
```

| Class | Use it for | Feel |
|---|---|---|
| `register-paper` | Desk, Book, Digest, Settings — **the default** | Warm, soft drop shadows, 10px radius, sans type, gentle lift on hover |
| `register-paper register-quiet` | The reader's own chrome | Flatter: no rest shadow, transparent borders, no lift — chrome that recedes |
| `register-glass` | The Scan only | CRT instrument: 3px radius, mono type, phosphor stroke, **no shadow** (a screen doesn't cast one) |

Registers set *shape, weight and motion only* — never colour. Colour always
comes from the `--color-*` tokens below, so a register stays correct in both
themes. There is no third register; don't invent one.

## 2. Themes are two, and they're token swaps

`paper` (light) and `ink` (dark). `:root[data-theme="paper"|"ink"]` overrides
`prefers-color-scheme`, which is the default. Never hardcode a colour — read
the token and both themes follow for free.

## 3. The token vocabulary

Style your own layout glue with these, in `var(--token)` form. This is the
whole palette; if a name isn't here, it doesn't exist.

**Surface & text** — `--color-bg`, `--color-bg-raised`, `--color-text`,
`--color-text-muted`, `--color-border`

**Accent & state** — `--color-accent`, `--color-accent-text`,
`--color-highlight`, `--color-highlight-active`, `--color-danger`

**Highlight kinds** — `--kind-rose`, `--kind-sage`, `--kind-honey`,
`--kind-slate`. These are the four highlight *kinds*, and the kind values in
the API are the colour names themselves: `rose` = revisit/general,
`sage` = definition, `honey` = quote, `slate` = question. Passing `"revisit"`
where a `kind` is expected is a runtime error, not a synonym.

**Type** — `--font-sans` (UI), `--font-serif` (book text). Both are system
stacks; the design ships no webfonts, deliberately.

**Motion & depth** — `--shadow-panel`, `--ease-standard`,
`--duration-standard`, `--nav-cluster-reserve` (the top-right space room
chrome must leave for `NavCluster`).

**Control tokens** (read them if you're building a *new* control that must
match the kit): `--control-bg`, `--control-bg-hover`, `--control-bg-pressed`,
`--control-text`, `--control-text-muted`, `--control-border-width`,
`--control-border-color`, `--control-radius`, `--control-radius-icon`,
`--control-font`, `--control-font-weight`, `--control-shadow-rest`,
`--control-shadow-hover`, `--control-shadow-pressed`,
`--control-hover-transform`, `--control-pressed-transform`,
`--control-focus-ring`.

There are **no utility classes**. Style with tokens in your own CSS or inline
styles; compose behaviour from the components below.

## 4. Reach for the kit before writing markup

`Button` (`solid` / `outline` / `ghost` / `danger`; `sm` / `md`; `pressed` for
persistent toggle state) · `IconButton` (icon-only — `label` is **required**,
it's the only accessible name) · `Slider` (its resting form is a *readout*,
not a track) · `SliderDial` · `ColorField` · `FlyPanel` (the overlay shell
every instrument sits in).

Icons ship in the bundle and take no props: `BrainIcon`, `MagnifierIcon`,
`PlayIcon`, `LibraryIcon`, `GearIcon`, `TrayIcon`, `PublishIcon`, `SunIcon`,
`MoonIcon`, `CircleHalfIcon`, `ChevronIcon`, `AudioTransportIcon`.

`buttonClassName({ variant, size, pressed })` exists for the rare non-`<button>`
that must *look* like one (a navigating `<a>`). Anything that can be a real
button should be `Button`/`IconButton`.

Larger parts, by room: **app** `NavCluster`, `Toast`, `ServerStatusBanner` ·
**library** `LibraryGrid`, `BookCover` · **reader** `AskPill`, `ChapterNav`,
`FindBar`, `MarginRail`, `ProgressPopover`, `PageNumberDisplay`, `DwellRing` ·
**scan** `HeatStrip`, `ChapterDial`, `CrtBezel` · **settings**
`SettingsModal`, `SettingsPage`, `ProviderPicker`, `UsageDivider` ·
**jobs** `TasksTray`, `JobToastStack` · **highlights** `ImportanceStars`,
`TagEditor` · **shortcuts** `KeyCapAnchor` · **threads**
`ContextLadderToggle`.

## 5. Where the truth lives

Read these before styling: `_ds/<folder>/styles.css` and its `@import`
closure (the tokens and every component's compiled CSS), and the per-component
`<Name>.prompt.md` + `<Name>.d.ts` for the real API. `guidelines/DESIGN.md` is
the aesthetic blueprint — rooms, instruments, and the control system — and is
worth reading before designing a new surface.

## 6. A worked example

```jsx
<div className="register-paper" style={{
  display: "grid", gap: 16, padding: 20,
  background: "var(--color-bg)", color: "var(--color-text)",
  font: "400 15px/1.6 var(--font-sans)",
}}>
  <h2 style={{ margin: 0, font: "600 18px var(--font-serif)" }}>
    Publish to vault
  </h2>
  <p style={{ margin: 0, color: "var(--color-text-muted)" }}>
    Distilled notes for the 14 highlights in this chapter.
  </p>
  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
    <Button variant="ghost">Cancel</Button>
    <Button variant="solid" icon={<PublishIcon />}>Publish 14 notes</Button>
  </div>
</div>
```

The library component carries the control; tokens carry your own layout. Never
hand-roll a button.
