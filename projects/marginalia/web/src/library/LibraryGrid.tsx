import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import type { ResourceSummary } from "@marginalia/shared";
import { BookCover } from "./BookCover.js";
import { coverLayoutId } from "./coverLayoutId.js";
import styles from "./LibraryGrid.module.css";

interface LibraryGridProps {
  resources: ResourceSummary[];
  publishingId: string | null;
  onPublish: (resourceId: string) => void;
}

/**
 * The accessible list view (DESIGN.md: "Grid fallback ... Keyboard/
 * screen-reader path is the list"). Plain DOM order, real links, no
 * freeform positioning — the canonical a11y path for the desk.
 */
export function LibraryGrid({ resources, publishingId, onPublish }: LibraryGridProps) {
  const reducedMotion = useReducedMotion();

  return (
    <div className={styles.grid}>
      {resources.map((resource) => (
        <div key={resource.id} className={styles.card}>
          <Link to={`/read/${resource.id}`} className={styles.cardLink}>
            <motion.div
              className={styles.coverWrap}
              layoutId={reducedMotion ? undefined : coverLayoutId(resource.id)}
            >
              <BookCover resourceId={resource.id} title={resource.title} />
              {resource.threadCount > 0 && (
                <span
                  className={styles.threadBadge}
                  title={`${resource.threadCount} annotation thread${
                    resource.threadCount === 1 ? "" : "s"
                  }`}
                >
                  {resource.threadCount}
                </span>
              )}
            </motion.div>
            <div className={styles.cardTitle}>{resource.title}</div>
            {resource.author && <div className={styles.cardAuthor}>{resource.author}</div>}
          </Link>
          <div className={styles.cardFooter}>
            <span className={styles.cardMeta}>
              {resource.highlightCount > 0
                ? `${resource.highlightCount} highlight${resource.highlightCount === 1 ? "" : "s"}`
                : "No highlights yet"}
            </span>
            <button
              type="button"
              className={styles.publishButton}
              disabled={publishingId === resource.id}
              onClick={() => onPublish(resource.id)}
            >
              {publishingId === resource.id ? "Publishing…" : "Publish"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
