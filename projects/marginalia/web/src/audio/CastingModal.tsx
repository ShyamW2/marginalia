import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { AudioState, BookCastMember, Voice, VoiceMode } from "@marginalia/shared";
import { FlyPanel } from "../controls/FlyPanel.js";
import { IconButton } from "../controls/IconButton.js";
import { Button } from "../controls/Button.js";
import { useDialogA11y } from "../controls/useDialogA11y.js";
import type { OverlayOrigin } from "../controls/overlayOrigin.js";
import { useJobs } from "../jobs/JobsContext.js";
import { startJobRequest } from "../jobs/jobsApi.js";
import {
  fetchAudioState,
  fetchBookCast,
  fetchVoices,
  overrideCastVoice,
  previewVoice,
  updateAudioState,
} from "./audioApi.js";
import styles from "./CastingModal.module.css";

interface CastingModalProps {
  resourceId: string;
  origin: OverlayOrigin | null;
  onClose: () => void;
}

const PLAY_ICON = (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
    <path d="M2 1.2v7.6L8.5 5 2 1.2Z" />
  </svg>
);

function formatScannedAt(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * M22 "Casting UI": the cast list, per-character voice pickers, narrator
 * voice, and the single/multi voice-mode toggle. Not a routed instrument
 * like the Scan/Digest popups (decisions.md 2026-07-30 names exactly four —
 * Scan, Digest, Settings, Annotations — and this doesn't need a bookmarkable
 * URL), so it mounts locally from the reader's own state, sharing the same
 * dialog shell as SettingsModal (backdrop + FlyPanel + useDialogA11y).
 * `// SPEC-GAP`: AUDIO.md doesn't name where casting lives; NOTES.md records
 * the choice.
 */
export function CastingModal({ resourceId, origin, onClose }: CastingModalProps) {
  const reducedMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogA11y(panelRef, onClose);

  const [audioState, setAudioState] = useState<AudioState | null>(null);
  const [cast, setCast] = useState<BookCastMember[] | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [scanJobId, setScanJobId] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const { registerStarted, jobs } = useJobs();

  function load() {
    fetchAudioState(resourceId).then((s) => s && setAudioState(s));
    fetchBookCast(resourceId).then((c) => c && setCast(c.members));
  }

  useEffect(() => {
    fetchVoices().then(setVoices);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId]);

  // Same "watch our own job id, reload on terminal status" pattern
  // DigestPage.tsx uses for its thematic/tagging jobs — the tray owns actual
  // progress/cancel, this just knows when to refetch.
  useEffect(() => {
    if (!scanJobId) return;
    const job = jobs.find((j) => j.id === scanJobId);
    if (job && job.status !== "running") {
      setScanJobId(null);
      if (job.status === "failed") setScanError(job.error ?? "cast_scan_failed");
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, scanJobId]);

  async function handleScan() {
    setScanError(null);
    const result = await startJobRequest(`/api/resources/${resourceId}/cast/scan`);
    if ("jobId" in result) {
      setScanJobId(result.jobId);
      registerStarted({ id: result.jobId, kind: "cast-scan", resourceId, resourceTitle: null });
    } else {
      setScanError(result.error);
    }
  }

  async function handleVoiceModeChange(voiceMode: VoiceMode) {
    if (audioState?.voiceMode === voiceMode) return;
    const next = await updateAudioState(resourceId, { voiceMode });
    if (next) setAudioState(next);
  }

  async function handleNarratorChange(voiceId: string) {
    const next = await updateAudioState(resourceId, { narratorVoice: voiceId });
    if (next) setAudioState(next);
  }

  async function handleMemberVoiceChange(castId: string, voiceId: string) {
    const updated = await overrideCastVoice(castId, voiceId);
    if (updated) setCast((prev) => prev?.map((m) => (m.id === castId ? updated : m)) ?? prev);
  }

  async function handlePreview(id: string, voiceId: string) {
    setPreviewingId(id);
    await previewVoice(voiceId);
    setPreviewingId(null);
  }

  const scanning = scanJobId !== null;

  return (
    <motion.div
      className={styles.backdrop}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reducedMotion ? 0.001 : 0.15, ease: "easeOut" }}
      onClick={onClose}
    >
      <FlyPanel
        ref={panelRef}
        origin={origin}
        className={`${styles.panel} register-paper`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="casting-modal-title"
        tabIndex={-1}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={(event) => event.stopPropagation()}
      >
        <IconButton icon="×" label="Close cast" className={styles.closeButton} onClick={onClose} />
        <h2 id="casting-modal-title" className={styles.title}>
          Cast
        </h2>

        <div className={styles.modeToggle} role="group" aria-label="Voice mode">
          <Button
            size="sm"
            variant="ghost"
            pressed={audioState?.voiceMode === "single"}
            onClick={() => handleVoiceModeChange("single")}
          >
            Single voice
          </Button>
          <Button
            size="sm"
            variant="ghost"
            pressed={audioState?.voiceMode === "multi"}
            onClick={() => handleVoiceModeChange("multi")}
          >
            Multi-voice
          </Button>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="cast-narrator-voice">
            Narrator voice
          </label>
          <div className={styles.voiceRow}>
            <select
              id="cast-narrator-voice"
              className={styles.select}
              value={audioState?.narratorVoice ?? ""}
              disabled={!audioState}
              onChange={(e) => handleNarratorChange(e.target.value)}
            >
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} — {v.gender}
                </option>
              ))}
            </select>
            <IconButton
              icon={PLAY_ICON}
              label="Preview narrator voice"
              size="sm"
              disabled={!audioState?.narratorVoice || previewingId === "narrator"}
              onClick={() => audioState && handlePreview("narrator", audioState.narratorVoice)}
            />
          </div>
        </div>

        <div className={styles.scanRow}>
          <span className={styles.scanStatus}>
            {cast === null
              ? "Loading…"
              : cast.length === 0
                ? "No cast scanned yet."
                : `${cast.length} character${cast.length === 1 ? "" : "s"}${
                    audioState?.castScannedAt ? ` — scanned ${formatScannedAt(audioState.castScannedAt)}` : ""
                  }`}
          </span>
          <Button variant="outline" size="sm" onClick={handleScan} disabled={scanning}>
            {scanning ? "Scanning…" : cast && cast.length > 0 ? "Re-scan cast" : "Scan cast"}
          </Button>
        </div>
        {scanError && <p className={styles.error}>Cast scan failed: {scanError}</p>}

        {cast && cast.length > 0 && (
          <ul className={styles.castList}>
            {cast.map((m) => (
              <li key={m.id} className={styles.castRow}>
                <div className={styles.castMeta}>
                  <span className={styles.castName}>{m.name}</span>
                  <span className={styles.castTags}>
                    {m.gender} · {m.ageHint}
                    {m.voiceLocked ? " · locked" : ""}
                  </span>
                  {m.description && <span className={styles.castDescription}>{m.description}</span>}
                </div>
                <div className={styles.voiceRow}>
                  <select
                    className={styles.select}
                    value={m.voiceId}
                    onChange={(e) => handleMemberVoiceChange(m.id, e.target.value)}
                  >
                    {!m.voiceId && <option value="">— unassigned —</option>}
                    {voices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label} — {v.gender}
                      </option>
                    ))}
                  </select>
                  <IconButton
                    icon={PLAY_ICON}
                    label={`Preview ${m.name}'s voice`}
                    size="sm"
                    disabled={!m.voiceId || previewingId === m.id}
                    onClick={() => m.voiceId && handlePreview(m.id, m.voiceId)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </FlyPanel>
    </motion.div>
  );
}
