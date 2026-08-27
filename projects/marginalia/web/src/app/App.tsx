import { lazy, Suspense } from "react";
import { preloadReaderPage } from "../reader/preload.js";
import { AnimatePresence } from "motion/react";
import { Route, Routes, matchPath, useLocation, useNavigate, type Location } from "react-router-dom";
import type { SearchMatchMode } from "@marginalia/shared";
import { NavCluster } from "./NavCluster.js";
import { ServerStatusBanner } from "./ServerStatusBanner.js";
import { ChromeSlotProvider } from "./chromeSlot.js";
import { useAccent } from "./useAccent.js";
import { usePaperTint } from "./usePaperTint.js";
import { useBlockPageZoom } from "./useBlockPageZoom.js";
import { JobsProvider } from "../jobs/JobsContext.js";
import { JobToastStack } from "../jobs/JobToastStack.js";
import { Scene3DProvider } from "../scene3d/Scene3D.js";
import type { TabId } from "../settings/SettingsPage.js";
import styles from "./App.module.css";

// Code-split per room: epub.js (the reader's biggest dependency) only loads
// when the user actually navigates to /read/:id, instead of bloating the
// single entry chunk every route paid for before this split.
const DeskPage = lazy(() =>
  import("../desk/DeskPage.js").then((m) => ({ default: m.DeskPage })),
);
// Shares its promise with `preloadReaderPage`, which the Desk and the shelf
// call on hover — so a book that has been pointed at has already fetched the
// room it opens into, and the opening's 3D layer registers in the same commit
// the Desk's unregisters (M23 §E).
const ReaderPage = lazy(() => preloadReaderPage().then((m) => ({ default: m.ReaderPage })));
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
  /** M24: the reader find bar's "see in Scan" handoff — carries the live
   * query and which hit was current, so the Scan opens already on it
   * (TASKS.md M24 A acceptance: "same query, same hit count, cursor on the
   * same hit"). Absent on every other way into the Scan. */
  findQuery?: string;
  findCursorHitIndex?: number;
  /** M24.1 C: and which matching rule produced that set. */
  findMatchMode?: SearchMatchMode;
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
export function findOverlayLocation(location: Location, prefix: string): Location | null {
  let current: Location | undefined = location;
  while (current) {
    if (current.pathname.startsWith(prefix)) return current;
    current = (current.state as NavigationState | null)?.background;
  }
  return null;
}

export function findOverlayPathname(location: Location, prefix: string): string | null {
  return findOverlayLocation(location, prefix)?.pathname ?? null;
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

  // M22.6 §E: applies whatever custom accent/paper tint is already stored
  // (localStorage, same client-only persistence as useTheme.ts) the moment
  // the app mounts, independent of Settings ever being opened this session
  // — the picker in AppearanceTab is a second, self-contained instance of
  // each hook that edits the same stored value, not this app-wide one.
  useAccent();
  usePaperTint();
  // M31 §0d: blocks WebKit's page-zoom gesture app-wide, not per-room — the
  // Scan's own pinch (M31 B) and the reader's pinch-to-resize (M31 C6) both
  // depend on the browser never claiming the gesture first.
  useBlockPageZoom();

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
  const scanLocation = findOverlayLocation(location, "/scan/");
  const digestPathname = findOverlayPathname(location, "/digest/");
  const scanId = scanLocation ? matchPath("/scan/:id", scanLocation.pathname)?.params.id ?? null : null;
  const digestId = digestPathname ? matchPath("/digest/:id", digestPathname)?.params.id ?? null : null;
  // M24: read from `scanLocation`'s own state, not the raw (possibly
  // Settings-stacked) `location` — the handoff's query/cursor live on
  // whichever location entry actually opened the Scan.
  const scanState = scanLocation?.state as NavigationState | null;

  // M22.5: whether some overlay is genuinely showing right now — from the
  // *raw* location, not `roomLocation`'s walked-back one, which resolves to
  // "/" for both "really on the Desk" and "an overlay is open over the
  // Desk" alike. DeskPage needs the distinction: its own header actions
  // join the chrome row only while it's the true foreground room, not a
  // hidden background sitting behind a modal (found live — the Digest's own
  // header nearly touched the cluster once the Desk's actions widened it).
  const overlayOpen = settingsOpen || scanId !== null || digestId !== null;

  // M24.7 A: the reader owns its own embedded, un-floated `NavCluster` (one
  // line of chrome above the page, pane-relative rather than viewport-fixed
  // — see NavCluster.tsx's own comment) — this floating instance would
  // otherwise duplicate it. Walks back through any open overlay the same
  // way `settingsTabForRoom` does, so a Settings/Scan/Digest stacked over
  // the reader still hides this one rather than showing both.
  const isReaderRoom = matchPath("/read/:id", roomLocation(location).pathname) !== null;

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
        <Scene3DProvider>
          <div className={`${styles.shell} register-paper`}>
            {/* M22.6 F: outside <main> and above every overlay — the server being gone
                outranks whatever room or instrument is currently on screen. */}
            <ServerStatusBanner />
            {!isReaderRoom && (
              <NavCluster settingsTab={settingsTabForRoom(background?.pathname ?? location.pathname)} />
            )}
            <main className={styles.main}>
              <Suspense fallback={<div className={styles.routeFallback} />}>
                <Routes location={roomLocation(location)}>
                  <Route path="/" element={<DeskPage overlayOpen={overlayOpen} />} />
                  <Route
                    path="/read/:id"
                    element={
                      // The room's own `useLocation()` is remapped by this
                      // `<Routes location>` override to its own path (never
                      // "/scan/:id"/"/digest/:id"), so it can't tell on its own
                      // whether an overlay it opened is still showing above it
                      // — the same reason DeskPage takes `overlayOpen` as a
                      // prop instead of computing it. `scanOpen`/`digestOpen`
                      // and the matching close functions are threaded down so
                      // ReaderPage's `q`/`g` can toggle rather than re-open
                      // (decisions.md 2026-08-12 ruling 1): one already-open
                      // check, reused, not a second copy of it.
                      <ReaderPage
                        scanOpen={scanId !== null}
                        digestOpen={digestId !== null}
                        onCloseScan={closeScan}
                        onCloseDigest={closeDigest}
                      />
                    }
                  />
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
                    <ScanOverlay
                      key="scan-overlay"
                      resourceId={scanId}
                      onClose={closeScan}
                      initialQuery={scanState?.findQuery}
                      initialCursorHitIndex={scanState?.findCursorHitIndex}
                      initialMatchMode={scanState?.findMatchMode}
                    />
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
        </Scene3DProvider>
      </ChromeSlotProvider>
    </JobsProvider>
  );
}
