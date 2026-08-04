import {
  AudioSectionManifestSchema,
  AudioStateSchema,
  type AudioSectionManifest,
  type AudioState,
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
