import crypto from "node:crypto";
import type { Job, JobKind, JobProgress, JobStatus } from "@marginalia/shared";

/**
 * The job registry (M20.6, decisions.md 2026-07-30 "Background work is a job
 * model, not a popup"). One in-memory registry for every long-running server
 * operation — a chapter/range digest, a thematic re-run, a theme-tagging
 * pass — so the tasks tray, cancellation, and progress streaming are built
 * once instead of per-feature. In-memory is the boring, correct choice here:
 * this is a single local-first Node process (CLAUDE.md settled decision 4),
 * so a job's lifetime never needs to outlive the process that's running it.
 *
 * The core invariant this exists to enforce (decisions.md): *watching a job
 * is not owning it*. Subscribing to progress (SSE) or just polling the list
 * never affects the job; only `cancelJob` does. A client that navigates
 * away, reloads, or never opens the tray at all does not stop the work.
 */

export type ProgressReporter = (progress: { current: number; total: number; message?: string | null }) => void;

/** What a job actually does — given its own AbortSignal (wired to
 * `cancelJob`) and a reporter to call as it makes progress. Rejecting after
 * the signal was aborted is treated as a clean cancellation, not a failure;
 * rejecting for any other reason marks the job failed. */
export type JobRunner = (signal: AbortSignal, reportProgress: ProgressReporter) => Promise<void>;

interface InternalJob {
  public: Job;
  controller: AbortController;
  listeners: Set<(job: Job) => void>;
}

const jobs = new Map<string, InternalJob>();

// M22.5 "the tray is live for jobs it did not start" (decisions.md
// 2026-08-04): per-job `subscribeJob` listeners only exist once a client
// already knows a job's id — no help for a job started by another tab, or
// one a subsystem (usePlayer) subscribes to directly without ever going
// through the client-side registry mirror. This is the other half: every
// creation and update, for every job, regardless of who's watching.
const globalListeners = new Set<(job: Job, event: "created" | "updated") => void>();

function emitGlobal(job: Job, event: "created" | "updated"): void {
  for (const listener of globalListeners) listener(job, event);
}

// Keeps the tray's "recently finished work" bounded without a TTL sweep —
// simplest boring choice for a registry that only ever lives as long as one
// server process.
const MAX_FINISHED_JOBS = 50;

function pruneFinishedJobs(): void {
  const finished = [...jobs.values()]
    .filter((j) => j.public.status !== "running")
    .sort((a, b) => a.public.startedAt.localeCompare(b.public.startedAt));
  const overflow = finished.length - MAX_FINISHED_JOBS;
  for (let i = 0; i < overflow; i++) jobs.delete(finished[i].public.id);
}

function emit(job: InternalJob): void {
  for (const listener of job.listeners) listener(job.public);
  emitGlobal(job.public, "updated");
}

export function startJob(
  kind: JobKind,
  resourceId: string | null,
  resourceTitle: string | null,
  run: JobRunner,
  // M22.5 "a job says what it is working on": stable for the job's whole
  // life, unlike `progress.message` which changes per item — a range
  // digest's endpoints, an audio render's or cast scan's section. Null for
  // jobs with no single natural range/section (theme-tagging).
  detail: string | null = null,
): Job {
  const controller = new AbortController();
  const job: InternalJob = {
    public: {
      id: crypto.randomUUID(),
      kind,
      resourceId,
      resourceTitle,
      detail,
      status: "running",
      progress: { current: 0, total: 0, message: null },
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    },
    controller,
    listeners: new Set(),
  };
  jobs.set(job.public.id, job);
  emitGlobal(job.public, "created");

  const reportProgress: ProgressReporter = (progress) => {
    // A late progress report racing a just-cancelled job would otherwise
    // flip it back to looking alive; a terminal job's progress is frozen.
    if (job.public.status !== "running") return;
    job.public = { ...job.public, progress: { message: null, ...progress } };
    emit(job);
  };

  run(controller.signal, reportProgress)
    .then(() => {
      finish(job, controller.signal.aborted ? "cancelled" : "completed", null);
    })
    .catch((err) => {
      const status: JobStatus = controller.signal.aborted ? "cancelled" : "failed";
      finish(job, status, status === "failed" ? (err instanceof Error ? err.message : String(err)) : null);
    });

  return job.public;
}

function finish(job: InternalJob, status: JobStatus, error: string | null): void {
  job.public = {
    ...job.public,
    status,
    error,
    finishedAt: new Date().toISOString(),
  };
  emit(job);
  pruneFinishedJobs();
}

export function listJobs(): Job[] {
  return [...jobs.values()].map((j) => j.public).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function getJob(id: string): Job | null {
  return jobs.get(id)?.public ?? null;
}

/** True if a running job was found and told to stop; false if the job
 * doesn't exist or has already finished (cancelling a finished job is a
 * no-op, not an error — the tray can call this without checking status
 * first). */
export function cancelJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job || job.public.status !== "running") return false;
  job.controller.abort();
  return true;
}

/** Subscribes to a job's progress; returns an unsubscribe function. Fires
 * only on genuine updates — the caller (the SSE route) sends the current
 * snapshot itself first, so a reconnecting client isn't left waiting for
 * the next event to learn a job already finished. */
export function subscribeJob(id: string, listener: (job: Job) => void): (() => void) | null {
  const job = jobs.get(id);
  if (!job) return null;
  job.listeners.add(listener);
  return () => job.listeners.delete(listener);
}

/** Subscribes to every job's creation and progress, registry-wide —
 * M22.5's fix for the tray only ever learning about a job it started
 * itself. Same invariant as `subscribeJob`: watching never owns, so this
 * never touches `controller` and has no effect on any job's outcome. */
export function subscribeAllJobs(listener: (job: Job, event: "created" | "updated") => void): () => void {
  globalListeners.add(listener);
  return () => globalListeners.delete(listener);
}
