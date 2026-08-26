import { DefineStreamEventSchema, type Definition } from "@marginalia/shared";

export interface DefineStreamHandlers {
  /** A real stage of work as it happens — "Searching…", "Reading context
   * around N occurrences…", "Asking <model> for a definition…" — never a
   * fabricated chain-of-thought (see dictionary/define.ts's comment). */
  onStep: (step: string) => void;
  /** The answer composing live, chunk by chunk. */
  onText: (text: string) => void;
  onDone: (definition: Definition) => void;
  onError: (message: string) => void;
}

/**
 * POSTs to the M30 E feedback "look deeper" SSE endpoint and dispatches the
 * `DefineStreamEvent` contract to the given handlers — same shape and same
 * dispatch loop as `threads/streamThread.ts`, one file per stream rather
 * than a shared generic: the two event unions differ enough (`step`, no
 * `messageId`/`threadId`) that a shared parser would need its own
 * discriminated-union gymnastics for no real reuse.
 */
export async function streamDefine(
  url: string,
  body: unknown,
  handlers: DefineStreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    if (signal.aborted) return;
    handlers.onError("Couldn't reach the server.");
    return;
  }

  if (!response.ok) {
    let message = "Something went wrong.";
    try {
      const parsed = (await response.json()) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      // non-JSON error body — keep the generic message
    }
    handlers.onError(message);
    return;
  }
  if (!response.body) {
    handlers.onError("Empty response from the server.");
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
        dispatchEvent(rawEvent, handlers);
      }
    }
  } catch {
    if (signal.aborted) return;
    handlers.onError("Connection lost.");
  }
}

function dispatchEvent(rawEvent: string, handlers: DefineStreamHandlers): void {
  const dataLine = rawEvent.split("\n").find((line) => line.startsWith("data:"));
  if (!dataLine) return;
  const jsonText = dataLine.slice(5).trim();
  if (!jsonText) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return;
  }

  const event = DefineStreamEventSchema.safeParse(parsed);
  if (!event.success) return;

  if ("step" in event.data) handlers.onStep(event.data.step);
  else if ("text" in event.data) handlers.onText(event.data.text);
  else if ("done" in event.data) handlers.onDone(event.data.definition);
  else if ("error" in event.data) handlers.onError(event.data.error);
}
