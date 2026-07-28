import { lazy, Suspense } from "react";
import { AnimatePresence } from "motion/react";
import { NavLink, Route, Routes, useLocation, useNavigate, type Location } from "react-router-dom";
import { useTheme, type ThemeChoice } from "./useTheme.js";
import { AirlockOverlay } from "./AirlockOverlay.js";
import styles from "./App.module.css";

// Code-split per room: epub.js (the reader's biggest dependency) only loads
// when the user actually navigates to /read/:id, instead of bloating the
// single entry chunk every route paid for before this split.
const DeskPage = lazy(() =>
  import("../desk/DeskPage.js").then((m) => ({ default: m.DeskPage })),
);
const ReaderPage = lazy(() =>
  import("../reader/ReaderPage.js").then((m) => ({ default: m.ReaderPage })),
);
const ScanPage = lazy(() =>
  import("../scan/ScanPage.js").then((m) => ({ default: m.ScanPage })),
);
const DigestPage = lazy(() =>
  import("../digest/DigestPage.js").then((m) => ({ default: m.DigestPage })),
);
const SettingsModal = lazy(() =>
  import("../settings/SettingsModal.js").then((m) => ({ default: m.SettingsModal })),
);

interface NavigationState {
  /** Set when navigating to /settings from within another room (M11: settings
   * is a modal, not a route) — the room to keep mounted and visible behind
   * the overlay. Absent on a direct/deep link to /settings, which falls back
   * to rendering the Desk underneath, per TASKS.md. */
  background?: Location;
}

const THEME_OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "paper", label: "Paper" },
  { value: "system", label: "Auto" },
  { value: "ink", label: "Ink" },
];

export function App() {
  const { choice, setChoice } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  // "Background location" pattern (M11: settings is an overlay, not a
  // route): when settings is opened from within another room, that room's
  // location travels along as nav state so <Routes> below keeps rendering
  // it — the URL genuinely becomes /settings (a real, bookmarkable,
  // back-button-able entry) while the room underneath never unmounts.
  const background = (location.state as NavigationState | null)?.background;
  const settingsOpen = location.pathname === "/settings";

  function closeSettings() {
    if (background) navigate(-1);
    else navigate("/");
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <NavLink to="/" className={styles.brand}>
          Marginalia
        </NavLink>
        <nav className={styles.nav}>
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink
            }
          >
            Library
          </NavLink>
          <NavLink
            to="/settings"
            state={{ background: location } satisfies NavigationState}
            className={({ isActive }) =>
              isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink
            }
          >
            Settings
          </NavLink>
          <div className={styles.themeToggle} role="group" aria-label="Theme">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={
                  choice === option.value
                    ? `${styles.themeButton} ${styles.themeButtonActive}`
                    : styles.themeButton
                }
                onClick={() => setChoice(option.value)}
                aria-pressed={choice === option.value}
              >
                {option.label}
              </button>
            ))}
          </div>
        </nav>
      </header>
      <main className={styles.main}>
        <Suspense fallback={<div className={styles.routeFallback} />}>
          <Routes location={background ?? location}>
            <Route path="/" element={<DeskPage />} />
            <Route path="/read/:id" element={<ReaderPage />} />
            <Route path="/scan/:id" element={<ScanPage />} />
            <Route path="/digest/:id" element={<DigestPage />} />
            {/* Deep link / hard refresh straight at /settings has no
                background room to fall back on — the Desk stands in, per
                TASKS.md ("/settings ... renders the desk with the modal
                open"). */}
            <Route path="/settings" element={<DeskPage />} />
          </Routes>
        </Suspense>
        <AnimatePresence>
          {settingsOpen && (
            <Suspense fallback={null}>
              <SettingsModal key="settings-modal" onClose={closeSettings} />
            </Suspense>
          )}
        </AnimatePresence>
      </main>
      <AirlockOverlay />
    </div>
  );
}
