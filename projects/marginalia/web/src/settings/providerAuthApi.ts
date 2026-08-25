import type { ProviderAuthFlowState, ProviderAuthProvider, ProviderAuthStatus } from "@marginalia/shared";

export async function fetchAuthStatus(provider: ProviderAuthProvider): Promise<ProviderAuthStatus> {
  const res = await fetch(`/api/provider-auth/${provider}/status`);
  if (!res.ok) return { provider, loggedIn: false, detail: null };
  return (await res.json()) as ProviderAuthStatus;
}

export async function startLogin(provider: ProviderAuthProvider): Promise<ProviderAuthFlowState | null> {
  const res = await fetch(`/api/provider-auth/${provider}/login`, { method: "POST" });
  if (!res.ok) return null;
  return (await res.json()) as ProviderAuthFlowState;
}

export async function fetchLoginFlow(
  provider: ProviderAuthProvider,
  flowId: string,
): Promise<ProviderAuthFlowState | null> {
  const res = await fetch(`/api/provider-auth/${provider}/login/${flowId}`);
  if (!res.ok) return null;
  return (await res.json()) as ProviderAuthFlowState;
}

export async function cancelLogin(provider: ProviderAuthProvider, flowId: string): Promise<void> {
  await fetch(`/api/provider-auth/${provider}/login/${flowId}`, { method: "DELETE" });
}

export async function logoutProvider(provider: ProviderAuthProvider): Promise<void> {
  await fetch(`/api/provider-auth/${provider}/logout`, { method: "POST" });
}
