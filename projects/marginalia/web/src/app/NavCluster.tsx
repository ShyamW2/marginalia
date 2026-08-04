import { useRef, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { buttonClassName } from "../controls/Button.js";
import { IconButton } from "../controls/IconButton.js";
import { captureOverlayOrigin, setPendingOverlayOrigin } from "../controls/overlayOrigin.js";
import { CircleHalfIcon, GearIcon, LibraryIcon, MoonIcon, SunIcon } from "../controls/icons.js";
import { KeyCapAnchor } from "../shortcuts/KeyCap.js";
import { SHORTCUT_KEYS } from "../shortcuts/keys.js";
import { useShortcuts } from "../shortcuts/useShortcuts.js";
import type { TabId } from "../settings/SettingsPage.js";
import { TasksTray } from "../jobs/TasksTray.js";
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
  // Only the App-shell's one persistent cluster owns the chrome row's
  // leading slot — the reader's un-floated fullscreen copy never has a room
  // behind it to contribute actions, so it doesn't register one.
  const registerChromeSlot = useRegisterChromeSlot();

  function openSettings(originEl: Element) {
    setPendingOverlayOrigin(captureOverlayOrigin(originEl));
    navigate("/settings", { state: { background: location, settingsTab } });
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
      <div className={styles.themeGroup} role="group" aria-label="Theme">
        {THEME_OPTIONS.map((option) => (
          <IconButton
            key={option.value}
            icon={option.icon}
            label={option.label}
            pressed={choice === option.value}
            onClick={() => setChoice(option.value)}
          />
        ))}
      </div>
    </div>
  );
}
