import { useEffect, useRef, useState } from "react";
import type { ProviderAuthFlowState, ProviderAuthProvider, ProviderAuthStatus } from "@marginalia/shared";
import { Button } from "../controls/Button.js";
import {
  cancelLogin,
  fetchAuthStatus,
  fetchLoginFlow,
  logoutProvider,
  startLogin,
} from "./providerAuthApi.js";
import styles from "./ProviderAuth.module.css";

const PROVIDERS: { id: ProviderAuthProvider; label: string; hint: string }[] = [
  {
    id: "codex",
    label: "Codex CLI",
    hint: "OpenAI's coding agent, run caged and read-only for the codex-cli provider.",
  },
  {
    id: "claude",
    label: "Claude Code",
    hint: "The claude-agent provider — answers billed against your Claude subscription, not per-token.",
  },
];

const POLL_INTERVAL_MS = 1500;

interface RowState {
  status: ProviderAuthStatus | null;
  loadingStatus: boolean;
  flow: ProviderAuthFlowState | null;
  actionError: string | null;
}

function blankRow(): RowState {
  return { status: null, loadingStatus: true, flow: null, actionError: null };
}

/**
 * M26 lead-in (decisions.md 2026-08-25): sign in to Codex/Claude from
 * Settings instead of a terminal — spawns the same CLI login command an
 * operator would run by hand and streams its output back. Sits above the
 * role pickers in the LLM tab since signing in is machine-level, not tied
 * to one profile.
 */
export function ProviderAuth() {
  const [rows, setRows] = useState<Record<ProviderAuthProvider, RowState>>({
    codex: blankRow(),
    claude: blankRow(),
  });
  const pollHandle = useRef<ReturnType<typeof setInterval> | null>(null);

  function patchRow(provider: ProviderAuthProvider, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [provider]: { ...prev[provider], ...patch } }));
  }

  async function refreshStatus(provider: ProviderAuthProvider) {
    patchRow(provider, { loadingStatus: true });
    const status = await fetchAuthStatus(provider);
    patchRow(provider, { status, loadingStatus: false });
  }

  useEffect(() => {
    void refreshStatus("codex");
    void refreshStatus("claude");
    return () => {
      if (pollHandle.current) clearInterval(pollHandle.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopPolling() {
    if (pollHandle.current) {
      clearInterval(pollHandle.current);
      pollHandle.current = null;
    }
  }

  async function handleSignIn(provider: ProviderAuthProvider) {
    patchRow(provider, { actionError: null });
    const flow = await startLogin(provider);
    if (!flow) {
      patchRow(provider, { actionError: "Couldn't start sign-in — is the server running?" });
      return;
    }
    patchRow(provider, { flow });

    stopPolling();
    pollHandle.current = setInterval(() => {
      void (async () => {
        const next = await fetchLoginFlow(provider, flow.flowId);
        if (!next) return;
        setRows((prev) => ({ ...prev, [provider]: { ...prev[provider], flow: next } }));
        if (next.status === "success" || next.status === "error" || next.status === "cancelled") {
          stopPolling();
          if (next.status === "success") void refreshStatus(provider);
        }
      })();
    }, POLL_INTERVAL_MS);
  }

  async function handleCancel(provider: ProviderAuthProvider, flowId: string) {
    stopPolling();
    await cancelLogin(provider, flowId);
    patchRow(provider, { flow: null });
  }

  async function handleDismiss(provider: ProviderAuthProvider) {
    patchRow(provider, { flow: null });
  }

  async function handleSignOut(provider: ProviderAuthProvider) {
    patchRow(provider, { actionError: null });
    await logoutProvider(provider);
    await refreshStatus(provider);
  }

  return (
    <div className={styles.panel}>
      <h3 className={styles.title}>Accounts</h3>
      <p className={styles.hint}>
        Sign in once per machine — the codex-cli and claude-agent providers above use
        whichever account is signed in here.
      </p>
      {PROVIDERS.map(({ id, label, hint }) => {
        const row = rows[id];
        return (
          <div key={id} className={styles.row}>
            <div className={styles.rowHead}>
              <div>
                <div className={styles.rowLabel}>{label}</div>
                <p className={styles.rowHint}>{hint}</p>
              </div>
              {!row.loadingStatus && row.status && (
                <div className={styles.rowActions}>
                  <span
                    className={row.status.loggedIn ? styles.statusOk : styles.statusOff}
                  >
                    {row.status.loggedIn ? "Connected" : "Not signed in"}
                    {row.status.detail ? ` — ${row.status.detail}` : ""}
                  </span>
                  {row.status.loggedIn ? (
                    <Button variant="outline" size="sm" onClick={() => void handleSignOut(id)}>
                      Sign out
                    </Button>
                  ) : (
                    <Button
                      variant="solid"
                      size="sm"
                      onClick={() => void handleSignIn(id)}
                      disabled={row.flow !== null && row.flow.status !== "error" && row.flow.status !== "cancelled"}
                    >
                      Sign in
                    </Button>
                  )}
                </div>
              )}
            </div>
            {row.actionError && <p className={styles.statusError}>{row.actionError}</p>}
            {row.flow && (
              <div className={styles.flow}>
                {(row.flow.status === "starting" || row.flow.status === "waiting") && (
                  <>
                    {row.flow.verificationUrl ? (
                      <p className={styles.flowLine}>
                        Open{" "}
                        <a href={row.flow.verificationUrl} target="_blank" rel="noreferrer">
                          {row.flow.verificationUrl}
                        </a>{" "}
                        and sign in.
                      </p>
                    ) : (
                      <p className={styles.flowLine}>Starting sign-in…</p>
                    )}
                    {row.flow.code && (
                      <p className={styles.flowLine}>
                        Enter this code: <span className={styles.code}>{row.flow.code}</span>
                      </p>
                    )}
                    {!row.flow.verificationUrl &&
                      row.flow.lines.map((line, i) => (
                        <p key={i} className={styles.flowLineRaw}>
                          {line}
                        </p>
                      ))}
                    <p className={styles.flowWaiting}>Waiting for you to finish in the browser…</p>
                    <Button variant="ghost" size="sm" onClick={() => void handleCancel(id, row.flow!.flowId)}>
                      Cancel
                    </Button>
                  </>
                )}
                {row.flow.status === "success" && (
                  <p className={styles.statusOk}>Signed in.</p>
                )}
                {(row.flow.status === "error" || row.flow.status === "cancelled") && (
                  <>
                    <p className={styles.statusError}>
                      {row.flow.status === "cancelled" ? "Cancelled." : row.flow.message ?? "Sign-in failed."}
                    </p>
                    <Button variant="outline" size="sm" onClick={() => void handleDismiss(id)}>
                      Dismiss
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
