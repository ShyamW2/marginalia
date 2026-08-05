import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Job } from "@marginalia/shared";
import { IconButton } from "../controls/IconButton.js";
import { TrayIcon } from "../controls/icons.js";
import { KeyCapAnchor } from "../shortcuts/KeyCap.js";
import { SHORTCUT_KEYS } from "../shortcuts/keys.js";
import { useShortcuts } from "../shortcuts/useShortcuts.js";
import { useJobs } from "./JobsContext.js";
import styles from "./TasksTray.module.css";

const KIND_LABEL: Record<Job["kind"], string> = {
  digest: "Digest",
  thematic: "Thematic reading",
  "theme-tagging": "Theme tagging",
  "audio-render": "Rendering audio",
  "cast-scan": "Casting",
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

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** "3m 12s"-style duration, from `startedAt` to `finishedAt` (a settled job)
 * or to now (a running one, recomputed on each render — the tray already
 * re-renders on every progress event, so a second ticker isn't needed). */
function formatElapsed(job: Job): string {
  const start = new Date(job.startedAt).getTime();
  const end = job.finishedAt ? new Date(job.finishedAt).getTime() : Date.now();
  const totalSeconds = Math.max(0, Math.round((end - start) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/**
 * M22.5 "a job says what it is working on" / "hovering a task row explains
 * the job": kind, book, range or section, started-at, elapsed, and the
 * current item, always present in the DOM (so it reads fine to a screen
 * reader without any hover at all) and visually revealed by `.row:hover` /
 * `.row:focus-within` in the CSS — the row itself is focusable so this
 * works from the keyboard, not just the mouse, and still says something for
 * a job that already finished.
 */
function JobRowDetail({ job }: { job: Job }) {
  return (
    <dl className={styles.rowDetail}>
      <div>
        <dt>Kind</dt>
        <dd>{KIND_LABEL[job.kind]}</dd>
      </div>
      {job.resourceTitle && (
        <div>
          <dt>Book</dt>
          <dd>{job.resourceTitle}</dd>
        </div>
      )}
      {job.detail && (
        <div>
          <dt>Range</dt>
          <dd>{job.detail}</dd>
        </div>
      )}
      <div>
        <dt>Started</dt>
        <dd>{TIME_FORMAT.format(new Date(job.startedAt))}</dd>
      </div>
      <div>
        <dt>Elapsed</dt>
        <dd>{formatElapsed(job)}</dd>
      </div>
      {job.status === "running" && job.progress.message && (
        <div>
          <dt>Current</dt>
          <dd>{job.progress.message}</dd>
        </div>
      )}
    </dl>
  );
}

function JobRow({ job }: { job: Job }) {
  const { cancellingIds, cancel } = useJobs();
  const percent = job.progress.total > 0 ? Math.round((job.progress.current / job.progress.total) * 100) : null;
  const cancelling = cancellingIds.has(job.id);

  return (
    <div className={styles.row} tabIndex={0}>
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
      <JobRowDetail job={job} />
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
  const runningJobs = jobs.filter((j) => j.status === "running");
  const runningCount = runningJobs.length;
  // M22.5: the ring's fill is the average completion of whichever running
  // jobs report a total — jobs with no total (an indeterminate scan) simply
  // don't contribute one, rather than forcing the whole ring to a guess.
  const jobsWithTotal = runningJobs.filter((j) => j.progress.total > 0);
  const aggregateProgress =
    jobsWithTotal.length > 0
      ? jobsWithTotal.reduce((sum, j) => sum + j.progress.current / j.progress.total, 0) / jobsWithTotal.length
      : null;

  // M22.5 "t toggles the tray": one binding, toggling the same `open` state
  // the click handler below already owns — same shape as NavCluster's `s`.
  useShortcuts([{ key: SHORTCUT_KEYS.tasksTray, handler: () => setOpen((prev) => !prev) }]);

  return (
    <div className={styles.wrap}>
      <div className={styles.triggerWrap}>
        <KeyCapAnchor shortcutKey={SHORTCUT_KEYS.tasksTray}>
          <IconButton
            icon={<TrayIcon progress={aggregateProgress} />}
            label={runningCount > 0 ? `Tasks (${runningCount} running)` : "Tasks"}
            aria-haspopup="true"
            aria-expanded={open}
            pressed={open}
            onClick={() => setOpen((prev) => !prev)}
          />
        </KeyCapAnchor>
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
