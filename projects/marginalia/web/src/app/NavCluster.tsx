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
  /** The App-shell placement: fixed, top-right. The reader's
   * fullscreen-embedded copy passes false and relies on its own parent's
   * proximity-reveal positioning instead — real Fullscreen API hides
   * everything outside the fullscreened element, so this component mounts a
   * second time, un-floated, inside the reader's own chrome for that case
   * (see ReaderView.tsx). */
  floating?: boolean;
  className?: string;
}

/**
 * The top-right chrome cluster (M19.7, DESIGN.md "The control system"):
 * library, settings and theme, present in every room, replacing the old text
 * header. Also owns the registry's "s" (settings) binding — the click
 * handler and the keyboard path do the same navigation, from the same
 * component, so they can't drift apart.
 */
export function NavCluster({ settingsTab, floating = true, className }: NavClusterProps) {
  const { choice, setChoice } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const reducedMotion = useReducedMotion();
  const activeThemeIndex = THEME_OPTIONS.findIndex((option) => option.value === choice);
  // Only the App-shell's one persistent cluster owns the chrome row's
  // leading slot — the reader's un-floated fullscreen copy never has a room
  // behind it to contribute actions, so it doesn't register one.
  const registerChromeSlot = useRegisterChromeSlot();

  function openSettings(originEl: Element) {
    // M22.5 (decisions.md 2026-08-04 "pressing s twice takes the background
    // to the library page"): both the click and the keyboard path funnel
    // through here, so "s is a toggle" only needs one branch, in one place.
    // Navigating to /settings while already there used to push a second
    // /settings-over-/settings entry — one Escape/`s` closed it back to the
    // first /settings, not to the room, which read as "it takes two goes".
    if (location.pathname === "/settings") {
      const background = (location.state as { background?: Location } | null)?.background;
      if (background) navigate(-1);
      else navigate("/");
      return;
    }
    setPendingOverlayOrigin(captureOverlayOrigin(originEl));
    navigate("/settings", { state: { background: location, settingsTab } });
  }

  // M22.5 "d for the Desk, l for the Library": lives here rather than on
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
  ]);

  return (
    <div className={[styles.cluster, floating ? styles.floating : "", className].filter(Boolean).join(" ")}>
      {floating && <div className={styles.leadingSlot} ref={registerChromeSlot} />}
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
          `aria-hidden` decoration. */}
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
    </div>
  );
}
