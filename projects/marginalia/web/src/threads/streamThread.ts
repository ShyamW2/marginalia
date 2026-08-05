import {
  ThreadStreamEventSchema,
  type ContextLadderDepth,
  type ContextUsage,
  type MessageProvenance,
} from "@marginalia/shared";

export interface ThreadStreamHandlers {
  onText: (text: string) => void;
  onDone: (
    messageId: string,
    threadId: string,
    contextNote: string | null,
    contextUsage: ContextUsage | null,
    contextDepth: ContextLadderDepth,
    contextChapters: number[],
    provenance: MessageProvenance | null,
  ) => void;
  onError: (message: string) => void;
}

/**
 * POSTs to a thread SSE endpoint and dispatches the SPEC event contract
 * (`{text}` / `{done, messageId}` / `{error}`) to the given handlers.
 * `signal` doubles as the stop-button abort and the unmount cleanup — an
 * abort during read is treated as a silent stop, not an error.
 */
export async function streamThread(
  url: string,
  body: unknown,
  handlers: ThreadStreamHandlers,
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

function dispatchEvent(rawEvent: string, handlers: ThreadStreamHandlers): void {
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

  const event = ThreadStreamEventSchema.safeParse(parsed);
  if (!event.success) return;

  if ("text" in event.data) handlers.onText(event.data.text);
  else if ("done" in event.data) {
    handlers.onDone(
      event.data.messageId,
      event.data.threadId,
      event.data.contextNote,
      event.data.contextUsage,
      event.data.contextDepth,
      event.data.contextChapters,
      event.data.provenance,
    );
  } else if ("error" in event.data) handlers.onError(event.data.error);
}
