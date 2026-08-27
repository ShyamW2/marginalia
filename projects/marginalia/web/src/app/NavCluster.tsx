import { useRef, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Link, useLocation, useNavigate, type Location } from "react-router-dom";
import { buttonClassName } from "../controls/Button.js";
import { IconButton } from "../controls/IconButton.js";
import { captureOverlayOrigin, setPendingOverlayOrigin } from "../controls/overlayOrigin.js";
import { CircleHalfIcon, GearIcon, LibraryIcon, MoonIcon, SunIcon } from "../controls/icons.js";
import { KeyCapAnchor } from "../shortcuts/KeyCap.js";
import { SHORTCUT_KEYS } from "../shortcuts/keys.js";
import { useShortcuts } from "../shortcuts/useShortcuts.js";
import type { TabId } from "../settings/SettingsPage.js";
import { TasksTray } from "../jobs/TasksTray.js";
import { emitDeskViewMode, type DeskViewMode } from "../desk/deskViewBus.js";
import { useTheme, type ThemeChoice } from "./useTheme.js";
import { useRegisterChromeSlot } from "./chromeSlot.js";
import styles from "./NavCluster.module.css";

const THEME_OPTIONS: { value: ThemeChoice; label: string; icon: ReactNode }[] = [
  { value: "paper", label: "Paper theme", icon: <SunIcon /> },
  { value: "system", label: "Match system theme", icon: <CircleHalfIcon /> },
  { value: "ink", label: "Ink theme", icon: <MoonIcon /> },
];

interface NavClusterProps {
  /** Which settings divider the settings icon opens to (M19.7 "settings
   * opens where you already are") — each room passes its own. */
  settingsTab: TabId;
  /** The App-shell placement: fixed, top-right. The reader's embedded copy
   * (M24.7 A, both fullscreen and now the normal one-line strip) passes
   * false and relies on its own parent's positioning instead — the reader
   * can be docked narrow beside another pane, and a viewport-fixed pill
   * can't track a pane's edge (READER_REDESIGN.md's "the reader can be
   * docked beside other panes"). See ReaderView.tsx. */
  floating?: boolean;
  /** Whether this instance owns the shared `chromeSlot` seam (`DeskPage`'s
   * Import button, the reader's Search/Scan/Publish). Defaults to
   * `floating` — every existing call site keeps its exact current
   * behavior — but the reader's embedded instance opts in explicitly,
   * since only one `NavCluster` should register at a time and the
   * App-shell's floating one is suppressed while the reader route is
   * active (App.tsx). */
  registersSlot?: boolean;
  /** Whether `/settings` is genuinely open right now, from App.tsx's own
   * (real, un-remapped) location — required for any instance mounted under
   * a route's `<Routes location>` override (the reader's embedded copy).
   * `<Routes location>` wraps its matched subtree in a fresh
   * `LocationContext`, so a `useLocation()` read from in there is pinned to
   * that route's own path forever and can never see an overlay stacked
   * above it — exactly the trap App.tsx's own comment on `ReaderPage`
   * documents for `scanOpen`/`digestOpen`, just never extended to
   * Settings. Without this prop, this component's own `location.pathname`
   * check silently always reads "not open", so every `s` press (or click)
   * takes the "open" branch and stacks another `/settings` entry instead of
   * closing the one already showing (found live 2026-08-23: "s" n times
   * needed n Escapes to undo). Omitted (not just falsy) only by the
   * App-shell's own floating instance, which sits outside any `<Routes
   * location>` override and reads the real location on its own. */
  settingsOpen?: boolean;
  /** Paired with `settingsOpen` — closes it via App.tsx's own `closeSettings`
   * (which does know the real `background`), rather than this component
   * trying to read `location.state.background` off a location that isn't
   * really `/settings`. */
  onCloseSettings?: () => void;
  className?: string;
}

/**
 * The top-right chrome cluster (M19.7, DESIGN.md "The control system"):
 * library, settings and theme, present in every room, replacing the old text
 * header. Also owns the registry's "s" (settings) binding — the click
 * handler and the keyboard path do the same navigation, from the same
 * component, so they can't drift apart.
 */
export function NavCluster({
  settingsTab,
  floating = true,
  registersSlot = floating,
  settingsOpen,
  onCloseSettings,
  className,
}: NavClusterProps) {
  const { choice, setChoice } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const reducedMotion = useReducedMotion();
  const activeThemeIndex = THEME_OPTIONS.findIndex((option) => option.value === choice);
  const currentThemeOption = THEME_OPTIONS[activeThemeIndex] ?? THEME_OPTIONS[0];
  const nextThemeOption = THEME_OPTIONS[(activeThemeIndex + 1 + THEME_OPTIONS.length) % THEME_OPTIONS.length];
  const registerChromeSlot = useRegisterChromeSlot();

  function openSettings(originEl: Element) {
    // M22.5 (decisions.md 2026-08-04 "pressing s twice takes the background
    // to the library page"): both the click and the keyboard path funnel
    // through here, so "s is a toggle" only needs one branch, in one place.
    // Navigating to /settings while already there used to push a second
    // /settings-over-/settings entry — one Escape/`s` closed it back to the
    // first /settings, not to the room, which read as "it takes two goes".
    //
    // `settingsOpen`/`onCloseSettings` (when passed) are App.tsx's own real
    // values, not this component's `location.pathname` — this instance may
    // be mounted under a route's `<Routes location>` override (the reader's
    // embedded copy), where `location` is pinned to that route's own path
    // and can never see `/settings` open above it (see the props' own
    // comment). Falls back to the local check for the App-shell's floating
    // instance, which isn't under any such override.
    const isOpen = settingsOpen ?? location.pathname === "/settings";
    if (isOpen) {
      if (onCloseSettings) {
        onCloseSettings();
        return;
      }
      const background = (location.state as { background?: Location } | null)?.background;
      if (background) navigate(-1);
      else navigate("/");
      return;
    }
    setPendingOverlayOrigin(captureOverlayOrigin(originEl));
    navigate("/settings", { state: { background: location, settingsTab } });
  }

  // M22.5 "d for the Desk, l for the Library", and M23 §D's "b for the
  // bookshelf": lives here rather than on
  // DeskPage because the keys must work from anywhere, including from on
  // top of an open Scan/Digest — those overlays claim only Escape
  // (useDialogA11y), so a bare-letter key they don't recognise falls
  // through the registry's scope stack to this always-mounted cluster.
  // Setting the mode is a bus emit (deskViewBus), not a `navigate` payload,
  // so it also reaches a DeskPage that's already mounted as the hidden
  // background behind that overlay. `navigate("/")` is what actually closes
  // the overlay: it replaces the location outright rather than popping one
  // entry, so it works the same whether the overlay is one level up
  // (Settings) or stacked deeper (Settings-over-Scan).
  function goToDesk(mode: DeskViewMode) {
    emitDeskViewMode(mode);
    if (location.pathname !== "/") navigate("/");
  }

  useShortcuts([
    {
      key: SHORTCUT_KEYS.settings,
      handler: () => {
        // Focus the button itself first (a keyboard-triggered open has no
        // real click target) — SettingsModal restores focus to whatever was
        // active when it mounted, so without this, "s" from anywhere would
        // return focus to nothing on close instead of back to this icon.
        settingsButtonRef.current?.focus();
        if (settingsButtonRef.current) openSettings(settingsButtonRef.current);
      },
    },
    { key: SHORTCUT_KEYS.desk, handler: () => goToDesk("desk") },
    { key: SHORTCUT_KEYS.list, handler: () => goToDesk("list") },
    { key: SHORTCUT_KEYS.shelf, handler: () => goToDesk("shelf") },
  ]);

  return (
    <div className={[styles.cluster, floating ? styles.floating : "", className].filter(Boolean).join(" ")}>
      {registersSlot && <div className={styles.leadingSlot} ref={registerChromeSlot} />}
      <Link
        to="/"
        className={[buttonClassName({ variant: "ghost", size: "md", iconOnly: true }), styles.libraryLink].join(
          " ",
        )}
        aria-label="Library"
        title="Library"
      >
        <LibraryIcon />
      </Link>
      <TasksTray />
      <KeyCapAnchor shortcutKey={SHORTCUT_KEYS.settings}>
        <IconButton
          ref={settingsButtonRef}
          icon={<GearIcon />}
          label="Settings"
          onClick={(event) => openSettings(event.currentTarget)}
        />
      </KeyCapAnchor>
      {/* M22.5 (decisions.md 2026-08-04 "the three theme buttons become a
          segmented control"): one recessed pill with a sliding active thumb,
          the operator's own first instinct over a single hover-revealing
          button (a third disclosure mechanic alongside the chrome row's new
          proximity-revealed labels was one too many). Still `role="group"`
          over three real, individually-focusable buttons — the thumb is
          `aria-hidden` decoration.
          M24.7 §C: in the reader's stacked (narrow) layout, the nav pebble
          shares row 1 with the book's identity and has to give up room —
          this trio collapses to the single `.themeCycle` button below via
          the `readerStripStacked` class useReaderStripLayout toggles on
          `.topRow` (NavCluster.module.css). Both stay mounted; only
          `display` toggles, so nothing here needs to know which form is
          showing. */}
      <div className={styles.themeGroup} role="group" aria-label="Theme">
        <div className={styles.themePill}>
          {activeThemeIndex >= 0 && (
            <motion.div
              className={styles.themeThumb}
              aria-hidden="true"
              animate={{ x: `${activeThemeIndex * 100}%` }}
              transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 32 }}
            />
          )}
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={styles.themeButton}
              aria-label={option.label}
              title={option.label}
              aria-pressed={choice === option.value}
              onClick={() => setChoice(option.value)}
            >
              {option.icon}
            </button>
          ))}
        </div>
      </div>
      <IconButton
        className={styles.themeCycle}
        icon={currentThemeOption.icon}
        label={`${currentThemeOption.label} — press for ${nextThemeOption.label}`}
        onClick={() => setChoice(nextThemeOption.value)}
      />
    </div>
  );
}
