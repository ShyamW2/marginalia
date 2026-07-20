import html2canvas from "html2canvas";

// Live-verification (headless Chromium, real dev server — NOTES.md M10) hit
// a genuine hang, not just a slow capture: html2canvas clones the target
// subtree into a detached iframe to read computed styles reliably, and
// epub.js's section iframe is *sandboxed*
// (`iframe.sandbox = "allow-same-origin allow-scripts"`, content set via
// `srcdoc`) — cloning + waiting on that clone's load event never resolved,
// so the capture promise hung forever with nothing to catch, freezing every
// future page turn (turnLockRef never released). A `try/catch` around
// html2canvas does nothing for a hang — only a promise that never settles
// hangs, it doesn't throw. Race it against a hard deadline instead: capture
// is a best-effort visual flourish, so on either a throw or a timeout,
// turning the page must never depend on it succeeding.
const CAPTURE_TIMEOUT_MS = 700;

export async function capturePageSnapshot(
  container: HTMLElement,
): Promise<string | null> {
  try {
    const canvas = await Promise.race([
      html2canvas(container, {
        backgroundColor: null,
        logging: false,
        // The default renderer clones the target into a detached iframe to
        // read computed styles reliably — that's exactly the path that hung
        // (see above). foreignObjectRendering instead serializes the *live*
        // subtree straight into an SVG <foreignObject> and paints it via the
        // browser's own rendering pipeline, which both sidesteps the clone
        // entirely and, as a side effect, paints the live iframe's actual
        // content natively rather than needing to re-render a clone of it.
        foreignObjectRendering: true,
        // Capped at 1.5x device pixel ratio: the curl only needs to look
        // sharp while turning, not print-quality, and full retina
        // resolution measurably slows capture on high-DPI displays for no
        // visible benefit during a ~400ms animation.
        scale: Math.min(window.devicePixelRatio || 1, 1.5),
      }),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), CAPTURE_TIMEOUT_MS);
      }),
    ]);
    return canvas ? canvas.toDataURL("image/png") : null;
  } catch {
    // Snapshot capture is a best-effort visual flourish — any failure
    // (an unusual book's markup, a browser quirk) falls back to the plain
    // slide transition rather than blocking the page turn itself.
    return null;
  }
}
