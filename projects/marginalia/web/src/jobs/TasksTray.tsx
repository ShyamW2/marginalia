import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Job } from "@marginalia/shared";
import { IconButton } from "../controls/IconButton.js";
import { TrayIcon } from "../controls/icons.js";
import { useJobs } from "./JobsContext.js";
import styles from "./TasksTray.module.css";

const KIND_LABEL: Record<Job["kind"], string> = {
  digest: "Digest",
  thematic: "Thematic reading",
  "theme-tagging": "Theme tagging",
};

function jobTitle(job: Job): string {
  const base = KIND_LABEL[job.kind];
  return job.resourceTitle ? `${base} — ${job.resourceTitle}` : base;
}

function statusLabel(job: Job): string {
  switch (job.status) {
    case "running":
      return job.progress.message ?? (job.progress.total > 0 ? `${job.progress.current} of ${job.progress.total}` : "Working…");
    case "completed":
      return "Done";
    case "cancelled":
      return "Cancelled";
    case "failed":
      return job.error ? `Failed — ${job.error}` : "Failed";
  }
}

function JobRow({ job }: { job: Job }) {
  const { cancellingIds, cancel } = useJobs();
  const percent = job.progress.total > 0 ? Math.round((job.progress.current / job.progress.total) * 100) : null;
  const cancelling = cancellingIds.has(job.id);

  return (
    <div className={styles.row}>
      <div className={styles.rowHeader}>
        <span className={styles.rowTitle}>{jobTitle(job)}</span>
        {job.status === "running" && (
          <button
            type="button"
            className={styles.cancelButton}
            onClick={() => cancel(job.id)}
            disabled={cancelling}
          >
            {cancelling ? "Cancelling…" : "Cancel"}
          </button>
        )}
      </div>
      <div className={styles.rowMeta} data-status={job.status}>
        {statusLabel(job)}
      </div>
      {job.status === "running" && (
        <div className={styles.progressTrack} role="progressbar" aria-valuenow={percent ?? undefined} aria-valuemin={0} aria-valuemax={100}>
          <div
            className={styles.progressFill}
            style={{ width: percent !== null ? `${percent}%` : "100%" }}
            data-indeterminate={percent === null}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The persistent tray (M20.6, TASKS.md "browser-downloads-style"): every job
 * the registry knows about, running or recently finished, with per-job
 * cancel. Lives in the nav cluster so it's present in every room — the same
 * "one control, present everywhere" pattern the settings/theme icons already
 * follow (DESIGN.md "the control system").
 */
export function TasksTray() {
  const { jobs } = useJobs();
  const [open, setOpen] = useState(false);
  const reducedMotion = useReducedMotion();
  const runningCount = jobs.filter((j) => j.status === "running").length;

  return (
    <div className={styles.wrap}>
      <div className={styles.triggerWrap}>
        <IconButton
          icon={<TrayIcon />}
          label={runningCount > 0 ? `Tasks (${runningCount} running)` : "Tasks"}
          aria-haspopup="true"
          aria-expanded={open}
          pressed={open}
          onClick={() => setOpen((prev) => !prev)}
        />
        {runningCount > 0 && <span className={styles.badge}>{runningCount}</span>}
      </div>
      <AnimatePresence>
        {open && (
          <>
            {/* Click-outside-to-close, same shape as the other popovers in
                this cluster — a full-viewport transparent layer below the
                popover, above everything else. */}
            <div className={styles.scrim} onClick={() => setOpen(false)} />
            <motion.div
              className={styles.popover}
              role="dialog"
              aria-label="Tasks"
              initial={{ opacity: 0, y: reducedMotion ? 0 : -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reducedMotion ? 0 : -4 }}
              transition={{ duration: reducedMotion ? 0.001 : 0.14, ease: "easeOut" }}
            >
              <div className={styles.header}>Tasks</div>
              {jobs.length === 0 ? (
                <div className={styles.empty}>Nothing running or recently finished.</div>
              ) : (
                <div className={styles.list}>
                  {jobs.map((job) => (
                    <JobRow key={job.id} job={job} />
                  ))}
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
