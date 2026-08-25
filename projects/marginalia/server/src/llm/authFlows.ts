import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { ProviderAuthFlowState, ProviderAuthProvider, ProviderAuthStatus } from "@marginalia/shared";

/**
 * M26 lead-in (decisions.md 2026-08-25): an in-app "Sign in" flow spawns the
 * same CLI login command an operator would otherwise run in a terminal
 * (`codex login --device-auth`, `claude auth login`) and streams its output
 * back rather than reimplementing OAuth. Credentials land wherever that CLI
 * already keeps them (`~/.codex/`, `~/.claude/`) — nothing new to secure or
 * gitignore here, that's the whole point of shelling out to the real thing.
 *
 * Device-code auth (Codex) is the shape verified live on 2026-08-25 (see
 * NOTES.md): the CLI prints a verification URL and a short code, then blocks
 * polling until the user finishes in *any* browser — no local callback
 * server, which is what makes it work for the two-machine setup (the
 * server's machine and the browser's machine can differ). `claude auth
 * login`'s exact stdout shape was deliberately never smoke-tested here —
 * this machine's Claude Code login was live and working, and testing it
 * risked clobbering those working credentials — so its parsing is the same
 * generic best-effort regexes as Codex, with the raw lines always kept as a
 * fallback the UI can render verbatim if nothing matches.
 */

const CLI = {
  codex: { bin: "codex", loginArgs: ["login", "--device-auth"], statusArgs: ["login", "status"], logoutArgs: ["logout"] },
  claude: { bin: "claude", loginArgs: ["auth", "login"], statusArgs: ["auth", "status"], logoutArgs: ["auth", "logout"] },
} as const;

// Codex's own device code expires in 15 minutes (verified live); give a
// couple of minutes of slack for a slow polling client before giving up.
const FLOW_TIMEOUT_MS = 17 * 60 * 1000;
// Terminal flows stay queryable for a while so a client's last poll still
// sees the result, then get swept so the map doesn't grow unbounded across a
// long-running server.
const FLOW_RETENTION_MS = 5 * 60 * 1000;
const STATUS_CHECK_TIMEOUT_MS = 10_000;

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;
const URL_RE = /https?:\/\/\S+/;
const CODE_RE = /\b[A-Z0-9]{4,}-[A-Z0-9]{4,}\b/;

// Defensive (decisions.md 2026-08-25): `codex login --device-auth`'s stdout
// was verified live to print only the banner, the URL and the one-time code
// — never a credential. `claude auth login`'s was deliberately never
// smoke-tested (see that entry). `lines` is served verbatim over an
// unauthenticated local API for the UI's raw-text fallback, so if any CLI
// this ever grows to support *does* print a real token, this is what stands
// between that and the browser. Two passes: a name-based one for an
// obviously-labelled secret ("access_token: ...") that redacts the whole
// line since the label alone is already worth hiding, and a shape-based one
// for a long opaque blob that survived the first pass. The device code
// (10 chars, e.g. "B5D1-XQI8F") and the URL (broken up by `.`/`/`) are both
// well clear of the length/shape this targets.
const SECRET_KEY_RE = /\b(access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|client[_-]?secret|secret|password|bearer)\b/i;
const SECRET_BLOB_RE = /[A-Za-z0-9_-]{24,}/g;

/** Exported for tests. */
export function redactSecrets(line: string): string {
  if (SECRET_KEY_RE.test(line)) return "[redacted — line mentioned a credential]";
  return line.replace(SECRET_BLOB_RE, (match) => `${match.slice(0, 4)}…[redacted]`);
}

/** Exported for tests — a device-code CLI's stdout arrives with ANSI colour
 * codes in a real terminal-facing build; stripped so the UI never renders
 * escape sequences as text. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

/** Exported for tests. Blank lines are separators in the CLIs' own output
 * (verified live against Codex's device-auth prompt), not content worth
 * keeping — dropped so the UI can render `lines` as a plain list. Redaction
 * runs here, before a line is ever kept on a flow or returned by the API —
 * everything downstream (including `extractVerification`) sees only the
 * redacted form. */
export function linesFrom(buffer: string): string[] {
  return buffer
    .split("\n")
    .map((line) => redactSecrets(stripAnsi(line).trim()))
    .filter((line) => line.length > 0);
}

/** Exported for tests. Best-effort: a verification URL and/or short code,
 * pulled from whichever line first contains one — the generic shape a
 * device-code login prints, not something specific to one CLI's exact
 * wording. Returns null for whichever it doesn't find, never throws. */
export function extractVerification(lines: string[]): { verificationUrl: string | null; code: string | null } {
  let verificationUrl: string | null = null;
  let code: string | null = null;
  for (const line of lines) {
    if (!verificationUrl) verificationUrl = line.match(URL_RE)?.[0] ?? null;
    if (!code) code = line.match(CODE_RE)?.[0] ?? null;
  }
  return { verificationUrl, code };
}

interface Flow {
  id: string;
  provider: ProviderAuthProvider;
  status: ProviderAuthFlowState["status"];
  verificationUrl: string | null;
  code: string | null;
  lines: string[];
  message: string | null;
  child: ReturnType<typeof spawn>;
  createdAt: number;
  finishedAt: number | null;
}

const flows = new Map<string, Flow>();

function sweepExpired(): void {
  const now = Date.now();
  for (const [id, flow] of flows) {
    const terminal = flow.status === "success" || flow.status === "error" || flow.status === "cancelled";
    if (terminal && flow.finishedAt !== null && now - flow.finishedAt > FLOW_RETENTION_MS) {
      flows.delete(id);
    }
  }
}

function toState(flow: Flow): ProviderAuthFlowState {
  return {
    flowId: flow.id,
    status: flow.status,
    verificationUrl: flow.verificationUrl,
    code: flow.code,
    lines: flow.lines,
    message: flow.message,
  };
}

function finish(flow: Flow, status: "success" | "error" | "cancelled", message: string | null): void {
  if (flow.finishedAt !== null) return; // already finished — a late exit/timeout race, ignore
  flow.status = status;
  flow.message = message;
  flow.finishedAt = Date.now();
}

/** Starts a login flow for `provider`, or returns the already-running one —
 * never two concurrent CLI login processes for the same provider. */
export function startAuthFlow(provider: ProviderAuthProvider): ProviderAuthFlowState {
  sweepExpired();
  for (const flow of flows.values()) {
    if (flow.provider === provider && flow.finishedAt === null) return toState(flow);
  }

  const cmd = CLI[provider];
  const child = spawn(cmd.bin, cmd.loginArgs);
  const flow: Flow = {
    id: randomUUID(),
    provider,
    status: "starting",
    verificationUrl: null,
    code: null,
    lines: [],
    message: null,
    child,
    createdAt: Date.now(),
    finishedAt: null,
  };
  flows.set(flow.id, flow);

  let stdoutBuffer = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString("utf8");
    flow.lines = linesFrom(stdoutBuffer);
    if (flow.status === "starting" && flow.lines.length > 0) flow.status = "waiting";
    const found = extractVerification(flow.lines);
    flow.verificationUrl ??= found.verificationUrl;
    flow.code ??= found.code;
  });

  let stderrTail = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString("utf8")).slice(-2000);
  });

  child.on("error", (err) => {
    finish(flow, "error", `Couldn't start \`${cmd.bin}\`: ${err.message}`);
  });

  child.on("exit", (code) => {
    if (code === 0) {
      finish(flow, "success", null);
    } else {
      const tail = stripAnsi(stderrTail).trim();
      finish(flow, "error", tail || `\`${cmd.bin} ${cmd.loginArgs.join(" ")}\` exited with code ${code}`);
    }
  });

  const timeout = setTimeout(() => {
    if (flow.finishedAt === null) {
      child.kill();
      finish(flow, "error", "Timed out waiting for sign-in — the verification code likely expired. Try again.");
    }
  }, FLOW_TIMEOUT_MS);
  child.on("exit", () => clearTimeout(timeout));

  return toState(flow);
}

export function getAuthFlow(flowId: string): ProviderAuthFlowState | null {
  const flow = flows.get(flowId);
  return flow ? toState(flow) : null;
}

/** Kills the CLI process if it's still running — the user closed the dialog
 * or gave up. Idempotent. */
export function cancelAuthFlow(flowId: string): boolean {
  const flow = flows.get(flowId);
  if (!flow) return false;
  if (flow.finishedAt === null) {
    flow.child.kill();
    finish(flow, "cancelled", null);
  }
  return true;
}

/** Runs a short-lived CLI subcommand to completion and collects its stdout —
 * shared by the status check and the logout action, neither of which streams. */
function runToCompletion(
  bin: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args);
    let stdout = "";
    const timeout = setTimeout(() => {
      child.kill();
      resolve({ code: null, stdout });
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", () => {
      clearTimeout(timeout);
      resolve({ code: null, stdout });
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout });
    });
  });
}

/** Read-only — never mutates credentials. Fails closed to "not logged in"
 * rather than throwing, the same convention `planLimits()` uses elsewhere in
 * this layer: an auth check that can't complete is not proof of anything. */
export async function checkAuthStatus(provider: ProviderAuthProvider): Promise<ProviderAuthStatus> {
  const cmd = CLI[provider];
  const { code, stdout } = await runToCompletion(cmd.bin, cmd.statusArgs, STATUS_CHECK_TIMEOUT_MS);
  const text = stripAnsi(stdout).trim();

  if (provider === "claude") {
    try {
      const parsed = JSON.parse(text) as {
        loggedIn?: boolean;
        email?: string;
        subscriptionType?: string;
      };
      if (typeof parsed.loggedIn !== "boolean") return { provider, loggedIn: false, detail: null };
      const detail =
        parsed.loggedIn && parsed.email
          ? `${parsed.email}${parsed.subscriptionType ? ` (${parsed.subscriptionType})` : ""}`
          : null;
      return { provider, loggedIn: parsed.loggedIn, detail };
    } catch {
      return { provider, loggedIn: false, detail: null };
    }
  }

  // codex: no --json on `login status` (checked --help, 0.114.0) — plain
  // text, "Not logged in" being the one shape confirmed live.
  const loggedIn = code === 0 && text.length > 0 && !/not logged in/i.test(text);
  const firstLine = text.split("\n")[0]?.trim();
  return { provider, loggedIn, detail: loggedIn && firstLine ? firstLine : null };
}

export async function logout(provider: ProviderAuthProvider): Promise<void> {
  const cmd = CLI[provider];
  await runToCompletion(cmd.bin, cmd.logoutArgs, STATUS_CHECK_TIMEOUT_MS);
}
