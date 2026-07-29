import { useEffect, useRef } from "react";

/**
 * One shortcut registry (decisions.md 2026-07-30, TASKS.md M19.7): every
 * room/instrument that wants a bare-key shortcut registers through this hook
 * instead of rolling its own `window.addEventListener("keydown", ...)` plus
 * its own copy of the isTyping guard — the fourth ad-hoc listener this was
 * written to remove. M19.6's `r` (open the reader from the Scan/Digest) is
 * the registry's first consumer; keycap-hint UI (deriving what's on-screen
 * from what's actually bound) is the rest of M19.7 and isn't built yet.
 */
export interface ShortcutBinding {
  /** KeyboardEvent.key, compared case-insensitively for letters. */
  key: string;
  /** undefined = don't care about shift state; true/false = require it —
   * lets "f" and "shift+f" (focus mode vs. fullscreen) coexist as separate
   * bindings in the same scope. */
  shift?: boolean;
  handler: (event: KeyboardEvent) => void;
  /** Fire even while focus is in a text input/textarea/contentEditable.
   * Default false — almost every existing shortcut ("f", "[", arrows) is a
   * plain letter/typing key elsewhere in the app. */
  allowWhileTyping?: boolean;
}

type ScopeHandler = (event: KeyboardEvent) => boolean;

// Module-level stack, not per-hook state: several scopes can be mounted at
// once (a settings modal opened on top of the reader), and the one mounted
// most recently should get first refusal — the same layering the previous
// capture-phase-listener trick (SettingsModal) achieved, without needing
// every scope to know about every other one.
const scopeStack: ScopeHandler[] = [];
let windowListenerAttached = false;

function dispatch(event: KeyboardEvent): void {
  for (let i = scopeStack.length - 1; i >= 0; i--) {
    if (scopeStack[i](event)) return;
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return el?.tagName === "TEXTAREA" || el?.tagName === "INPUT" || Boolean(el?.isContentEditable);
}

function matches(binding: ShortcutBinding, event: KeyboardEvent): boolean {
  if (event.key.toLowerCase() !== binding.key.toLowerCase()) return false;
  if (binding.shift !== undefined && event.shiftKey !== binding.shift) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  return true;
}

/**
 * Registers `bindings` as one scope for as long as the calling component is
 * mounted. `bindings` is read fresh on every keydown via a ref, so callers
 * can pass a new array each render with no dependency-array bookkeeping.
 */
export function useShortcuts(bindings: ShortcutBinding[]): void {
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  useEffect(() => {
    function scopeHandler(event: KeyboardEvent): boolean {
      const typing = isTypingTarget(event.target);
      for (const binding of bindingsRef.current) {
        if (typing && !binding.allowWhileTyping) continue;
        if (matches(binding, event)) {
          binding.handler(event);
          return true;
        }
      }
      return false;
    }

    scopeStack.push(scopeHandler);
    if (!windowListenerAttached) {
      window.addEventListener("keydown", dispatch);
      windowListenerAttached = true;
    }

    return () => {
      const idx = scopeStack.indexOf(scopeHandler);
      if (idx !== -1) scopeStack.splice(idx, 1);
      if (scopeStack.length === 0 && windowListenerAttached) {
        window.removeEventListener("keydown", dispatch);
        windowListenerAttached = false;
      }
    };
  }, []);
}
