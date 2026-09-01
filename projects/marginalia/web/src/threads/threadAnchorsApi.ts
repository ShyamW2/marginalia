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

export type AddThreadAnchorResult =
  | { ok: true }
  | { ok: false; error: "already_anchored" | "cross_resource" | "not_found" | "unknown" };

/** M35 §G3: links `highlightId` to `threadId` as an additional anchor. A
 * highlight already anchoring a *different* thread comes back as
 * `"already_anchored"` — the ground rule (a highlight may join a thread, a
 * thread may never join a thread) is enforced server-side; this just names
 * the refusal for the UI to show. Linking a highlight that already anchors
 * *this* thread is treated as success (the server itself no-ops it). */
export async function addThreadAnchor(threadId: string, highlightId: string): Promise<AddThreadAnchorResult> {
  try {
    const res = await fetch(`/api/threads/${threadId}/anchors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ highlightId }),
    });
    if (res.ok) return { ok: true };
    if (res.status === 409) return { ok: false, error: "already_anchored" };
    if (res.status === 400) return { ok: false, error: "cross_resource" };
    if (res.status === 404) return { ok: false, error: "not_found" };
    return { ok: false, error: "unknown" };
  } catch {
    return { ok: false, error: "unknown" };
  }
}
