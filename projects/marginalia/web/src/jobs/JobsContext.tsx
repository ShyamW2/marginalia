import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Job, JobKind } from "@marginalia/shared";
import { fetchJobs, requestCancelJob, subscribeAllJobEvents } from "./jobsApi.js";

/** What a call site already knows the moment `startJobRequest` returns an
 * id — enough to render a stub in the tray/toast immediately, before the
 * first real SSE snapshot arrives a moment later. */
export interface StartedJobInfo {
  id: string;
  kind: JobKind;
  resourceId: string | null;
  resourceTitle: string | null;
}

interface JobsContextValue {
  /** Newest first — the shape both the tray and the toast stack want. */
  jobs: Job[];
  /** Ids with a cancel request in flight — the tray/toast disable their
   * cancel button for these rather than waiting for the job to actually
   * stop, which can take a moment on a real provider call. */
  cancellingIds: ReadonlySet<string>;
  cancel: (id: string) => void;
  /** Called by whatever UI just started a job (POST returned a jobId) — adds
   * a stub to the local mirror (the registry-wide stream overwrites it with
   * the real snapshot moments later) and pops a dismissible toast for it. */
  registerStarted: (info: StartedJobInfo) => void;
  /** Ids currently shown as a toast. Dismissing (see `dismissToast`) only
   * removes it from this set — never touches the job itself. */
  toastIds: string[];
  dismissToast: (id: string) => void;
}

const JobsContext = createContext<JobsContextValue | null>(null);

/**
 * M20.6 "the job registry" / "the tasks tray": the client-side mirror of the
 * server's job registry. Mounted once at the app root so a job started from
 * one room keeps advancing — and stays visible in the tray — after
 * navigating elsewhere or dismissing its toast; only `cancel` ever stops the
 * underlying work (decisions.md: "dismissing a popup must never cancel the
 * job").
 */
export function JobsProvider({ children }: { children: ReactNode }) {
  const [jobsById, setJobsById] = useState<Map<string, Job>>(new Map());
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());
  const [toastIds, setToastIds] = useState<Set<string>>(new Set());

  const upsert = useCallback((job: Job) => {
    setJobsById((prev) => {
      const next = new Map(prev);
      next.set(job.id, job);
      return next;
    });
    if (job.status !== "running") {
      setCancellingIds((prev) => {
        if (!prev.has(job.id)) return prev;
        const next = new Set(prev);
        next.delete(job.id);
        return next;
      });
    }
  }, []);

  // Reload-mid-run (TASKS.md M20.6 verify): the registry is the source of
  // truth, so a fresh mount always starts by asking it for everything,
  // rather than assuming an empty tray until something new is started.
  useEffect(() => {
    let cancelled = false;
    fetchJobs().then((list) => {
      if (cancelled) return;
      setJobsById(new Map(list.map((j) => [j.id, j])));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // M22.5 "the tray is live for jobs it did not start" (decisions.md
  // 2026-08-04): one registry-wide stream, subscribed once for the
  // Provider's whole lifetime, replaces the old per-job subscription that
  // only ever covered jobs this tab itself had learned about via
  // `registerStarted` or the mount-time fetch above — missing a job started
  // by another tab, or by a subsystem (usePlayer) that talks to its own job
  // directly and never registers it here.
  useEffect(() => subscribeAllJobEvents(upsert), [upsert]);

  // Defense-in-depth over the SSE stream above (which now reconnects on its
  // own, but a dropped-and-silently-stuck connection is exactly the failure
  // mode that motivated this): while any job is running, periodically
  // re-fetch the registry snapshot so metadata/progress/completion recover
  // even if a specific SSE edge case doesn't. Idle otherwise — no chatter
  // when nothing is running.
  const hasRunningJob = useMemo(() => [...jobsById.values()].some((j) => j.status === "running"), [jobsById]);
  useEffect(() => {
    if (!hasRunningJob) return;
    const interval = setInterval(() => {
      fetchJobs().then((list) => {
        for (const job of list) upsert(job);
      });
    }, 15000);
    return () => clearInterval(interval);
  }, [hasRunningJob, upsert]);

  const registerStarted = useCallback(
    (info: StartedJobInfo) => {
      // A stub, immediately overwritten by the real snapshot the global
      // stream above delivers the instant the job is created — this just
      // avoids a visible gap between "the POST returned" and "the first
      // SSE event arrived".
      upsert({
        id: info.id,
        kind: info.kind,
        resourceId: info.resourceId,
        resourceTitle: info.resourceTitle,
        detail: null,
        status: "running",
        progress: { current: 0, total: 0, message: null },
        error: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
      });
      // Toasts stay opt-in through this call, never from the stream above —
      // chapter-ahead audio rendering would otherwise pop a popup over the
      // reader every few minutes (decisions.md: the blocking-spinner
      // failure in a new costume).
      setToastIds((prev) => new Set(prev).add(info.id));
    },
    [upsert],
  );

  const dismissToast = useCallback((id: string) => {
    setToastIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const cancel = useCallback((id: string) => {
    setCancellingIds((prev) => new Set(prev).add(id));
    void requestCancelJob(id);
  }, []);

  const jobs = useMemo(
    () => [...jobsById.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [jobsById],
  );

  const value = useMemo<JobsContextValue>(
    () => ({ jobs, cancellingIds, cancel, registerStarted, toastIds: [...toastIds], dismissToast }),
    [jobs, cancellingIds, cancel, registerStarted, toastIds, dismissToast],
  );

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
}

export function useJobs(): JobsContextValue {
  const ctx = useContext(JobsContext);
  if (!ctx) throw new Error("useJobs must be used within a JobsProvider");
  return ctx;
}
