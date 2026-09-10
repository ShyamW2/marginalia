import { utilityProcess, type UtilityProcess } from "electron";

/**
 * M45 (DESKTOP.md §3): Express runs in a `utilityProcess`, not in main, so a
 * `better-sqlite3` ABI fault kills a child the main process can report on
 * rather than the window. The server logs its resolved port to stdout
 * exactly as it does under `pnpm dev` and M44's launcher
 * (`scripts/launch-preview.mjs`) — this just watches for the same line
 * instead of a person reading a terminal.
 */

const PORT_LOG_RE = /listening on http:\/\/localhost:(\d+)/;

export interface ServerHandle {
  process: UtilityProcess;
  port: number;
}

/**
 * Thrown when the server exits before ever reporting a port. `stderr` carries
 * whatever it wrote — which, for the one fatal startup path this app knows
 * about, is `startupDiagnosis.ts`'s formatted instruction (M22.6 F). This
 * class exists only to carry that text to the caller; it does not
 * reinterpret it — surfacing it in a dialog is M45's job, rewriting it isn't.
 */
export class ServerStartupError extends Error {
  readonly stderr: string;
  readonly exitCode: number | null;
  constructor(stderr: string, exitCode: number | null) {
    super(stderr.trim() || `server exited with code ${exitCode ?? "unknown"} before starting`);
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

/**
 * Forks `serverEntry` (the built `server/dist/index.js`) as a utility
 * process and resolves once it reports the port it bound, or rejects with a
 * `ServerStartupError` if it exits first. `env` is the caller's to build —
 * see `main.ts` for what it adds (`MARGINALIA_RESOURCES_PATH`,
 * `MARGINALIA_SOFTWARE_RENDERING`) on top of a pass-through of its own
 * `process.env`, which is deliberately *not* touched here: a GUI launch's
 * bare `PATH` is exactly the condition `cliPath.ts`'s login-shell fallback
 * exists for (DESKTOP.md §3.5), and "fixing" it in main before the fork
 * would mean that path never actually runs.
 */
export function startServer(
  serverEntry: string,
  env: NodeJS.ProcessEnv,
  onLog: (line: string, stream: "stdout" | "stderr") => void = () => {},
): Promise<ServerHandle> {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(serverEntry, [], {
      env,
      stdio: "pipe",
    });

    let settled = false;
    let stderrBuf = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      onLog(text, "stdout");
      if (settled) return;
      const match = PORT_LOG_RE.exec(text);
      if (match) {
        settled = true;
        resolve({ process: child, port: Number(match[1]) });
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      onLog(text, "stderr");
      stderrBuf += text;
    });

    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      reject(new ServerStartupError(stderrBuf, code));
    });
  });
}
