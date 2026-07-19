import { lazy, Suspense } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { useTheme, type ThemeChoice } from "./useTheme.js";
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
const SettingsPage = lazy(() =>
  import("../settings/SettingsPage.js").then((m) => ({ default: m.SettingsPage })),
);

const THEME_OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "paper", label: "Paper" },
  { value: "system", label: "Auto" },
  { value: "ink", label: "Ink" },
];

export function App() {
  const { choice, setChoice } = useTheme();

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
          <Routes>
            <Route path="/" element={<DeskPage />} />
            <Route path="/read/:id" element={<ReaderPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
