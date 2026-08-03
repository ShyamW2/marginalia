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

/**
 * Subscribes to one job's SSE progress stream (M20.6). Returns an
 * unsubscribe function that closes *this client's* connection only —
 * never the job itself. The server ends the stream on its own once the job
 * reaches a terminal state; this is what lets a reconnect after a reload
 * pick up a still-running job's progress exactly where the registry has it.
 */
export function subscribeJobEvents(id: string, onUpdate: (job: Job) => void): () => void {
  const controller = new AbortController();

  (async () => {
    let response: Response;
    try {
      response = await fetch(`/api/jobs/${id}/events`, { signal: controller.signal });
    } catch {
      return;
    }
    if (!response.ok || !response.body) return;

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
          const dataLine = rawEvent.split("\n").find((line) => line.startsWith("data:"));
          if (!dataLine) continue;
          const jsonText = dataLine.slice(5).trim();
          if (!jsonText) continue;
          try {
            const parsed = JobSchema.safeParse(JSON.parse(jsonText));
            if (parsed.success) onUpdate(parsed.data);
          } catch {
            // malformed event — skip it, keep reading
          }
        }
      }
    } catch {
      // aborted (our own unsubscribe) or connection lost — nothing to do
    }
  })();

  return () => controller.abort();
}
