import { useEffect, useRef, useState } from "react";
import type { Notepad as NotepadData, PublishResult } from "@marginalia/shared";
import styles from "./Notepad.module.css";

const AUTOSAVE_DELAY_MS = 800;

function errorMessage(code: string | undefined): string {
  switch (code) {
    case "vault_path_unset":
      return "Set a vault path in Settings first.";
    case "provider_unconfigured":
      return "Configure an LLM provider in Settings first.";
    default:
      return "Publish failed.";
  }
}

function formatSummary(result: PublishResult): string {
  if (result.notes === 0) return "Already up to date — nothing new to publish.";
  return `Desk Notepad published, ${result.conceptsCreated} new concept${
    result.conceptsCreated === 1 ? "" : "s"
  }, ${result.conceptsLinked} linked`;
}

interface NotepadProps {
  onToast: (toast: { message: string; tone: "success" | "error" }) => void;
}

/**
 * The desk's scratch pad (DESIGN.md "The notepad"): a single freeform
 * markdown note, autosaved, published through the same vault-compiler path
 * as thread notes into `Notes/Desk Notepad.md` — regenerate-in-place,
 * concept-linked, no-op when unchanged (server/src/notepad/store.ts).
 */
export function Notepad({ onToast }: NotepadProps) {
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [publishing, setPublishing] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    fetch("/api/notepad")
      .then((res) => (res.ok ? (res.json() as Promise<NotepadData>) : null))
      .then((data) => {
        if (!data) return;
        setContent(data.content);
        setDirty(data.dirty);
        loaded.current = true;
      })
      .catch(() => {
        loaded.current = true;
      });
  }, []);

  function scheduleSave(next: string) {
    setContent(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("idle");
    saveTimer.current = setTimeout(async () => {
      if (!loaded.current) return;
      setSaveState("saving");
      try {
        const res = await fetch("/api/notepad", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: next }),
        });
        if (res.ok) {
          const data = (await res.json()) as NotepadData;
          setDirty(data.dirty);
          setSaveState("saved");
        }
      } catch {
        setSaveState("idle");
      }
    }, AUTOSAVE_DELAY_MS);
  }

  async function handlePublish() {
    setPublishing(true);
    try {
      const res = await fetch("/api/notepad/publish", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string } & Partial<PublishResult>;
      if (!res.ok) {
        onToast({ message: errorMessage(body.error), tone: "error" });
      } else {
        setDirty(false);
        onToast({ message: formatSummary(body as PublishResult), tone: "success" });
      }
    } catch {
      onToast({ message: "Couldn't reach the server.", tone: "error" });
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className={styles.pad} onWheel={(e) => e.stopPropagation()}>
      <div className={styles.header}>
        <span className={styles.title}>Notepad</span>
        <span className={styles.status}>
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
        </span>
      </div>
      <textarea
        className={styles.textarea}
        placeholder="Loose thoughts, drift here…"
        value={content}
        onChange={(e) => scheduleSave(e.target.value)}
      />
      <div className={styles.footer}>
        <button
          type="button"
          className={styles.publishButton}
          disabled={publishing || !dirty}
          onClick={handlePublish}
        >
          {publishing ? "Publishing…" : "Publish"}
        </button>
      </div>
    </div>
  );
}
