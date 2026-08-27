import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod/v4";
import {
  LLMError,
  type LLMExtractRequest,
  type LLMProvider,
  type LLMStreamRequest,
  type ReportedUsage,
} from "./provider.js";
import { renderTranscript } from "./claudeAgent.js";
import { resolveCliBin } from "./cliPath.js";

/**
 * Codex CLI provider (decisions.md 2026-07-30 "a fourth provider, and a
 * caged one"; event shape verified live 2026-08-25, NOTES.md "M26 —
 * `codex exec --json`'s real event shape"). Routes through the `codex`
 * CLI's non-interactive `exec` subcommand, authenticated by the machine's
 * `codex login` (ChatGPT subscription — no API key).
 *
 * **Caged, and the cage is part of the provider, not its configuration**
 * (settled decision 2's bound): `codex exec` is a shell-running agent with
 * no `tools: []` equivalent, so every call runs `--sandbox read-only`,
 * `--ephemeral`, `--skip-git-repo-check`, and `-C` pointed at a dedicated
 * scratch directory — never this repo, never `data/`. There is no
 * `-a/--ask-for-approval` flag on `exec` (that belongs to the interactive
 * `codex` command only, confirmed live — omitted rather than passed and
 * rejected) and there is nothing to approve *to* in a non-interactive spawn
 * anyway.
 */
export class CodexCliProvider implements LLMProvider {
  readonly id = "codex-cli" as const;
  private readonly model: string;
  private readonly maxResponseTokens?: number;
  private lastUsage: ReportedUsage | null = null;

  constructor(model: string, maxResponseTokens?: number) {
    this.model = model;
    this.maxResponseTokens = maxResponseTokens;
  }

  capabilities(): { contextTokens: number; supportsCaching: boolean } {
    // 272K, read live off the models endpoint for gpt-5.4 during the
    // 2026-08-25 verification (NOTES.md) — the one number this project has
    // actually confirmed rather than assumed. No per-provider table (the
    // Anthropic one exists because pricing needs a per-model number; this
    // provider has no pricing to look up, only a context window, and one
    // measured figure beats a guessed table for models never verified live.
    return { contextTokens: 272_000, supportsCaching: false };
  }

  reportedUsage(): ReportedUsage | null {
    return this.lastUsage;
  }

  async *stream(req: LLMStreamRequest): AsyncIterable<{ text: string }> {
    const prompt = `${req.instructions}${lengthInstruction(this.maxResponseTokens)}\n\n${req.bookContext}\n\n${renderTranscript(req.messages)}`;
    const { events } = await runExec({ model: this.model, prompt, signal: req.signal });
    this.lastUsage = usageFromEvents(events);
    const text = lastAgentMessage(events);
    if (text === null) throw mapCodexEvents(events);
    yield { text };
  }

  async extract<T>(req: LLMExtractRequest<T>): Promise<T> {
    return this.extractAttempt(req, 0);
  }

  private async extractAttempt<T>(req: LLMExtractRequest<T>, attempt: number): Promise<T> {
    const schema = toDraft7JsonSchema(req.schema as z.ZodType<unknown>);
    const prompt = `${req.instructions}\n\n${req.input}`;
    const { events } = await runExec({ model: this.model, prompt, signal: req.signal, outputSchema: schema });
    this.lastUsage = usageFromEvents(events);
    const text = lastAgentMessage(events);
    if (text === null) throw mapCodexEvents(events);

    let structured: unknown;
    try {
      structured = JSON.parse(text);
    } catch {
      structured = undefined;
    }

    const parsed = req.schema.safeParse(structured);
    if (parsed.success) return parsed.data;

    if (attempt === 0) {
      return this.extractAttempt(
        {
          ...req,
          input: `${req.input}\n\nYour previous output failed schema validation: ${parsed.error.message}\nReturn valid JSON matching the schema.`,
        },
        1,
      );
    }
    throw new LLMError("extract_parse_failed");
  }
}

/**
 * The dedicated caged working root (settled decision 2's bound: never the
 * repo, never `data/`). Two independent live-verified constraints shaped
 * this path (NOTES.md "M26"), both specific to this machine's `codex` being
 * a **snap package** (`/snap/bin/codex` — `snap connections codex` shows a
 * confined `home` plug):
 *
 * 1. Not `os.tmpdir()` — `codex exec -C <dir>` (and `--output-schema
 *    <file>`) fail `ENOENT` for anything under `/tmp` on this machine.
 *    `/tmp` is tmpfs here; snap's confinement remaps a strict snap's `/tmp`
 *    to a private namespace, so a path this process creates in the real
 *    `/tmp` doesn't exist from the snap's point of view.
 * 2. **Not a dot-directory anywhere in the path** — snap's `home` interface
 *    denies access to hidden files/directories under `$HOME` by policy.
 *    The first cut of this scratch dir was `~/.marginalia/codex-scratch`
 *    and failed `Permission denied (os error 13)` reading a schema file
 *    from inside it — confirmed live to be the leading dot specifically
 *    (an otherwise-identical non-hidden directory worked immediately).
 *
 * A plain, visible directory under the home tree satisfies both.
 */
export function scratchDir(): string {
  const dir = join(homedir(), "marginalia-codex-scratch");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * A soft, prose-only stand-in for the `max_tokens` param this provider has
 * no equivalent for — same caveat as claudeAgent.ts's `lengthInstruction`
 * (decisions.md 2026-07-28 later, extended to `codex-cli` 2026-08-14): a
 * request in the prompt, never an enforced ceiling.
 */
function lengthInstruction(maxResponseTokens?: number): string {
  if (!maxResponseTokens) return "";
  const words = Math.round(maxResponseTokens * 0.75);
  return `\n\nKeep your response under approximately ${maxResponseTokens} tokens (roughly ${words} words). This is a soft target you should aim for, not an enforced limit.`;
}

/** Exported for tests. Same rationale as claudeAgent.ts's `toAgentJsonSchema`
 * — codex's `--output-schema` validates draft-07, zod v4's default 2020-12
 * `$schema` marker isn't that. */
export function toDraft7JsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

interface CodexEvent {
  type: string;
  [key: string]: unknown;
}

/** Exported for tests. `codex exec --json`'s stdout is JSONL — one event
 * per line, verified live to carry no other noise on stdout (the CLI's own
 * log spam, e.g. a models-refresh warning this account's build always
 * prints, lands on stderr — NOTES.md "M26"). A line that fails to parse is
 * dropped rather than thrown on: defensive against a stray blank line or a
 * CLI version that adds trailing output this provider hasn't seen. */
export function parseCodexEvents(stdout: string): CodexEvent[] {
  const events: CodexEvent[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object" && typeof (parsed as CodexEvent).type === "string") {
        events.push(parsed as CodexEvent);
      }
    } catch {
      // not a JSON line — dropped, see above.
    }
  }
  return events;
}

/** Exported for tests. Verified live 2026-08-25 (NOTES.md "M26"): a turn
 * with no tool-use attempt emits exactly one `agent_message`; a turn where
 * the model tries something the sandbox then blocks can emit more than one
 * (narration, then the real answer). The CLI's own `-o/--output-last-message`
 * flag names the resolving convention — the *last* `agent_message` before
 * `turn.completed` is the answer — so this takes the last, never the first
 * and never a concatenation (concatenating would prepend tool-use narration
 * to real answers on any turn the model even attempts something blocked). */
export function lastAgentMessage(events: CodexEvent[]): string | null {
  let text: string | null = null;
  for (const event of events) {
    if (event.type !== "item.completed") continue;
    const item = event.item as { type?: string; text?: string } | undefined;
    if (item?.type === "agent_message" && typeof item.text === "string") {
      text = item.text;
    }
  }
  return text;
}

/** Exported for tests. `turn.completed`'s usage block, verified live
 * 2026-08-25: `input_tokens`/`cached_input_tokens`/`output_tokens`, no
 * `cost_usd` — this CLI never reports a dollar figure (unlike the Claude
 * Agent SDK's `total_cost_usd`), so `costUsd` is always omitted here and
 * `pricing.ts` prices `codex-cli` the same way it prices `claude-agent`:
 * `notional`, because a ChatGPT-subscription call is never billed
 * per-token regardless of whether the CLI can name a number for it. */
export function usageFromEvents(events: CodexEvent[]): ReportedUsage | null {
  for (const event of events) {
    if (event.type !== "turn.completed") continue;
    const usage = event.usage as
      | { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number }
      | undefined;
    if (!usage) continue;
    return {
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheReadTokens: usage.cached_input_tokens,
    };
  }
  return null;
}

/** `turn.failed`'s `error.message` when present (the shape verified live
 * for an unsupported-model 400); otherwise a generic "no answer" — a turn
 * can in principle complete with zero `agent_message` items (e.g. the model
 * only ran denied tool calls and said nothing), which is a designed
 * `LLMError`, not a crash, same acceptance line as a killed process. */
function mapCodexEvents(events: CodexEvent[]): LLMError {
  for (const event of events) {
    if (event.type !== "turn.failed") continue;
    const error = event.error as { message?: string } | undefined;
    return mapCodexErrorMessage(error?.message ?? "turn.failed");
  }
  return new LLMError("unknown", "Codex CLI produced no answer.");
}

/** Exported for tests. Message-text classification — `codex exec` surfaces
 * failures as `turn.failed.error.message` strings or a spawn-level Error,
 * not typed exceptions, same convention claudeAgent.ts's `mapAgentError`
 * uses for the Agent SDK's equally untyped failures. */
export function mapCodexErrorMessage(message: string): LLMError {
  if (/not logged in|log ?in|logged out|authenticat|401|unauthorized/i.test(message)) {
    return new LLMError("auth", `Codex subscription login not available: ${message}. Run \`codex login\`.`);
  }
  if (/rate ?limit|usage limit|out of (credits|usage)|429/i.test(message)) {
    return new LLMError("rate_limit", message);
  }
  if (/context.*(exceed|too large|too long)|too many tokens/i.test(message)) {
    return new LLMError("context_too_large", message);
  }
  if (/ENOENT|ECONNREFUSED|network|fetch failed|disconnected/i.test(message)) {
    return new LLMError("network", message);
  }
  return new LLMError("unknown", message);
}

interface RunExecOptions {
  model: string;
  prompt: string;
  signal?: AbortSignal;
  outputSchema?: Record<string, unknown>;
}

interface RunExecResult {
  events: CodexEvent[];
}

/**
 * Spawns one `codex exec --json` call and collects its stdout to completion
 * — `--json` is whole-item JSONL, not token deltas (verified live, NOTES.md
 * "M26"), so there is nothing to stream incrementally regardless of what
 * `LLMStreamRequest.stream()`'s `AsyncIterable` return type might suggest.
 *
 * `signal` aborts by killing the child (SIGTERM, escalating to SIGKILL if
 * it doesn't exit) rather than leaving it to run to completion unread — the
 * M20.6 job registry threads this through so a cancelled digest job's Codex
 * call actually stops, not just the next one queued behind it.
 */
function runExec(opts: RunExecOptions): Promise<RunExecResult> {
  return new Promise((resolve, reject) => {
    const scratch = scratchDir();
    let schemaFile: string | null = null;
    const args = [
      "exec",
      "--json",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--ephemeral",
      "-C",
      scratch,
      "-m",
      opts.model,
    ];
    if (opts.outputSchema) {
      schemaFile = join(scratch, `schema-${randomUUID()}.json`);
      writeFileSync(schemaFile, JSON.stringify(opts.outputSchema));
      args.push("--output-schema", schemaFile);
    }
    // `-` reads the prompt from stdin instead of argv — argv has an OS
    // length limit this app's whole-book prompts (settled decision 8) can
    // exceed; stdin doesn't.
    args.push("-");

    const child = spawn(resolveCliBin("codex"), args, {
      cwd: scratch,
      // Scrubbed the way claudeAgent.ts scrubs ANTHROPIC_API_KEY, same
      // reason: an inherited OPENAI_API_KEY would silently switch this
      // call from the ChatGPT subscription to pay-per-token API billing.
      env: { ...process.env, OPENAI_API_KEY: undefined },
    });

    let stdout = "";
    let stderrTail = "";
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;

    function onAbort(): void {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
    }
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    if (opts.signal?.aborted) onAbort();

    function finish(fn: () => void): void {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      opts.signal?.removeEventListener("abort", onAbort);
      if (schemaFile) cleanupScratchFile(schemaFile);
      fn();
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString("utf8")).slice(-2000);
    });

    child.on("error", (err) => {
      finish(() => reject(mapCodexErrorMessage(err.message)));
    });

    child.on("exit", (code) => {
      finish(() => {
        const events = parseCodexEvents(stdout);
        if (opts.signal?.aborted) {
          reject(new LLMError("unknown", "Cancelled."));
          return;
        }
        if (code !== 0 && events.every((e) => e.type !== "turn.failed")) {
          reject(mapCodexErrorMessage(stderrTail.trim() || `codex exec exited with code ${code}`));
          return;
        }
        resolve({ events });
      });
    });

    child.stdin?.write(opts.prompt);
    child.stdin?.end();
  });
}

function cleanupScratchFile(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // best-effort — a leftover schema file in the scratch dir costs nothing.
  }
}
