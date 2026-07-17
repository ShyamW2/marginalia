import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Resource } from "@marginalia/shared";
import { Toast } from "../app/Toast.js";
import { formatPublishSummary, runPublish } from "../library/publish.js";
import { ReaderView } from "./ReaderView.js";
import styles from "./ReaderPage.module.css";

export function ReaderPage() {
  const { id } = useParams<{ id: string }>();
  const [resource, setResource] = useState<Resource | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

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

  async function handlePublish() {
    if (!resource) return;
    setPublishing(true);
    const outcome = await runPublish(resource.id);
    setPublishing(false);
    setToast(
      outcome.ok
        ? { message: formatPublishSummary(outcome.result), tone: "success" }
        : { message: outcome.message, tone: "error" },
    );
  }

  return (
    <div className={styles.readerPage}>
      <div className={styles.titleBar}>
        <span className={styles.title}>{resource.title}</span>
        {resource.author && (
          <span className={styles.author}>{resource.author}</span>
        )}
        <button
          type="button"
          className={styles.publishButton}
          disabled={publishing}
          onClick={handlePublish}
        >
          {publishing ? "Publishing…" : "Publish"}
        </button>
      </div>
      <ReaderView resourceId={resource.id} />
      {toast && (
        <Toast
          message={toast.message}
          tone={toast.tone}
          position="top"
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  );
}
