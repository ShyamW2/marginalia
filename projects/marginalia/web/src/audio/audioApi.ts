import {
  AudioSectionManifestSchema,
  AudioSectionsResponseSchema,
  AudioStateSchema,
  BookCastMemberSchema,
  BookCastResponseSchema,
  type AudioSectionManifest,
  type AudioSectionsResponse,
  type AudioState,
  type BookCastMember,
  type BookCastResponse,
  type UpdateAudioStateBody,
  type Voice,
} from "@marginalia/shared";

export async function fetchVoices(): Promise<Voice[]> {
  try {
    const res = await fetch("/api/audio/voices");
    if (!res.ok) return [];
    return (await res.json()) as Voice[];
  } catch {
    return [];
  }
}

export async function fetchAudioState(resourceId: string): Promise<AudioState | null> {
  try {
    const res = await fetch(`/api/resources/${resourceId}/audio`);
    if (!res.ok) return null;
    const parsed = AudioStateSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function updateAudioState(
  resourceId: string,
  update: UpdateAudioStateBody,
): Promise<AudioState | null> {
  try {
    const res = await fetch(`/api/resources/${resourceId}/audio`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
    if (!res.ok) return null;
    const parsed = AudioStateSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * `POST .../audio/sections/:n` — either an immediate cache hit
 * (`{cached: true}`) or a started "audio-render" job (`{jobId}`), per
 * routes/audio.ts. The caller (usePlayer) watches the job via the same
 * `subscribeJobEvents` every other long operation uses.
 */
export async function ensureSectionRendered(
  resourceId: string,
  spineIndex: number,
): Promise<{ cached: true } | { jobId: string } | { error: string }> {
  try {
    const res = await fetch(`/api/resources/${resourceId}/audio/sections/${spineIndex}`, {
      method: "POST",
    });
    const body = (await res.json().catch(() => null)) as
      | { cached?: true; jobId?: string; error?: string }
      | null;
    if (!res.ok) return { error: body?.error ?? "request_failed" };
    if (body?.jobId) return { jobId: body.jobId };
    return { cached: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "network_error" };
  }
}

export async function fetchSectionManifest(
  resourceId: string,
  spineIndex: number,
): Promise<AudioSectionManifest | null> {
  try {
    const res = await fetch(`/api/resources/${resourceId}/audio/sections/${spineIndex}/manifest`);
    if (!res.ok) return null;
    const parsed = AudioSectionManifestSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function segmentAudioUrl(resourceId: string, spineIndex: number, n: number): string {
  return `/api/resources/${resourceId}/audio/sections/${spineIndex}/${n}`;
}

/** M22.5 G: the Digest's "what's rendered" column. */
export async function fetchAudioSections(resourceId: string): Promise<AudioSectionsResponse | null> {
  try {
    const res = await fetch(`/api/resources/${resourceId}/audio/sections`);
    if (!res.ok) return null;
    const parsed = AudioSectionsResponseSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** M22.5 G: deletes one section's rendered audio (frees disk space; the
 * player re-renders it on next play, per `render.ts`'s cache-is-existence
 * rule). */
export async function deleteSectionAudio(resourceId: string, spineIndex: number): Promise<boolean> {
  try {
    const res = await fetch(`/api/resources/${resourceId}/audio/sections/${spineIndex}`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

/** M22.5 G: deletes every rendered section for the whole book (all cast
 * hashes) — `deleteResourceAudioCache` on the server. */
export async function deleteAllAudio(resourceId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/resources/${resourceId}/audio`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchBookCast(resourceId: string): Promise<BookCastResponse | null> {
  try {
    const res = await fetch(`/api/resources/${resourceId}/cast`);
    if (!res.ok) return null;
    const parsed = BookCastResponseSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** `PUT /api/cast/:castId` — the casting UI's voice override; always locks
 * (routes/audio.ts, AUDIO.md). */
export async function overrideCastVoice(castId: string, voiceId: string): Promise<BookCastMember | null> {
  try {
    const res = await fetch(`/api/cast/${castId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voiceId }),
    });
    if (!res.ok) return null;
    const parsed = BookCastMemberSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * `POST /api/audio/test-voice` — the audio equivalent of a provider's "Test
 * connection" (AudioTab.tsx's original use) and the casting UI's per-voice
 * preview (AUDIO.md task 3: "preview button speaks a sample line"). Plays
 * the clip itself rather than handing back a URL — the caller has nothing
 * further to do with the bytes, and both call sites want "click, hear it."
 */
export async function previewVoice(voiceId: string, text?: string): Promise<{ error: string } | null> {
  try {
    const res = await fetch("/api/audio/test-voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(text ? { voiceId, text } : { voiceId }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return { error: body?.error ?? "request_failed" };
    }
    const url = URL.createObjectURL(await res.blob());
    const audio = new Audio(url);
    audio.addEventListener("ended", () => URL.revokeObjectURL(url));
    await audio.play();
    return null;
  } catch {
    return { error: "network_error" };
  }
}
