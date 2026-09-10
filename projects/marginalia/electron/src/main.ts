import path from "node:path";
import { app, BrowserWindow, Menu, dialog, screen, shell } from "electron";
import { buildMenu } from "./menu.js";
import { detectSoftwareRendering } from "./gpuDetect.js";
import { startServer, watchServerMemory, ServerStartupError, type ServerHandle } from "./serverProcess.js";
import { clampToDisplays, loadWindowState, saveWindowState, type WindowState } from "./windowState.js";

/**
 * M45 (DESKTOP.md §5 "M45 — The Electron shell"). Main process, window,
 * menu, single-instance lock, window-state persistence, the server in a
 * `utilityProcess`, and the GPU-software-rendering detector that feeds
 * `Scene3D.tsx`'s existing `canRender` gate. Nothing here adds a reader
 * feature or a data bridge — the renderer is an ordinary same-origin SPA
 * loading `http://127.0.0.1:<port>/`, exactly as DESKTOP.md §2.3 requires.
 */

// electron/dist/main.js -> electron/dist -> electron -> projects/marginalia
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

// M46 (DESKTOP.md §4, NOTES.md's memory budget): caps the server
// `utilityProcess`'s real RSS, polled via `app.getAppMetrics()`
// (`watchServerMemory`) rather than a V8 heap flag. `execArgv`'s
// `--max-old-space-size` was tried first — see `serverProcess.ts`'s own
// doc comment for the live verification that Electron 40 doesn't actually
// apply it to a utility process. RSS is the more honest target anyway:
// DESKTOP.md §4.4's measured baseline is 214MB server RSS, and §4 puts the
// Kokoro session's own native ONNX allocation (outside the JS heap
// entirely) at 200–400MB on top of that once audio has played — so normal,
// legitimate operation can reach ~600MB. 1536MB is generous headroom over
// that ceiling, while still being small enough next to a typical machine's
// RAM that a true runaway (an unbounded array, a leaked buffer) is caught
// as a crash report rather than left to swap the machine.
const SERVER_MAX_RSS_MB = 1536;

/** Where the server's compiled entry point lives. Packaged layout (M47's
 * `extraResource`) is `<resourcesPath>/server/index.js`; unpackaged (this
 * milestone) it's the sibling `server/dist/index.js` this repo already
 * builds. */
function resolveServerEntry(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "server", "index.js");
  return path.join(PROJECT_ROOT, "server", "dist", "index.js");
}

/** What `paths.ts`'s `resolveResourceDir()` should treat as `resourcesPath`
 * inside the forked server — see `MARGINALIA_RESOURCES_PATH`'s doc comment
 * there for why main passes this explicitly rather than relying on the
 * utility process inheriting it on its own. */
function resolveResourcesForServer(): string {
  return app.isPackaged ? process.resourcesPath : PROJECT_ROOT;
}

let mainWindow: BrowserWindow | null = null;
let serverHandle: ServerHandle | null = null;
// Set before `before-quit` kills the server, so its own `exit` handler can
// tell "we did this on purpose" from an actual crash rather than popping a
// crash dialog on every ordinary Cmd+Q.
let quitting = false;

function windowStateFile(): string {
  return path.join(app.getPath("userData"), "window-state.json");
}

function persistWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  const bounds = win.getBounds();
  const state: WindowState = { ...bounds, isMaximized: win.isMaximized() };
  try {
    saveWindowState(windowStateFile(), state);
  } catch {
    // Best-effort — a failed save costs the next launch its remembered
    // geometry, nothing else.
  }
}

/** Debounced so a drag-resize doesn't write the file on every intermediate
 * frame. */
function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

function createWindow(port: number): void {
  const stateFile = windowStateFile();
  const displayBounds = screen.getAllDisplays().map((d) => d.bounds);
  const state = clampToDisplays(loadWindowState(stateFile), displayBounds);

  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;

  if (state.isMaximized) win.maximize();
  win.once("ready-to-show", () => win.show());

  const persist = debounce(() => persistWindowState(win), 500);
  win.on("resize", persist);
  win.on("move", persist);
  win.on("close", () => persistWindowState(win));
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  // The renderer's whole surface is the loopback server (DESKTOP.md §2.3:
  // no API base, no CORS, no preload bridge — same-origin, full stop).
  // Anything asking to navigate or open a window elsewhere is treated as an
  // external link, same as a browser tab would, rather than silently
  // following it inside the app shell.
  const origin = `http://127.0.0.1:${port}`;
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${origin}/`) && url !== origin) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  void win.loadURL(`${origin}/`);
}

function reportStartupFailure(error: unknown): void {
  const message =
    error instanceof ServerStartupError
      ? error.stderr.trim() || error.message
      : error instanceof Error
        ? error.message
        : String(error);
  dialog.showErrorBox("Marginalia could not start", message);
}

async function launch(): Promise<void> {
  Menu.setApplicationMenu(buildMenu());

  const softwareRendering = await detectSoftwareRendering();

  let handle: ServerHandle;
  try {
    handle = await startServer(
      resolveServerEntry(),
      {
        ...process.env,
        NODE_ENV: "production",
        MARGINALIA_RESOURCES_PATH: resolveResourcesForServer(),
        MARGINALIA_SOFTWARE_RENDERING: softwareRendering ? "1" : "0",
      },
      // eslint-disable-next-line no-console
      (line, stream) => (stream === "stderr" ? console.error(line) : console.log(line)),
    );
  } catch (error) {
    reportStartupFailure(error);
    app.quit();
    return;
  }

  serverHandle = handle;
  handle.process.on("exit", (code) => {
    if (quitting) return;
    // A crash *after* a clean start, not a startup failure — same report,
    // main is still the one who noticed, not the window going blank.
    if (code !== 0 && serverHandle === handle) {
      dialog.showErrorBox(
        "Marginalia has stopped",
        `The server process exited unexpectedly (code ${code}). Restart the app to continue.`,
      );
      app.quit();
    }
  });

  // M46: the loud-failure half of the memory budget. `stopMemoryWatch`
  // clears the poll on any path that ends this server (a clean quit, or
  // the ordinary crash handler above already having fired) so it never
  // outlives the handle it's watching.
  const stopMemoryWatch = watchServerMemory(
    handle.process,
    SERVER_MAX_RSS_MB,
    () => app.getAppMetrics(),
    (rssMb) => {
      stopMemoryWatch();
      if (serverHandle !== handle) return;
      // Null it *before* killing: the generic exit handler above checks
      // `serverHandle === handle` specifically so this deliberate kill
      // reports once, with the real reason, instead of twice.
      serverHandle = null;
      handle.process.kill();
      dialog.showErrorBox(
        "Marginalia has stopped",
        `The server exceeded its memory budget (${rssMb.toFixed(0)}MB, over the ${SERVER_MAX_RSS_MB}MB limit) and was stopped. Restart the app to continue.`,
      );
      app.quit();
    },
  );
  handle.process.on("exit", stopMemoryWatch);

  createWindow(handle.port);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => void launch());

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverHandle) {
      createWindow(serverHandle.port);
    }
  });

  app.on("before-quit", () => {
    quitting = true;
    serverHandle?.process.kill();
  });
}
