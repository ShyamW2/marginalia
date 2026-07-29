import { useLocation, useNavigate } from "react-router-dom";

/**
 * Navigates to /settings with the LLM divider pre-selected, preserving the
 * "background room" pattern (M11: settings is an overlay over whatever room
 * you were already in) — the click-through the scan's slider and the
 * reader's provider icon both need. Kept out of SettingsPage.tsx on purpose:
 * that module pulls in the whole binder (tabs, ProviderPicker, UsageDivider)
 * and this hook is used from the Scan and Reader rooms, which are
 * code-split away from Settings.
 */
export function useOpenSettingsToLLM(): () => void {
  const location = useLocation();
  const navigate = useNavigate();
  return () => {
    navigate("/settings", { state: { background: location, settingsTab: "llm" } });
  };
}
