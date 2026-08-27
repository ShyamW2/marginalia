import type {
  ProviderAuthFlowState,
  ProviderAuthProvider,
  ProviderAuthStatus,
  ProviderCliDiagnostics,
} from "@marginalia/shared";

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

/** Read-only machine diagnostics for the setup guide — never credentials.
 * Returns null rather than throwing so the guide degrades to its static
 * prose when the server can't answer. */
export async function fetchCliDiagnostics(
  provider: ProviderAuthProvider,
): Promise<ProviderCliDiagnostics | null> {
  const res = await fetch(`/api/provider-auth/${provider}/diagnostics`);
  if (!res.ok) return null;
  return (await res.json()) as ProviderCliDiagnostics;
}
