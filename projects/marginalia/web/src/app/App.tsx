import { lazy, Suspense } from "react";
import { AnimatePresence } from "motion/react";
import { Route, Routes, matchPath, useLocation, useNavigate, type Location } from "react-router-dom";
import { NavCluster } from "./NavCluster.js";
import { ChromeSlotProvider } from "./chromeSlot.js";
import { JobsProvider } from "../jobs/JobsContext.js";
import { JobToastStack } from "../jobs/JobToastStack.js";
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
const DigestOverlay = lazy(() =>
  import("../digest/DigestOverlay.js").then((m) => ({ default: m.DigestOverlay })),
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
  return pathname === "/settings" || pathname.startsWith("/scan/") || pathname.startsWith("/digest/");
}

/** Whether `prefix` (e.g. "/scan/") is open — anywhere in the chain of
 * overlays stacked through `background`, not just one level back. Walks the
 * *whole* chain the way `roomLocation` does: a Settings stacked on a
 * Settings stacked on a Scan used to stop after one hop and lose the Scan
 * (M22.5, decisions.md 2026-08-04). Shared by the Scan and Digest checks
 * below so a Settings-on-top-of-either case doesn't need writing out twice. */
export function findOverlayPathname(location: Location, prefix: string): string | null {
  let current: Location | undefined = location;
  while (current) {
    if (current.pathname.startsWith(prefix)) return current.pathname;
    current = (current.state as NavigationState | null)?.background;
  }
  return null;
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
  // The Scan/Digest overlays are open either directly, or one level further
  // back behind an open Settings — both render the same overlay underneath.
  const scanPathname = findOverlayPathname(location, "/scan/");
  const digestPathname = findOverlayPathname(location, "/digest/");
  const scanId = scanPathname ? matchPath("/scan/:id", scanPathname)?.params.id ?? null : null;
  const digestId = digestPathname ? matchPath("/digest/:id", digestPathname)?.params.id ?? null : null;

  // M22.5: whether some overlay is genuinely showing right now — from the
  // *raw* location, not `roomLocation`'s walked-back one, which resolves to
  // "/" for both "really on the Desk" and "an overlay is open over the
  // Desk" alike. DeskPage needs the distinction: its own header actions
  // join the chrome row only while it's the true foreground room, not a
  // hidden background sitting behind a modal (found live — the Digest's own
  // header nearly touched the cluster once the Desk's actions widened it).
  const overlayOpen = settingsOpen || scanId !== null || digestId !== null;

  function closeSettings() {
    if (background) navigate(-1);
    else navigate("/");
  }

  function closeScan() {
    if (background) navigate(-1);
    else navigate("/");
  }

  function closeDigest() {
    if (background) navigate(-1);
    else navigate("/");
  }

  return (
    <JobsProvider>
      <ChromeSlotProvider>
        <div className={`${styles.shell} register-paper`}>
          <NavCluster settingsTab={settingsTabForRoom(background?.pathname ?? location.pathname)} />
          <main className={styles.main}>
            <Suspense fallback={<div className={styles.routeFallback} />}>
              <Routes location={roomLocation(location)}>
                <Route path="/" element={<DeskPage overlayOpen={overlayOpen} />} />
                <Route path="/read/:id" element={<ReaderPage />} />
                {/* Deep link / hard refresh straight at an overlay path has no
                    background room to fall back on — the Desk stands in, per
                    TASKS.md ("/settings ... renders the desk with the modal
                    open"). */}
                <Route path="/settings" element={<DeskPage overlayOpen={overlayOpen} />} />
                <Route path="/scan/:id" element={<DeskPage overlayOpen={overlayOpen} />} />
                <Route path="/digest/:id" element={<DeskPage overlayOpen={overlayOpen} />} />
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
              {digestId && (
                <Suspense key="digest-overlay-suspense" fallback={null}>
                  <DigestOverlay key="digest-overlay" resourceId={digestId} onClose={closeDigest} />
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
          <JobToastStack />
        </div>
      </ChromeSlotProvider>
    </JobsProvider>
  );
}
