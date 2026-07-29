import type {
  CreateProviderProfileBody,
  ProviderProfile,
  ProviderRole,
  ProviderRoleAssignment,
  UpdateProviderProfileBody,
} from "@marginalia/shared";

export async function fetchProviderProfiles(): Promise<ProviderProfile[]> {
  const res = await fetch("/api/provider-profiles");
  if (!res.ok) return [];
  return (await res.json()) as ProviderProfile[];
}

export async function fetchProviderRoles(): Promise<ProviderRoleAssignment[]> {
  const res = await fetch("/api/provider-roles");
  if (!res.ok) return [];
  return (await res.json()) as ProviderRoleAssignment[];
}

export async function createProviderProfile(
  body: CreateProviderProfileBody,
): Promise<ProviderProfile | null> {
  const res = await fetch("/api/provider-profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  return (await res.json()) as ProviderProfile;
}

export async function updateProviderProfile(
  id: string,
  body: UpdateProviderProfileBody,
): Promise<ProviderProfile | null> {
  const res = await fetch(`/api/provider-profiles/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  return (await res.json()) as ProviderProfile;
}

export async function deleteProviderProfile(id: string): Promise<boolean> {
  const res = await fetch(`/api/provider-profiles/${id}`, { method: "DELETE" });
  return res.ok;
}

export async function setProviderRole(
  role: ProviderRole,
  profileId: string | null,
): Promise<ProviderRoleAssignment | null> {
  const res = await fetch(`/api/provider-roles/${role}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileId }),
  });
  if (!res.ok) return null;
  return (await res.json()) as ProviderRoleAssignment;
}

export async function testProviderProfile(
  id: string,
  candidate: UpdateProviderProfileBody,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/provider-profiles/${id}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(candidate),
    });
    return (await res.json()) as { ok: boolean; error?: string };
  } catch {
    return { ok: false, error: "Couldn't reach the server." };
  }
}
