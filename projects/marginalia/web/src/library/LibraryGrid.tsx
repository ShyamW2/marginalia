import { Link, useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import type { ResourceSummary } from "@marginalia/shared";
import { BookCover } from "./BookCover.js";
import { coverLayoutId } from "./coverLayoutId.js";
import { Button } from "../controls/Button.js";
import styles from "./LibraryGrid.module.css";

interface LibraryGridProps {
  resources: ResourceSummary[];
  publishingId: string | null;
  onPublish: (resourceId: string) => void;
  /** M22 "the desk tool": while lit, the plain "open" link also opens
   * listening — the explicit Listen button below does this unconditionally
   * regardless of the tool. Optional: LibraryGrid predates the tool and not
   * every caller needs it. */
  listeningEngaged?: boolean;
}

/**
 * The accessible list view (DESIGN.md: "Grid fallback ... Keyboard/
 * screen-reader path is the list"). Plain DOM order, real links, no
 * freeform positioning — the canonical a11y path for the desk.
 */
export function LibraryGrid({ resources, publishingId, onPublish, listeningEngaged = false }: LibraryGridProps) {
  const reducedMotion = useReducedMotion();
  const navigate = useNavigate();

  return (
    <div className={styles.grid}>
      {resources.map((resource) => (
        <div key={resource.id} className={styles.card}>
          <Link
            to={`/read/${resource.id}`}
            className={styles.cardLink}
            state={listeningEngaged ? { listenOnOpen: true } : undefined}
          >
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
              {/* M39 §E3 (PDF.md §6): a scan has zero resource_text rows, so
                  neither the highlight count nor "Listen" (no text, nothing
                  to narrate) means anything for it — say so plainly instead. */}
              {!resource.textLayer
                ? "No text layer — preview only. OCR isn't supported yet."
                : resource.highlightCount > 0
                  ? `${resource.highlightCount} highlight${resource.highlightCount === 1 ? "" : "s"}`
                  : "No highlights yet"}
            </span>
            <div className={styles.cardActions}>
              {/* M21 "Listen" (AUDIO.md: "the list view remains the
                  canonical keyboard/screen-reader path") — a real button,
                  not a div with a click handler, per DESIGN.md's
                  accessibility rule for the desk tool this mirrors. */}
              {resource.textLayer && (
                <Button
                  variant="ghost"
                  size="sm"
                  className={styles.listenButton}
                  onClick={() => navigate(`/read/${resource.id}`, { state: { listenOnOpen: true } })}
                >
                  Listen
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className={styles.publishButton}
                disabled={publishingId === resource.id}
                onClick={() => onPublish(resource.id)}
              >
                {publishingId === resource.id ? "Publishing…" : "Publish"}
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
