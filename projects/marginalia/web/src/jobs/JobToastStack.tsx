import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Job } from "@marginalia/shared";
import { useJobs } from "./JobsContext.js";
import styles from "./JobToastStack.module.css";

const KIND_LABEL: Record<Job["kind"], string> = {
  digest: "Digest",
  thematic: "Thematic reading",
  "theme-tagging": "Theme tagging",
  "theme-distillation": "Theme distillation",
  "audio-render": "Rendering audio",
  "cast-scan": "Casting",
};

function summary(job: Job): string {
  switch (job.status) {
    case "running":
      return job.progress.message ?? (job.progress.total > 0 ? `${job.progress.current} of ${job.progress.total}` : "Working…");
    case "completed":
      return "Done";
    case "cancelled":
      return "Cancelled";
    case "failed":
      return "Failed";
  }
}

/**
 * The dismissible per-job progress popup (M20.6, TASKS.md): pops up when a
 * job is started in this tab, stacks with any others already showing, and
 * can be closed at any time without affecting the job — the tray (always
 * present in the nav cluster) is the durable view; this is just the
 * "you just started something" notice.
 */
export function JobToastStack() {
  const { jobs, toastIds, dismissToast, cancellingIds, cancel } = useJobs();
  const reducedMotion = useReducedMotion();
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const toasts = toastIds.map((id) => byId.get(id)).filter((j): j is Job => Boolean(j));

  if (toasts.length === 0) return null;

  return (
    <div className={styles.stack}>
      <AnimatePresence>
        {toasts.map((job) => {
          const percent =
            job.status === "running" && job.progress.total > 0
              ? Math.round((job.progress.current / job.progress.total) * 100)
              : null;
          return (
            <motion.div
              key={job.id}
              className={styles.toast}
              role="status"
              initial={{ opacity: 0, y: reducedMotion ? 0 : 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reducedMotion ? 0 : 12 }}
              transition={{ duration: reducedMotion ? 0.001 : 0.16, ease: "easeOut" }}
            >
              <div className={styles.row}>
                <div className={styles.text}>
                  <span className={styles.title}>{KIND_LABEL[job.kind]}</span>
                  <span className={styles.meta}>{summary(job)}</span>
                </div>
                <button
                  type="button"
                  className={styles.dismiss}
                  aria-label="Dismiss"
                  onClick={() => dismissToast(job.id)}
                >
                  ×
                </button>
              </div>
              {job.status === "running" && (
                <div className={styles.footer}>
                  <div className={styles.progressTrack}>
                    <div
                      className={styles.progressFill}
                      style={{ width: percent !== null ? `${percent}%` : "100%" }}
                      data-indeterminate={percent === null}
                    />
                  </div>
                  <button
                    type="button"
                    className={styles.cancelButton}
                    onClick={() => cancel(job.id)}
                    disabled={cancellingIds.has(job.id)}
                  >
                    {cancellingIds.has(job.id) ? "Cancelling…" : "Cancel"}
                  </button>
                </div>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
