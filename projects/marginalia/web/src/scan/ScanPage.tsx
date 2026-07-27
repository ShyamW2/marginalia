import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useReducedMotion } from "motion/react";
import type { HighlightImportance, HighlightKind, ScanData, ScanHighlight } from "@marginalia/shared";
import { playAirlock } from "../app/airlockBus.js";
import { updateHighlightImportance, updateHighlightTags } from "../highlights/highlightMeta.js";
import { onSettingsSaved } from "../settings/settingsBus.js";
import { HeatStrip } from "./HeatStrip.js";
import { RevisitQueue } from "./RevisitQueue.js";
import { KIND_ORDER, phosphorHue } from "./scanPalette.js";
import styles from "./ScanPage.module.css";

async function fetchScanCrtIntensity(): Promise<number> {
  try {
    const res = await fetch("/api/settings");
    if (!res.ok) return 0.6;
    const settings = (await res.json()) as { scanCrtIntensity: number };
    return settings.scanCrtIntensity;
  } catch {
    return 0.6;
  }
}

interface ScanLocationState {
  viaAirlock?: boolean;
}

function relativeLastRead(iso: string | null): string {
  if (!iso) return "never opened";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

async function fetchScanData(resourceId: string): Promise<ScanData | null> {
  try {
    const res = await fetch(`/api/resources/${resourceId}/scan`);
    if (!res.ok) return null;
    return (await res.json()) as ScanData;
  } catch {
    return null;
  }
}

/**
 * The Scan (M9, DESIGN.md Room 3): the book laid flat as data. Loads
 * without touching epub.js — every position is server-computed
 * (server/src/annotations/scan.ts) from the same anchoring rule the reader
 * uses, so the strip renders instantly even for a book that's never been
 * opened this session.
 */
export function ScanPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const reducedMotion = Boolean(useReducedMotion());
  // Captured once, lazily, at mount rather than read live from `location` —
  // see ReaderPage.tsx for why a live read is unsafe once anything in this
  // component gates its first real render behind an async fetch.
  const [initialLocationState] = useState<ScanLocationState | null>(
    () => location.state as ScanLocationState | null,
  );

  const [data, setData] = useState<ScanData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [filterKind, setFilterKind] = useState<HighlightKind | null>(null);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [crtIntensity, setCrtIntensity] = useState(0.6);

  useEffect(() => {
    fetchScanCrtIntensity().then(setCrtIntensity);
    return onSettingsSaved((settings) => setCrtIntensity(settings.scanCrtIntensity));
  }, []);

  useEffect(() => {
    if (!id) return;
    setData(null);
    setNotFound(false);
    fetchScanData(id).then((result) => {
      if (!result) {
        setNotFound(true);
        return;
      }
      setData(result);
    });
  }, [id]);

  // Arrived via an airlock (Desk's "Open scan" or the reader's "Scan"
  // button) — play the "in" half once, matching ReaderPage's mirror of this.
  useEffect(() => {
    if (!initialLocationState?.viaAirlock) return;
    void playAirlock("in", reducedMotion ? 0 : 360);
    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (event.key === "Escape" && !isTyping) void handleBackToBook();
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, reducedMotion]);

  async function handleBackToBook() {
    if (!id) return;
    await playAirlock("out", reducedMotion ? 0 : 360);
    navigate(`/read/${id}`, { state: { viaAirlock: true } });
  }

  async function handleOpenHighlight(highlight: ScanHighlight) {
    if (!id) return;
    await playAirlock("out", reducedMotion ? 0 : 360);
    navigate(`/read/${id}`, { state: { jumpToHighlightId: highlight.id, viaAirlock: true } });
  }

  function handleImportanceChange(highlightId: string, next: HighlightImportance) {
    setData((prev) =>
      prev
        ? {
            ...prev,
            highlights: prev.highlights.map((h) =>
              h.id === highlightId ? { ...h, importance: next } : h,
            ),
          }
        : prev,
    );
    void updateHighlightImportance(highlightId, next);
  }

  function handleTagsChange(highlightId: string, next: string[]) {
    setData((prev) =>
      prev
        ? {
            ...prev,
            highlights: prev.highlights.map((h) =>
              h.id === highlightId ? { ...h, tags: next } : h,
            ),
          }
        : prev,
    );
    void updateHighlightTags(highlightId, next);
  }

  const distinctTags = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    for (const h of data.highlights) for (const t of h.tags) set.add(t);
    return [...set].sort();
  }, [data]);

  const filtersActive = filterKind !== null || filterTag !== null || searchText.trim() !== "";

  const litIds = useMemo(() => {
    if (!data || !filtersActive) return null;
    const needle = searchText.trim().toLowerCase();
    const set = new Set<string>();
    for (const h of data.highlights) {
      if (filterKind && h.kind !== filterKind) continue;
      if (filterTag && !h.tags.includes(filterTag)) continue;
      if (needle) {
        const haystack = `${h.exact} ${h.note} ${h.threadFirstLine ?? ""}`.toLowerCase();
        if (!haystack.includes(needle)) continue;
      }
      set.add(h.id);
    }
    return set;
  }, [data, filterKind, filterTag, searchText, filtersActive]);

  if (!id) return null;

  if (notFound) {
    return (
      <div className={styles.page}>
        <p>That book isn't in the library.</p>
        <button type="button" className={styles.backButton} onClick={() => navigate("/")}>
          Back to the desk
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}>Loading scan…</div>
      </div>
    );
  }

  const maxChapterLength = Math.max(0.0001, ...data.chapters.map((c) => c.lengthPercent));

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>{data.resource.title}</h1>
          <div className={styles.subtitle}>
            {data.resource.author ?? "Unknown"} — instrument view
          </div>
        </div>
        <button type="button" className={styles.backButton} onClick={handleBackToBook}>
          ← Book
        </button>
      </div>

      <div className={styles.readouts}>
        <div className={styles.readoutTile}>
          <div className={styles.readoutLabel}>Highlights</div>
          <div className={styles.readoutValue}>{data.totalHighlights}</div>
        </div>
        <div className={styles.readoutTile}>
          <div className={styles.readoutLabel}>Last visited</div>
          <div className={styles.readoutValue}>{relativeLastRead(data.lastReadAt)}</div>
        </div>
        <div className={styles.readoutTile}>
          <div className={styles.readoutLabel}>Chapters</div>
          <div className={styles.readoutValue}>{data.chapters.length}</div>
          <div className={styles.sparkline}>
            {data.chapters.map((c) => (
              <div
                key={c.spineIndex}
                className={styles.sparkBar}
                style={{ height: `${Math.max(8, (c.lengthPercent / maxChapterLength) * 100)}%` }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className={styles.filters}>
        <div className={styles.kindToggle} role="group" aria-label="Filter by kind">
          <button
            type="button"
            className={
              filterKind === null ? `${styles.kindAllButton} ${styles.kindAllButtonActive}` : styles.kindAllButton
            }
            aria-pressed={filterKind === null}
            onClick={() => setFilterKind(null)}
          >
            All
          </button>
          {KIND_ORDER.map((kind) => (
            <button
              key={kind}
              type="button"
              className={filterKind === kind ? `${styles.kindButton} ${styles.kindButtonActive}` : styles.kindButton}
              style={{ background: phosphorHue(kind) }}
              aria-pressed={filterKind === kind}
              aria-label={`Filter by ${kind}`}
              onClick={() => setFilterKind((prev) => (prev === kind ? null : kind))}
            />
          ))}
        </div>

        {distinctTags.length > 0 && (
          <select
            className={styles.tagSelect}
            value={filterTag ?? ""}
            onChange={(e) => setFilterTag(e.target.value || null)}
            aria-label="Filter by tag"
          >
            <option value="">All tags</option>
            {distinctTags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        )}

        <input
          type="search"
          className={styles.searchInput}
          placeholder="Search quotes and threads…"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          aria-label="Search highlights"
        />
      </div>

      <div className={styles.stripSection}>
        {data.highlights.length === 0 ? (
          <div className={styles.emptyState}>No highlights yet — read a passage and ask a question.</div>
        ) : (
          <HeatStrip
            chapters={data.chapters}
            highlights={data.highlights}
            litIds={litIds}
            crtIntensity={crtIntensity}
            reducedMotion={reducedMotion}
            onOpen={handleOpenHighlight}
            onImportanceChange={handleImportanceChange}
            onTagsChange={handleTagsChange}
          />
        )}
      </div>

      <RevisitQueue highlights={data.highlights} onOpen={handleOpenHighlight} />
    </div>
  );
}
