/**
 * The reader room's chunk, fetched before it is routed to.
 *
 * ⚠️ M23 §E, found live and not guessed: `App.tsx` code-splits `ReaderPage`,
 * so clicking a book unmounts the Desk (and with it the Desk's 3D layer) and
 * then waits on a module fetch — **250ms measured on the dev server** — before
 * the opening's own layer registers. The shared canvas correctly hides itself
 * while nothing is registered, so what a user saw was the book vanish, a blank
 * room, and then the book reappear at the position it had vanished from, ready
 * to fly. Every frame of the sequence after that was continuous; the very first
 * one was not, which is the only frame object permanence is actually about.
 *
 * Warmed from the gesture that precedes every open — hovering or focusing a
 * book — so by the time the click lands the chunk is in memory and the handoff
 * is a single commit. Idempotent, and safe to call on every pointer move over a
 * shelf: the first call owns the promise and the rest get it back.
 *
 * This is a *latency* fix, not a correctness one. The opening still works
 * without it; it just isn't continuous, and on a cold cache or a slow disk
 * nothing here can guarantee otherwise — which is why the sequence is also
 * written to be correct from whatever pose it starts at.
 */
let pending: Promise<typeof import("./ReaderPage.js")> | null = null;

export function preloadReaderPage(): Promise<typeof import("./ReaderPage.js")> {
  pending ??= import("./ReaderPage.js");
  return pending;
}
