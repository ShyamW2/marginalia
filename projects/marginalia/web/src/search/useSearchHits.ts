import { useEffect, useRef, useState } from "react";
import type { SearchHit, SearchMatchMode } from "@marginalia/shared";

// The server pass is cheap (~1ms even on a worst-case query — NOTES.md
// "M24 §B"); the repaint on the reader side is not (TASKS.md M24 A: "do not
// re-query per keystroke"), so this debounces the *request*, not the input.
const DEBOUNCE_MS = 200;

/**
 * The one search request both the reader's find bar and the Scan's search
 * field make (decisions.md 2026-08-14: "one result set, two views of it") —
 * `GET /api/resources/:id/search?q=`, debounced, with in-flight requests
 * superseded by whichever query is current rather than raced.
 */
export function useSearchHits(
  resourceId: string | null,
  query: string,
  /** M24.1 C: the matching rule, part of the request rather than a server
   * preference — the surface that asked is the surface that decides, and the
   * hits that come back are the hits it will paint. */
  mode: SearchMatchMode = "word",
): { hits: SearchHit[]; loading: boolean } {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (!resourceId || trimmed.length === 0) {
      requestIdRef.current++;
      setHits([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const requestId = ++requestIdRef.current;
    const timer = window.setTimeout(() => {
      fetch(`/api/resources/${resourceId}/search?q=${encodeURIComponent(trimmed)}&mode=${mode}`)
        .then((res) => (res.ok ? (res.json() as Promise<SearchHit[]>) : []))
        .then((data) => {
          if (requestIdRef.current !== requestId) return; // superseded
          setHits(data);
          setLoading(false);
        })
        .catch(() => {
          if (requestIdRef.current !== requestId) return;
          setHits([]);
          setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [resourceId, query, mode]);

  return { hits, loading };
}
