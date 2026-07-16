import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Resource } from "@marginalia/shared";
import { ReaderView } from "./ReaderView.js";
import styles from "./ReaderPage.module.css";

export function ReaderPage() {
  const { id } = useParams<{ id: string }>();
  const [resource, setResource] = useState<Resource | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    setResource(null);
    setNotFound(false);
    fetch(`/api/resources/${id}`)
      .then(async (res) => {
        if (!res.ok) {
          setNotFound(true);
          return;
        }
        setResource((await res.json()) as Resource);
      })
      .catch(() => setNotFound(true));
  }, [id]);

  if (!id) return null;

  if (notFound) {
    return (
      <div className={styles.page}>
        <p>That book isn't in the library.</p>
        <Link to="/">Back to library</Link>
      </div>
    );
  }

  if (!resource) {
    return <div className={styles.page} />;
  }

  return (
    <div className={styles.readerPage}>
      <div className={styles.titleBar}>
        <span className={styles.title}>{resource.title}</span>
        {resource.author && (
          <span className={styles.author}>{resource.author}</span>
        )}
      </div>
      <ReaderView resourceId={resource.id} />
    </div>
  );
}
