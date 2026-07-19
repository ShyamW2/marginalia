import { useState } from "react";
import styles from "./BookCover.module.css";

interface BookCoverProps {
  resourceId: string;
  title: string;
}

/**
 * The book's cover art, extracted from its EPUB (GET /api/resources/:id/cover
 * — 404 if the EPUB declared none). Falls back to a plain lettered tile so
 * the grid never shows a broken-image icon; the fallback deliberately
 * doesn't try to fake a cover with color/art, it's just a placeholder.
 */
export function BookCover({ resourceId, title }: BookCoverProps) {
  const [failed, setFailed] = useState(false);
  const initial = title.trim().charAt(0).toUpperCase() || "?";

  if (failed) {
    return (
      <div className={styles.fallback} aria-hidden="true">
        <span className={styles.initial}>{initial}</span>
      </div>
    );
  }

  return (
    <img
      className={styles.cover}
      src={`/api/resources/${resourceId}/cover`}
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
