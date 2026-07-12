import { useParams } from "react-router-dom";
import styles from "./ReaderPage.module.css";

// The ReaderView (epub.js wrapper) arrives in M2. Placeholder for routing.
export function ReaderPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className={styles.page}>
      <p>Reader for resource {id} — coming in M2.</p>
    </div>
  );
}
