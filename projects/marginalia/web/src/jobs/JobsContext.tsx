import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Job } from "@marginalia/shared";
import { fetchJobs, requestCancelJob, subscribeJobEvents } from "./jobsApi.js";

interface JobsContextValue {
  /** Newest first — the shape both the tray and the toast stack want. */
  jobs: Job[];
  /** Ids with a cancel request in flight — the tray/toast disable their
   * cancel button for these rather than waiting for the job to actually
   * stop, which can take a moment on a real provider call. */
  cancellingIds: ReadonlySet<string>;
  cancel: (id: string) => void;
  /** Called by whatever UI just started a job (POST returned a jobId) — adds
   * it to the registry's local mirror, subscribes to its progress, and pops
   * a dismissible toast for it. */
  registerStarted: (job: Job) => void;
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
  const subscriptions = useRef<Map<string, () => void>>(new Map());

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

  const ensureSubscribed = useCallback(
    (id: string) => {
      if (subscriptions.current.has(id)) return;
      subscriptions.current.set(id, subscribeJobEvents(id, upsert));
    },
    [upsert],
  );

  // Reload-mid-run (TASKS.md M20.6 verify): the registry is the source of
  // truth, so a fresh mount always starts by asking it for everything,
  // rather than assuming an empty tray until something new is started.
  useEffect(() => {
    let cancelled = false;
    fetchJobs().then((list) => {
      if (cancelled) return;
      setJobsById(new Map(list.map((j) => [j.id, j])));
      for (const job of list) if (job.status === "running") ensureSubscribed(job.id);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      for (const unsubscribe of subscriptions.current.values()) unsubscribe();
    },
    [],
  );

  const registerStarted = useCallback(
    (job: Job) => {
      upsert(job);
      ensureSubscribed(job.id);
      setToastIds((prev) => new Set(prev).add(job.id));
    },
    [upsert, ensureSubscribed],
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
