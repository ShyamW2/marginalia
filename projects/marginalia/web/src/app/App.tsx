import { lazy, Suspense } from "react";
import { AnimatePresence } from "motion/react";
import { Route, Routes, matchPath, useLocation, useNavigate, type Location } from "react-router-dom";
import { NavCluster } from "./NavCluster.js";
import type { TabId } from "../settings/SettingsPage.js";
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
const ScanOverlay = lazy(() =>
  import("../scan/ScanOverlay.js").then((m) => ({ default: m.ScanOverlay })),
);
const DigestPage = lazy(() =>
  import("../digest/DigestPage.js").then((m) => ({ default: m.DigestPage })),
);
const SettingsModal = lazy(() =>
  import("../settings/SettingsModal.js").then((m) => ({ default: m.SettingsModal })),
);

interface NavigationState {
  /** Set when navigating to an overlay path (/settings, /scan/:id) from
   * within another room or instrument (M11: settings is a modal, not a
   * route; M20.5 extends the same pattern to the Scan) — the location to
   * keep mounted and visible behind the overlay. Absent on a direct/deep
   * link, which falls back to rendering the Desk underneath, per TASKS.md. */
  background?: Location;
}

function isOverlayPath(pathname: string): boolean {
  return pathname === "/settings" || pathname.startsWith("/scan/");
}

/** The chrome cluster's gear icon stays mounted above every overlay, so
 * Settings can open from inside the Scan (Settings-over-Scan-over-room).
 * Walks past however many overlay locations are chained through
 * `background` to find the real room underneath, so <Routes> always
 * renders that room rather than losing it the moment a second overlay
 * opens on top of the first. */
function roomLocation(location: Location): Location {
  let current = location;
  while (isOverlayPath(current.pathname)) {
    const background = (current.state as NavigationState | null)?.background;
    if (!background) return current;
    current = background;
  }
  return current;
}

/** M19.7 "settings opens where you already are": which divider the floating
 * cluster's settings icon should land on, derived from the room currently
 * showing. Only the rooms named in TASKS.md's acceptance get a dedicated
 * divider (scan → Scan); everything else — the Desk, the reader, the digest,
 * a direct /settings deep link — falls back to Reading, matching "a direct
 * /settings link still opens on Reading over the Desk". */
function settingsTabForRoom(pathname: string): TabId {
  if (pathname.startsWith("/scan/")) return "scan";
  return "reading";
}

export function App() {
  const location = useLocation();
  const navigate = useNavigate();

  // "Background location" pattern (M11: settings is an overlay, not a
  // route): when settings is opened from within another room, that room's
  // location travels along as nav state so <Routes> below keeps rendering
  // it — the URL genuinely becomes /settings (a real, bookmarkable,
  // back-button-able entry) while the room underneath never unmounts. M20.5
  // reuses it verbatim for the Scan (decisions.md 2026-07-30 "the exact
  // pattern Settings already uses").
  const background = (location.state as NavigationState | null)?.background;
  const settingsOpen = location.pathname === "/settings";
  // The Scan overlay is open either directly, or one level further back
  // behind an open Settings — both render the same ScanOverlay underneath.
  const scanPathname = location.pathname.startsWith("/scan/")
    ? location.pathname
    : background?.pathname.startsWith("/scan/")
      ? background.pathname
      : null;
  const scanId = scanPathname ? matchPath("/scan/:id", scanPathname)?.params.id ?? null : null;

  function closeSettings() {
    if (background) navigate(-1);
    else navigate("/");
  }

  function closeScan() {
    if (background) navigate(-1);
    else navigate("/");
  }

  return (
    <div className={`${styles.shell} register-paper`}>
      <NavCluster settingsTab={settingsTabForRoom(background?.pathname ?? location.pathname)} />
      <main className={styles.main}>
        <Suspense fallback={<div className={styles.routeFallback} />}>
          <Routes location={roomLocation(location)}>
            <Route path="/" element={<DeskPage />} />
            <Route path="/read/:id" element={<ReaderPage />} />
            <Route path="/digest/:id" element={<DigestPage />} />
            {/* Deep link / hard refresh straight at an overlay path has no
                background room to fall back on — the Desk stands in, per
                TASKS.md ("/settings ... renders the desk with the modal
                open"). */}
            <Route path="/settings" element={<DeskPage />} />
            <Route path="/scan/:id" element={<DeskPage />} />
          </Routes>
        </Suspense>
        <AnimatePresence>
          {scanId && (
            <Suspense key="scan-overlay-suspense" fallback={null}>
              <ScanOverlay key="scan-overlay" resourceId={scanId} onClose={closeScan} />
            </Suspense>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {settingsOpen && (
            <Suspense fallback={null}>
              <SettingsModal key="settings-modal" onClose={closeSettings} />
            </Suspense>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
