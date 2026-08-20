/*
 * Design-system entry for /design-sync (docs: .design-sync/NOTES.md).
 *
 * @marginalia/web is an application, not a published component library, so it
 * has no `main`/`module` entry the converter can bundle. This file is that
 * entry: a barrel of the components that make up the design system, bundled
 * by esbuild into `_ds_bundle.js` (window.Marginalia).
 *
 * Why a hand-written barrel rather than the converter's synthesized one: the
 * synth entry does `export * from` every .tsx under src/, which would include
 * `main.tsx` — it calls ReactDOM.createRoot() at module scope and throws
 * "root element not found" the moment the bundle loads, breaking every
 * preview. It would also drag the whole three.js/epub.js stack in.
 *
 * Deliberately outside `src/`, so `tsconfig.json` ("include": ["src"]) does
 * not typecheck it and the app build is untouched.
 *
 * Global CSS is imported here, FIRST, on purpose. theme.css defines every
 * `--color-*`/`--kind-*`/motion token and registers.css the `--control-*`
 * register vocabulary; the component CSS modules below consume them and
 * render unstyled without them. Importing them from the entry puts them at
 * the top of `_ds_bundle.css`, which `styles.css` @imports — and a rendered
 * design receives only that @import closure. (cfg.tokensGlob was not usable:
 * copyTokens resolves globs inside `node_modules/<cfg.tokensPkg>`, and this
 * workspace has no self-link, so it can never reach src/.)
 */
import "./src/theme.css";
import "./src/controls/registers.css";

// Preview-only wrapper (cfg.provider) — scaffolding, not a DS component.
// Excluded from the card set via componentSrcMap: {"DesignSystemPreview": null}.
export { DesignSystemPreview } from "./_ds-preview-provider.js";

// ── controls: the primitives kit (one control system, two registers) ──────
export { Button, buttonClassName, type ButtonProps, type ButtonSize, type ButtonVariant } from "./src/controls/Button.js";
export { IconButton, type IconButtonProps } from "./src/controls/IconButton.js";
export { Slider, type SliderProps } from "./src/controls/Slider.js";
export { SliderDial } from "./src/controls/SliderDial.js";
export { ColorField } from "./src/controls/ColorField.js";
export { FlyPanel, type FlyPanelProps } from "./src/controls/FlyPanel.js";
export {
  captureOverlayOrigin,
  setPendingOverlayOrigin,
  readPendingOverlayOrigin,
  type OverlayOrigin,
} from "./src/controls/overlayOrigin.js";

// ── icons ────────────────────────────────────────────────────────────────
export {
  BrainIcon,
  MagnifierIcon,
  PlayIcon,
  LibraryIcon,
  GearIcon,
  TrayIcon,
  PublishIcon,
  SunIcon,
  MoonIcon,
  CircleHalfIcon,
} from "./src/controls/icons.js";
export { ChevronIcon } from "./src/reader/ChevronIcon.js";
export { AudioTransportIcon } from "./src/reader/AudioTransportIcon.js";

// ── app chrome ───────────────────────────────────────────────────────────
export { Toast } from "./src/app/Toast.js";
export { NavCluster } from "./src/app/NavCluster.js";
export { ServerStatusBanner } from "./src/app/ServerStatusBanner.js";

// ── shortcuts ────────────────────────────────────────────────────────────
export { KeyCapAnchor } from "./src/shortcuts/KeyCap.js";

// ── highlights ───────────────────────────────────────────────────────────
export { ImportanceStars } from "./src/highlights/ImportanceStars.js";
export { TagEditor } from "./src/highlights/TagEditor.js";

// ── library ──────────────────────────────────────────────────────────────
export { BookCover } from "./src/library/BookCover.js";
export { LibraryGrid } from "./src/library/LibraryGrid.js";

// ── jobs ─────────────────────────────────────────────────────────────────
// useJobs is exported so a preview can drive the real "a job just started"
// path (registerStarted) rather than faking the toast markup. Hooks are not
// picked up as components by the converter, so this adds no card.
export { useJobs, type StartedJobInfo } from "./src/jobs/JobsContext.js";
export { JobToastStack } from "./src/jobs/JobToastStack.js";
export { TasksTray } from "./src/jobs/TasksTray.js";

// ── settings ─────────────────────────────────────────────────────────────
export { ProviderPicker } from "./src/settings/ProviderPicker.js";
export { UsageDivider } from "./src/settings/UsageDivider.js";
export { SettingsModal } from "./src/settings/SettingsModal.js";
export { SettingsPage } from "./src/settings/SettingsPage.js";

// ── reader ───────────────────────────────────────────────────────────────
export { AskPill } from "./src/reader/AskPill.js";
export { ChapterNav } from "./src/reader/ChapterNav.js";
export { FindBar } from "./src/reader/FindBar.js";
export { PageNumberDisplay } from "./src/reader/PageNumberDisplay.js";
export { DwellRing } from "./src/reader/DwellRing.js";
export { MarginRail } from "./src/reader/MarginRail.js";
export { ProgressPopover } from "./src/reader/ProgressPopover.js";
export { ReaderPage } from "./src/reader/ReaderPage.js";

// ── scan ─────────────────────────────────────────────────────────────────
export { HeatStrip } from "./src/scan/HeatStrip.js";
export { ChapterDial } from "./src/scan/ChapterDial.js";
export { CrtBezel } from "./src/scan/CrtBezel.js";

// ── threads ──────────────────────────────────────────────────────────────
export { ContextLadderToggle } from "./src/threads/ContextLadderToggle.js";
