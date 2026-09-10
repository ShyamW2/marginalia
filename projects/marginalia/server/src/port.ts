import net from "node:net";

/**
 * M44 (DESKTOP.md §3.4): prefer the stable, well-known port so a browser's
 * own origin-keyed state stays put across launches, and fall back to the
 * next one only when something else — another copy of the app, or the
 * operator's own `pnpm dev` — already holds it, so two instances can still
 * both run. The four appearance settings that used to depend on this port
 * never changing (`UiAppearanceSettingsSchema`) now live in the sidecar
 * store instead, so a fallback here costs origin stability, not
 * correctness.
 */
export async function resolvePort(preferred: number, attempts = 20): Promise<number> {
  for (let candidate = preferred; candidate < preferred + attempts; candidate++) {
    if (await isPortFree(candidate)) return candidate;
  }
  throw new Error(`No free port found in ${preferred}-${preferred + attempts - 1}`);
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, "127.0.0.1");
  });
}
