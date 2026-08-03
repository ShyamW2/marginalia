import type { Settings } from "@marginalia/shared";

const EVENT = "marginalia:settings-saved";

/**
 * Settings is a modal overlaying whatever room the user was already in
 * (M11) — the reader underneath never unmounts, so a setting that must
 * "take effect live without a reload" (M14's readerMargin) needs some way to
 * reach a component that isn't remounting. A plain DOM CustomEvent so any
 * component can react without prop-drilling settings through the whole
 * route tree.
 */
export function emitSettingsSaved(settings: Settings): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<Settings>(EVENT, { detail: settings }));
}

export function onSettingsSaved(handler: (settings: Settings) => void): () => void {
  function listener(event: Event) {
    handler((event as CustomEvent<Settings>).detail);
  }
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
