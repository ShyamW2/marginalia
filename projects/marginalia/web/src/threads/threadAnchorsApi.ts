import type { ThreadAnchor } from "@marginalia/shared";

/** M35 §D4: fetched once per opened panel on a thread that has one (not
 * bundled onto every highlight in the resource's list) — see the server
 * route's own comment (routes/threads.ts). */
export async function fetchThreadAnchors(threadId: string): Promise<ThreadAnchor[] | null> {
  try {
    const res = await fetch(`/api/threads/${threadId}/anchors`);
    if (!res.ok) return null;
    const body = (await res.json()) as { anchors: ThreadAnchor[] };
    return body.anchors;
  } catch {
    return null;
  }
}
