export interface OverlayOrigin {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function captureOverlayOrigin(el: Element): OverlayOrigin {
  const rect = el.getBoundingClientRect();
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

/**
 * Bridges a click-time rect to an overlay that mounts later through routing
 * (Settings opens as a route change, per App.tsx's "background location"
 * pattern — there's no prop path from an arbitrary trigger, possibly in a
 * different code-split chunk, straight to the panel). The trigger sets this
 * the instant it's clicked; the overlay reads it on mount, per decisions.md
 * 2026-07-30 ("the origin is the invoking control's rect, read at click time
 * and handed to the overlay — not a hardcoded corner"). A direct/deep link
 * with no recent click leaves it stale/absent, which every consumer renders
 * as a plain crossfade.
 *
 * Deliberately non-destructive (a plain read, not a dequeue): an earlier
 * "take and clear" version broke under React 18 StrictMode, which
 * double-invokes mount-time initializers in dev to catch exactly this kind
 * of impurity — the discarded first invocation cleared it before the real
 * one ran, so every real mount saw null. A short staleness window gets the
 * behaviour that clearing was for (an old click never leaks into an
 * unrelated later open) without depending on being read exactly once.
 */
const STALE_AFTER_MS = 3000;
let pending: { origin: OverlayOrigin; capturedAt: number } | null = null;

export function setPendingOverlayOrigin(origin: OverlayOrigin): void {
  pending = { origin, capturedAt: Date.now() };
}

export function readPendingOverlayOrigin(): OverlayOrigin | null {
  if (!pending) return null;
  if (Date.now() - pending.capturedAt > STALE_AFTER_MS) return null;
  return pending.origin;
}
