import { Router } from "express";
import type { Job } from "@marginalia/shared";
import { cancelJob, getJob, listJobs, subscribeAllJobs, subscribeJob } from "../jobs/registry.js";

export const jobsRouter: Router = Router();

jobsRouter.get("/", (_req, res) => {
  res.json(listJobs());
});

/**
 * SSE stream of every job's creation and progress, registry-wide (M22.5,
 * decisions.md 2026-08-04 "the tray is live for jobs it did not start").
 * Must be registered before `/:id` — Express would otherwise match this
 * path as `:id = "events"`. Same watching-never-owns contract as the
 * per-job stream below: disconnecting here affects nothing.
 */
jobsRouter.get("/events", (req, res) => {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.on("error", () => {
    // client-side socket errors after disconnect are expected — nothing to do
  });

  function send(job: Job, event: "created" | "updated"): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(job)}\n\n`);
  }

  const unsubscribe = subscribeAllJobs(send);

  res.on("close", () => {
    unsubscribe();
  });
});

jobsRouter.get("/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: "job_not_found" });
    return;
  }
  res.json(job);
});

/**
 * SSE progress stream for one job (M20.6). Reconnectable and purely a
 * *view* over the registry: disconnecting here never cancels the job (only
 * POST .../cancel does) — the ⚠️ this milestone exists to enforce is that
 * watching and owning stay two different verbs. `res.on("close")`, not
 * `req.on("close")` (NOTES.md M5): this is a bodyless GET, but the same
 * lesson applies — only the response's own close event reflects the client
 * actually going away.
 */
jobsRouter.get("/:id/events", (req, res) => {
  const initial = getJob(req.params.id);
  if (!initial) {
    res.status(404).end();
    return;
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.on("error", () => {
    // client-side socket errors after disconnect are expected — nothing to do
  });

  function send(job: Job): void {
    res.write(`data: ${JSON.stringify(job)}\n\n`);
    if (job.status !== "running") res.end();
  }

  // Subscribe before sending the snapshot, not after — otherwise a job that
  // finishes in the gap between the two calls would be missed entirely.
  const unsubscribe = subscribeJob(req.params.id, send);
  send(initial);

  res.on("close", () => {
    unsubscribe?.();
  });
});

jobsRouter.post("/:id/cancel", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: "job_not_found" });
    return;
  }
  cancelJob(req.params.id);
  res.json({ ok: true });
});
