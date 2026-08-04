import { useEffect, useState } from "react";
import type { Settings, Voice } from "@marginalia/shared";
import { Button } from "../../controls/Button.js";
import { previewVoice } from "../../audio/audioApi.js";
import styles from "../SettingsPage.module.css";

interface AudioTabProps {
  form: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

async function fetchVoices(): Promise<Voice[] | null> {
  try {
    const res = await fetch("/api/audio/voices");
    if (!res.ok) return null;
    return (await res.json()) as Voice[];
  } catch {
    return null;
  }
}

type TestState = { status: "idle" } | { status: "testing" } | { status: "error"; message: string };

/** AUDIO.md, binding from M21: Kokoro is the only engine, so this tab has no
 * engine picker (there's nothing to pick between yet) — just the one voice
 * choice and the auto-turn preference, plus the "Test voice" button that's
 * the audio equivalent of a provider's "Test connection". */
export function AudioTab({ form, update }: AudioTabProps) {
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [voicesError, setVoicesError] = useState(false);
  const [testState, setTestState] = useState<TestState>({ status: "idle" });

  useEffect(() => {
    let cancelled = false;
    fetchVoices().then((v) => {
      if (cancelled) return;
      if (v) setVoices(v);
      else setVoicesError(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleTestVoice() {
    setTestState({ status: "testing" });
    const failure = await previewVoice(form.audioDefaultVoice);
    setTestState(
      failure
        ? { status: "error", message: failure.error === "network_error" ? "Couldn't reach the server." : "Couldn't reach the audio engine." }
        : { status: "idle" },
    );
  }

  return (
    <>
      <p className={styles.hint}>
        Kokoro reads books aloud locally — no cloud TTS, nothing leaves this machine.
      </p>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="audio-default-voice">
          Narrator voice
        </label>
        {voicesError ? (
          <p className={styles.hint}>Couldn't load the voice list — the audio engine may not be available yet.</p>
        ) : (
          <select
            id="audio-default-voice"
            className={styles.input}
            value={form.audioDefaultVoice}
            onChange={(e) => update("audioDefaultVoice", e.target.value)}
          >
            {!voices && <option value={form.audioDefaultVoice}>{form.audioDefaultVoice || "Loading…"}</option>}
            {voices?.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} — {v.accent ?? "unknown accent"}, {v.gender}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className={styles.field}>
        <div className={styles.checkboxRow}>
          <input
            id="audio-auto-turn"
            type="checkbox"
            checked={form.audioAutoTurnPages}
            onChange={(e) => update("audioAutoTurnPages", e.target.checked)}
          />
          <label className={styles.checkboxLabel} htmlFor="audio-auto-turn">
            Turn pages automatically while listening
          </label>
        </div>
      </div>
      <div className={styles.field}>
        <div className={styles.checkboxRow}>
          <Button
            variant="outline"
            size="sm"
            onClick={handleTestVoice}
            disabled={testState.status === "testing" || !form.audioDefaultVoice}
          >
            {testState.status === "testing" ? "Testing…" : "Test voice"}
          </Button>
          {testState.status === "error" && <span className={styles.statusError}>{testState.message}</span>}
        </div>
      </div>
    </>
  );
}
