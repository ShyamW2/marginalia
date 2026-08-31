import { useEffect, useRef, useState } from "react";
import type { ProviderAuthProvider, ProviderCliDiagnostics } from "@marginalia/shared";
import { fetchCliDiagnostics } from "./providerAuthApi.js";
import styles from "./ProviderSetupGuide.module.css";

/**
 * The setup guide behind each account row (decisions.md 2026-08-26).
 *
 * These two providers are the only ones in the app that can't be made to work
 * by pasting a key into a field: they need a *subscription*, a *CLI installed
 * on the server's machine*, and a *sign-in that happens outside the browser*.
 * Three preconditions, none of them visible from the UI, and each one fails
 * with a different symptom. So the guide is not a link to a docs page — it
 * reports **this machine's** answer to each precondition, then says what to do
 * about the one that's wrong.
 *
 * Static prose covers the parts that are the same everywhere; the
 * `diagnostics` call covers the part that is only ever true of one machine —
 * whether the server can actually see the executable, and where it looked.
 */

interface GuideCopy {
  steps: string[];
  credentialsAt: string;
  note?: string;
}

const COPY: Record<ProviderAuthProvider, GuideCopy> = {
  codex: {
    steps: [
      "Subscribe to ChatGPT (Plus, Pro, Business, Edu or Enterprise). Codex CLI signs in with that plan — there's no API key and nothing metered per token here.",
      "Install the CLI on the machine running Marginalia's server — not on the machine with the browser, if they differ.",
      "Click Sign in above. Codex prints a short code and a verification URL; open that URL on any device, enter the code, and this panel switches to Connected on its own.",
    ],
    credentialsAt: "~/.codex/auth.json — or ~/snap/codex/current/auth.json if you installed the snap build",
    note:
      "Sign in once per machine and it should stay signed in across restarts, rebuilds and reboots. If Marginalia keeps asking, that's a bug in Marginalia's reading of the CLI, not an expired login — check the diagnostics below before signing in again.",
  },
  claude: {
    steps: [
      "Subscribe to Claude Pro or Max. Claude Code signs in with that plan; answers are billed against the subscription rather than per token.",
      "Install the CLI on the machine running Marginalia's server.",
      "Click Sign in above and finish the flow in the browser it points you to.",
    ],
    credentialsAt: "~/.claude/",
  },
};

export function ProviderSetupGuide({
  provider,
  defaultOpen,
}: {
  provider: ProviderAuthProvider;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [diagnostics, setDiagnostics] = useState<ProviderCliDiagnostics | null>(null);
  const [checking, setChecking] = useState(false);
  // "Have we asked yet", which is not the same question as "did we get an
  // answer" — keying the effect on `diagnostics` instead would retry forever
  // against a server that's down, since a failed fetch leaves it null.
  const asked = useRef(false);

  // Deliberately only fetched once the guide is opened: it shells out to
  // `--version`, and nobody should pay for that on every Settings load.
  useEffect(() => {
    if (!open || asked.current) return;
    asked.current = true;
    setChecking(true);
    void fetchCliDiagnostics(provider).then((result) => {
      setDiagnostics(result);
      setChecking(false);
    });
  }, [open, provider]);

  async function recheck() {
    setChecking(true);
    setDiagnostics(await fetchCliDiagnostics(provider));
    setChecking(false);
  }

  const copy = COPY[provider];

  return (
    <details className={styles.guide} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className={styles.summary}>How to connect, and what to check if it won't</summary>

      <ol className={styles.steps}>
        {copy.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>

      <div className={styles.block}>
        <h4 className={styles.blockTitle}>On this machine</h4>
        {checking && !diagnostics && <p className={styles.line}>Checking…</p>}
        {!checking && !diagnostics && (
          <>
            <p className={styles.line}>Couldn't reach the server to check — is it running?</p>
            <button type="button" className={styles.recheck} onClick={() => void recheck()}>
              Try again
            </button>
          </>
        )}
        {diagnostics && (
          <>
            {diagnostics.path ? (
              <p className={styles.line}>
                <span className={styles.ok}>Found</span> <code className={styles.code}>{diagnostics.bin}</code> at{" "}
                <code className={styles.code}>{diagnostics.path}</code>
                {diagnostics.version ? ` — ${diagnostics.version}` : ""}
                {diagnostics.overrideActive ? ` (via ${diagnostics.overrideEnvVar})` : ""}
              </p>
            ) : (
              <>
                <p className={styles.line}>
                  <span className={styles.bad}>Not found.</span> Marginalia's server couldn't locate{" "}
                  <code className={styles.code}>{diagnostics.bin}</code>. This is the{" "}
                  <code className={styles.code}>spawn {diagnostics.bin} ENOENT</code> error, and it does{" "}
                  <em>not</em> mean the CLI is missing — the server only sees the PATH of whatever
                  launched it, which is often not your shell's.
                </p>
                <p className={styles.line}>Two fixes, either one is enough:</p>
                <ul className={styles.fixes}>
                  <li>
                    Install it where the server can see it:{" "}
                    <code className={styles.code}>{diagnostics.installCommand}</code> (
                    <a className={styles.link} href={diagnostics.installUrl} target="_blank" rel="noreferrer">
                      other install options
                    </a>
                    )
                  </li>
                  <li>
                    Or point Marginalia straight at it — find the path with{" "}
                    <code className={styles.code}>which {diagnostics.bin}</code> in your terminal, then
                    start the server with{" "}
                    <code className={styles.code}>
                      {diagnostics.overrideEnvVar}=/that/path pnpm dev
                    </code>
                  </li>
                </ul>
                <details className={styles.searched}>
                  <summary className={styles.searchedSummary}>
                    Where it looked ({diagnostics.searchedDirs.length} directories)
                  </summary>
                  <ul className={styles.searchedList}>
                    {diagnostics.searchedDirs.map((dir) => (
                      <li key={dir}>
                        <code className={styles.code}>{dir}</code>
                      </li>
                    ))}
                  </ul>
                </details>
              </>
            )}
            <button type="button" className={styles.recheck} onClick={() => void recheck()} disabled={checking}>
              {checking ? "Checking…" : "Check again"}
            </button>
          </>
        )}
      </div>

      <div className={styles.block}>
        <h4 className={styles.blockTitle}>Where the sign-in is kept</h4>
        <p className={styles.line}>
          <code className={styles.code}>{copy.credentialsAt}</code> — the CLI's own store. Marginalia
          never copies, caches or stores your credentials; it asks the CLI, every time.
        </p>
        {copy.note && <p className={styles.line}>{copy.note}</p>}
      </div>
    </details>
  );
}
