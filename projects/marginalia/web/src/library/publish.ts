import type { PublishResult } from "@marginalia/shared";

export type PublishOutcome =
  | { ok: true; result: PublishResult }
  | { ok: false; message: string };

function errorMessage(code: string | undefined): string {
  switch (code) {
    case "vault_path_unset":
      return "Set a vault path in Settings first.";
    case "provider_unconfigured":
      return "Configure an LLM provider in Settings first.";
    case "resource_not_found":
      return "That book isn't in the library anymore.";
    case "auth":
      return "LLM provider authentication failed.";
    case "rate_limit":
      return "Rate limited by the LLM provider — try again shortly.";
    case "context_too_large":
      return "This book is too large for the configured context window.";
    case "extract_parse_failed":
      return "The model's response couldn't be parsed — try again.";
    default:
      return "Publish failed.";
  }
}

export function formatPublishSummary(result: PublishResult): string {
  if (result.notes === 0) {
    return "Already up to date — nothing new to publish.";
  }
  const noteWord = result.notes === 1 ? "note" : "notes";
  const conceptWord = result.conceptsCreated === 1 ? "concept" : "concepts";
  return `${result.notes} ${noteWord}, ${result.conceptsCreated} new ${conceptWord}, ${result.conceptsLinked} linked`;
}

/** POSTs /api/resources/:id/publish and maps the result to a UI-ready outcome. */
export async function runPublish(resourceId: string): Promise<PublishOutcome> {
  try {
    const res = await fetch(`/api/resources/${resourceId}/publish`, { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as { error?: string } & Partial<PublishResult>;
    if (!res.ok) {
      return { ok: false, message: errorMessage(body.error) };
    }
    return { ok: true, result: body as PublishResult };
  } catch {
    return { ok: false, message: "Couldn't reach the server." };
  }
}
