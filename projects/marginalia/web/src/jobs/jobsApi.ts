import { JobSchema, StartJobResponseSchema, type Job } from "@marginalia/shared";

export async function fetchJobs(): Promise<Job[]> {
  try {
    const res = await fetch("/api/jobs");
    if (!res.ok) return [];
    const body: unknown = await res.json();
    if (!Array.isArray(body)) return [];
    return body
      .map((raw) => JobSchema.safeParse(raw))
      .filter((parsed): parsed is { success: true; data: Job } => parsed.success)
      .map((parsed) => parsed.data);
  } catch {
    return [];
  }
}

/** POSTs to a job-starting endpoint (digest/thematic/theme-tagging) and
 * returns the new job id — the caller hands it straight to
 * `JobsContext.registerStarted` rather than waiting on any actual work. */
export async function startJobRequest(url: string, body?: unknown): Promise<{ jobId: string } | { error: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) {
      const parsedBody = (await res.json().catch(() => ({}))) as { error?: string };
      return { error: parsedBody.error ?? "request_failed" };
    }
    const parsed = StartJobResponseSchema.safeParse(await res.json());
    return parsed.success ? { jobId: parsed.data.jobId } : { error: "invalid_response" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "network_error" };
  }
}

export async function requestCancelJob(id: string): Promise<void> {
  try {
    await fetch(`/api/jobs/${id}/cancel`, { method: "POST" });
  } catch {
    // best-effort — a lost cancel request just means the job runs to
    // completion; the tray keeps offering cancel since it's still running
  }
}

const RECONNECT_MIN_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 10000;

/** Shared by `subscribeJobEvents` and `subscribeAllJobEvents` — both just
 * read a `Job` off each SSE frame's `data:` line and hand it to `onUpdate`;
 * neither cares about the `event:` line, since `onUpdate` already handles
 * both "created" and "updated" identically (upserting into a map). Returns
 * an unsubscribe function that closes *this client's* connection only —
 * never the job(s) themselves.
 *
 * Unlike native `EventSource`, a hand-rolled `fetch()` stream doesn't
 * reconnect on its own when the connection drops — and a long-idle chunked
 * stream can be dropped silently (observed on Safari/WebKit) with no error
 * ever surfacing. So a stream ending for any reason other than our own
 * `unsubscribe()` triggers a reconnect with backoff, rather than leaving the
 * caller stuck on a stale snapshot. */
function subscribeSse(url: string, onUpdate: (job: Job) => void): () => void {
  const controller = new AbortController();
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = RECONNECT_MIN_DELAY_MS;

  async function connect(): Promise<void> {
    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } catch {
      scheduleReconnect();
      return;
    }
    if (controller.signal.aborted) return;
    if (!response.ok || !response.body) {
      scheduleReconnect();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          // A bare heartbeat frame (`: heartbeat`) has no `data:` line and is
          // otherwise ignored — its only job is to prove the connection is
          // still alive, which reaching this point at all already does.
          const dataLine = rawEvent.split("\n").find((line) => line.startsWith("data:"));
          if (!dataLine) continue;
          const jsonText = dataLine.slice(5).trim();
          if (!jsonText) continue;
          try {
            const parsed = JobSchema.safeParse(JSON.parse(jsonText));
            if (parsed.success) {
              onUpdate(parsed.data);
              retryDelay = RECONNECT_MIN_DELAY_MS; // a good frame resets backoff
            }
          } catch {
            // malformed event — skip it, keep reading
          }
        }
      }
    } catch {
      // aborted (our own unsubscribe) or connection lost — fall through to
      // the reconnect check below either way
    }

    if (!controller.signal.aborted) scheduleReconnect();
  }

  function scheduleReconnect(): void {
    if (controller.signal.aborted) return;
    retryTimer = setTimeout(() => {
      retryDelay = Math.min(retryDelay * 2, RECONNECT_MAX_DELAY_MS);
      void connect();
    }, retryDelay);
  }

  void connect();

  return () => {
    controller.abort();
    if (retryTimer !== null) clearTimeout(retryTimer);
  };
}

/**
 * Subscribes to one job's SSE progress stream (M20.6). The server ends the
 * stream on its own once the job reaches a terminal state; this is what
 * lets a reconnect after a reload pick up a still-running job's progress
 * exactly where the registry has it.
 */
export function subscribeJobEvents(id: string, onUpdate: (job: Job) => void): () => void {
  return subscribeSse(`/api/jobs/${id}/events`, onUpdate);
}

/**
 * Subscribes to every job's creation and progress, registry-wide (M22.5,
 * decisions.md 2026-08-04 "the tray is live for jobs it did not start") —
 * what lets the tray show a job started by another tab, or one a subsystem
 * (`usePlayer`) subscribed to directly without ever calling
 * `registerStarted`. This stream never closes on its own; the caller's
 * unsubscribe is the only way it ends.
 */
export function subscribeAllJobEvents(onUpdate: (job: Job) => void): () => void {
  return subscribeSse("/api/jobs/events", onUpdate);
}
