import { describe, expect, it } from "vitest";
import { SHORTCUT_KEYS } from "./keys";

/**
 * M24.7 §G (decisions.md 2026-08-22): focus mode and fullscreen both answered
 * to "f" until the rebind, distinguished only by shift — so a bare "f" fired
 * whichever branch an ad-hoc `if (event.shiftKey)` checked first, and the
 * on-screen keycap had to carry a "⇧" to avoid advertising a key that did
 * nothing. Focus mode moved to "n"; these tests are what stop the next
 * shortcut from reintroducing the collision silently.
 */
describe("SHORTCUT_KEYS", () => {
  /**
   * Keys two bindings deliberately share because a modifier tells them apart.
   * Each is documented at its declaration in keys.ts; anything else sharing a
   * key is an accident.
   */
  const MODIFIER_DISTINGUISHED = new Set(["ArrowLeft", "ArrowRight", "f"]);

  it("gives focus mode and fullscreen different keys", () => {
    expect(SHORTCUT_KEYS.focusMode).not.toBe(SHORTCUT_KEYS.fullscreen);
  });

  it("shares a key only where a modifier distinguishes the bindings", () => {
    const byKey = new Map<string, string[]>();
    for (const [name, key] of Object.entries(SHORTCUT_KEYS)) {
      byKey.set(key, [...(byKey.get(key) ?? []), name]);
    }

    const unexpected = [...byKey.entries()]
      .filter(([key, names]) => names.length > 1 && !MODIFIER_DISTINGUISHED.has(key))
      .map(([key, names]) => `${key} <- ${names.join(", ")}`);

    expect(unexpected).toEqual([]);
  });

  it("keeps every shared key down to exactly two bindings", () => {
    // Three bindings on one key cannot be told apart by shift-or-meta alone,
    // which is the only disambiguation `useShortcuts.matches` offers.
    for (const key of MODIFIER_DISTINGUISHED) {
      const names = Object.entries(SHORTCUT_KEYS)
        .filter(([, k]) => k === key)
        .map(([name]) => name);
      expect(names.length, `${key} is bound by ${names.join(", ")}`).toBeLessThanOrEqual(2);
    }
  });
});
