import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Settings, SettingsUpdate } from "@marginalia/shared";
import { emitSettingsSaved } from "./settingsBus.js";
import { ReadingTab } from "./tabs/ReadingTab.js";
import { LLMTab } from "./tabs/LLMTab.js";
import { UsageDivider } from "./UsageDivider.js";
import { ScanTab } from "./tabs/ScanTab.js";
import { AudioTab } from "./tabs/AudioTab.js";
import { DeskTab } from "./tabs/DeskTab.js";
import { Button } from "../controls/Button.js";
import styles from "./SettingsPage.module.css";

type FormState = Settings;

type TabId = "reading" | "llm" | "usage" | "scan" | "audio" | "desk";

/** The book/binder shell (TASKS.md M19: "tabbed dividers down the side").
 * Reading/Scan/Desk are still one shared Settings form + Save button, same
 * as before this milestone — only reorganized into dividers. LLM manages
 * its own provider profiles/roles (M19's other task) and Usage is a
 * read-only ledger view; neither needs the Save bar. */
const TABS: { id: TabId; label: string }[] = [
  { id: "reading", label: "Reading" },
  { id: "llm", label: "LLM" },
  { id: "usage", label: "Usage" },
  { id: "scan", label: "Scan" },
  { id: "audio", label: "Audio" },
  { id: "desk", label: "Desk" },
];

const SAVES_VIA_FORM: ReadonlySet<TabId> = new Set(["reading", "scan", "desk"]);

async function fetchSettings(): Promise<Settings | null> {
  try {
    const res = await fetch("/api/settings");
    if (!res.ok) return null;
    return (await res.json()) as Settings;
  } catch {
    return null;
  }
}

interface SettingsLocationState {
  background?: unknown;
  /** Deep-link into a specific divider — used by the reader/scan provider
   * pickers' "Settings →" click-through so it lands on LLM, not the first tab. */
  settingsTab?: TabId;
}

interface SettingsPageProps {
  /** Set when rendered inside SettingsModal so aria-labelledby can point at
   * the heading; undefined (no id) when there's no dialog wrapper needing one. */
  titleId?: string;
}

export function SettingsPage({ titleId }: SettingsPageProps = {}) {
  const location = useLocation();
  const reducedMotion = Boolean(useReducedMotion());
  const requestedTab = (location.state as SettingsLocationState | null)?.settingsTab;

  const [form, setForm] = useState<FormState | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>(requestedTab ?? "reading");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement>>>({});

  useEffect(() => {
    fetchSettings().then((s) => setForm(s));
  }, []);

  // A click-through from the reader/scan pickers arrives with a fresh
  // `settingsTab` in location.state (react-router replaces state per
  // navigation) — jump the binder to it even if it's already mounted.
  useEffect(() => {
    if (requestedTab) setActiveTab(requestedTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedTab]);

  if (!form) {
    return (
      <div className={styles.page}>
        <h1 id={titleId} className={styles.title}>Settings</h1>
      </div>
    );
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSaveMessage(null);
  }

  async function handleSave() {
    if (!form) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const body: SettingsUpdate = { ...form };
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const saved = (await res.json()) as Settings;
        setForm(saved);
        setSaveMessage("Saved.");
        emitSettingsSaved(saved);
      } else {
        setSaveMessage("Couldn't save settings.");
      }
    } catch {
      setSaveMessage("Couldn't reach the server.");
    } finally {
      setSaving(false);
    }
  }

  function goToTab(id: TabId, focus: boolean) {
    setActiveTab(id);
    if (focus) tabRefs.current[id]?.focus();
  }

  // WAI-ARIA tabs pattern: Left/Right (Home/End) move focus *and* activate
  // (automatic activation) — a real tablist, never divs with click handlers
  // (TASKS.md acceptance).
  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    goToTab(TABS[nextIndex].id, true);
  }

  return (
    <div className={styles.page}>
      <h1 id={titleId} className={styles.title}>Settings</h1>

      <div className={styles.binder}>
        <div className={styles.dividers} role="tablist" aria-label="Settings sections" aria-orientation="vertical">
          {TABS.map((tab, index) => (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) tabRefs.current[tab.id] = el;
              }}
              type="button"
              role="tab"
              id={`settings-tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              aria-controls={`settings-panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              className={activeTab === tab.id ? `${styles.divider} ${styles.dividerActive}` : styles.divider}
              onClick={() => goToTab(tab.id, false)}
              onKeyDown={(e) => handleTabKeyDown(e, index)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className={styles.pageArea}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeTab}
              role="tabpanel"
              id={`settings-panel-${activeTab}`}
              aria-labelledby={`settings-tab-${activeTab}`}
              tabIndex={0}
              className={styles.panel}
              initial={reducedMotion ? { opacity: 1 } : { opacity: 0, rotateY: -6, x: 10 }}
              animate={{ opacity: 1, rotateY: 0, x: 0 }}
              exit={reducedMotion ? { opacity: 1 } : { opacity: 0, rotateY: 6, x: -10 }}
              transition={{ duration: reducedMotion ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
              style={{ transformPerspective: 800 }}
            >
              {activeTab === "reading" && <ReadingTab form={form} update={update} />}
              {activeTab === "llm" && <LLMTab form={form} update={update} />}
              {activeTab === "usage" && <UsageDivider />}
              {activeTab === "scan" && <ScanTab form={form} update={update} />}
              {activeTab === "audio" && <AudioTab />}
              {activeTab === "desk" && (
                <DeskTab
                  form={form}
                  update={update}
                />
              )}
            </motion.div>
          </AnimatePresence>

          {SAVES_VIA_FORM.has(activeTab) && (
            <div className={styles.actions}>
              <Button variant="solid" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              {saveMessage && <span className={styles.statusText}>{saveMessage}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
