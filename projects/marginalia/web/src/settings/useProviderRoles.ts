import { useCallback, useEffect, useState } from "react";
import type { ProviderProfile, ProviderRoleAssignment } from "@marginalia/shared";
import { fetchProviderProfiles, fetchProviderRoles } from "./providerApi.js";
import { onProviderRolesSaved } from "./providerBus.js";

interface ProviderRolesState {
  profiles: ProviderProfile[];
  roles: ProviderRoleAssignment[];
  loading: boolean;
  refresh: () => void;
}

/** Shared data layer behind every mounted ProviderPicker (docs/decisions.md
 * 2026-07-29 later: "one picker component built once", used in three
 * surfaces at once) — fetches once, and every instance refetches together
 * whenever any of them saves a change (providerBus.ts), so "switching a role
 * from any surface is reflected immediately in the others" without prop
 * drilling across unrelated route trees. */
export function useProviderRoles(): ProviderRolesState {
  const [profiles, setProfiles] = useState<ProviderProfile[]>([]);
  const [roles, setRoles] = useState<ProviderRoleAssignment[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    Promise.all([fetchProviderProfiles(), fetchProviderRoles()]).then(([p, r]) => {
      setProfiles(p);
      setRoles(r);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    load();
    return onProviderRolesSaved(load);
  }, [load]);

  return { profiles, roles, loading, refresh: load };
}
