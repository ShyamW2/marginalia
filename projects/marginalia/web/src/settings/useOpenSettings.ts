import type { MouseEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { captureOverlayOrigin, setPendingOverlayOrigin } from "../controls/overlayOrigin.js";
import type { TabId } from "./SettingsPage.js";

/**
 * Navigates to /settings with `tab` pre-selected, preserving the "background
 * room" pattern (M11: settings is an overlay over whatever room you were
 * already in). M19.7 "settings opens where you already are": every caller
 * names the divider that makes sense for where it was clicked — the reader's
 * menu icon says "reading", the scan's says "scan", a provider picker says
 * "llm" — instead of everyone landing on the first tab regardless of context.
 *
 * Takes the triggering click event (not just a plain callback) so the modal
 * can fly from wherever this was actually clicked — see overlayOrigin.ts
 * (M19.7 "overlay motion").
 */
export function useOpenSettings(tab: TabId): (event: MouseEvent<HTMLElement>) => void {
  const location = useLocation();
  const navigate = useNavigate();
  return (event) => {
    setPendingOverlayOrigin(captureOverlayOrigin(event.currentTarget));
    navigate("/settings", { state: { background: location, settingsTab: tab } });
  };
}
