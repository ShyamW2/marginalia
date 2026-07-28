import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { renderMarkdown } from "../threads/markdown.js";
import styles from "./DigestPage.module.css";

async function fetchDigestMarkdown(resourceId: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/resources/${resourceId}/digest/markdown`);
    if (!res.ok) return null;
    const body = (await res.json()) as { content: string };
    return body.content;
  } catch {
    return null;
  }
}

/**
 * The digest's markdown projection, read-only (decisions.md 2026-07-28
 * later: "SQLite stays the source of truth... hand-edits are overwritten on
 * the next run, never read back"). Reachable from the scan (and, via the
 * same link, effectively from the desk/reader wherever the scan is linked)
 * — a standalone route rather than folded into the scan itself, since it's
 * meant to be *read*, not an instrument face.
 */
export function DigestPage() {
  const { id } = useParams<{ id: string }>();
  const [content, setContent] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    setContent(null);
    setNotFound(false);
    fetchDigestMarkdown(id).then((result) => {
      if (result === null) setNotFound(true);
      else setContent(result);
    });
  }, [id]);

  if (!id) return null;

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <Link to={`/scan/${id}`} className={styles.backLink}>
          ← Scan
        </Link>
        <Link to={`/read/${id}`} className={styles.backLink}>
          Open book
        </Link>
      </div>
      <div className={styles.regeneratedNotice}>
        This page is a regenerated projection of the book's digest — it is
        never hand-editable and is overwritten every time the digest runs.
      </div>
      {notFound && <p>Couldn't load the digest for this book.</p>}
      {!notFound && content === null && <div className={styles.loading}>Loading digest…</div>}
      {content !== null && <article className={styles.markdown}>{renderMarkdown(content)}</article>}
    </div>
  );
}
