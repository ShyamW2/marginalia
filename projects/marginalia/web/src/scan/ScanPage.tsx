import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useReducedMotion } from "motion/react";
import type { HighlightImportance, HighlightKind, ScanData, ScanHighlight } from "@marginalia/shared";
import { updateHighlightImportance, updateHighlightTags } from "../highlights/highlightMeta.js";
import { onSettingsSaved } from "../settings/settingsBus.js";
import { SHORTCUT_KEYS } from "../shortcuts/keys.js";
import { useShortcuts } from "../shortcuts/useShortcuts.js";
import { DigestSpotlight } from "./DigestSpotlight.js";
import { HeatStrip } from "./HeatStrip.js";
import { RevisitQueue } from "./RevisitQueue.js";
import { KIND_ORDER, phosphorHue } from "./scanPalette.js";
import { ScanWarpFilter } from "./ScanWarpFilter.js";
import { VhsOverlay } from "./VhsOverlay.js";
import { computeWarpGeometry } from "./warp.js";
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

interface ScanPageProps {
  resourceId: string;
  /** M20.5 "the Scan becomes a popup" (decisions.md 2026-07-30): closes the
   * overlay, revealing whatever room was behind it — wired to Escape below
   * and to ScanOverlay's own × button, exactly like SettingsModal's onClose. */
  onClose: () => void;
}

/**
 * The Scan (M9, DESIGN.md Room 3): the book laid flat as data. Loads
 * without touching epub.js — every position is server-computed
 * (server/src/annotations/scan.ts) from the same anchoring rule the reader
 * uses, so the strip renders instantly even for a book that's never been
 * opened this session.
 */
export function ScanPage({ resourceId: id, onClose }: ScanPageProps) {
  const navigate = useNavigate();
  const reducedMotion = Boolean(useReducedMotion());

  const [data, setData] = useState<ScanData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [filterKind, setFilterKind] = useState<HighlightKind | null>(null);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [filterTheme, setFilterTheme] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [crtIntensity, setCrtIntensity] = useState(0.6);
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  // M19.5 "the semantic scan: two layers" (decisions.md 2026-07-29 later):
  // Mine (highlights) and Book (chapter themes) show independently — "Filter
  // to either or show both." Both default on; Book only ever renders
  // anything once `data.book.hasDigest` is true (see the fallback note
  // below the filters).
  const [showMineLayer, setShowMineLayer] = useState(true);
  const [showBookLayer, setShowBookLayer] = useState(true);

  const warpWrapperRef = useRef<HTMLDivElement>(null);
  const [warpSize, setWarpSize] = useState({ width: 0, height: 0 });
  const warpFilterId = useId().replace(/:/g, "");
  const warpActive = !reducedMotion && crtIntensity > 0;
  const warpGeometry = useMemo(
    () => computeWarpGeometry(warpSize.width, warpSize.height, warpActive ? crtIntensity : 0),
    [warpSize, crtIntensity, warpActive],
  );

  useEffect(() => {
    fetchScanCrtIntensity().then(setCrtIntensity);
    return onSettingsSaved((settings) => setCrtIntensity(settings.scanCrtIntensity));
  }, []);

  // M18 "one filter, one wrapper" (decisions.md 2026-07-28/2026-07-29): the
  // whole base scan screen — readouts, filters, the strip, the spotlight,
  // the revisit queue — warps together as a single surface, so it's
  // measured once here rather than per-piece the way M15's strip-local
  // filter was. HeatStrip (and later the digest torch) convert their own
  // local coordinates into this wrapper's space to keep hit-targets aligned
  // with what the filter visually displaces them to (warp.ts).
  //
  // Deps on `Boolean(data)` rather than `[]`: this component mounts before
  // `data` resolves (the "Loading scan…" branch renders first, with no
  // wrapper element at all), so a mount-only effect would find
  // `warpWrapperRef.current` null forever and never observe anything —
  // caught live, see NOTES.md "M18". Re-arming once, when the real wrapper
  // first appears, is enough; it never disappears again after that.
  useEffect(() => {
    const el = warpWrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setWarpSize({ width: box.width, height: box.height });
    });
    observer.observe(el);
    setWarpSize({ width: el.clientWidth, height: el.clientHeight });
    return () => observer.disconnect();
  }, [Boolean(data)]);

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

  // M20.5 "Scan and Digest stop being rooms" (decisions.md 2026-07-30): Escape
  // now closes the instrument (back to whatever room was behind it) rather
  // than forcing a jump into the reader — the same meaning it has everywhere
  // else an overlay is open (SettingsModal). `r` keeps its own, distinct
  // meaning: "open the reader for this book," unconditionally, matching
  // DigestPage's identical binding.
  useShortcuts([
    { key: SHORTCUT_KEYS.escape, handler: onClose },
    { key: SHORTCUT_KEYS.reader, handler: () => handleOpenReader() },
  ]);

  function handleOpenReader() {
    navigate(`/read/${id}`);
  }

  function handleOpenHighlight(highlight: ScanHighlight) {
    navigate(`/read/${id}`, { state: { jumpToHighlightId: highlight.id } });
  }

  /**
   * M19.5 "book bands click through to the chapter start" (decisions.md
   * 2026-07-29 later): reuses the same chapter-anchor endpoint the digest
   * page's posed questions use (an empty quote falls back to the chapter's
   * own opening text server-side — see chapterAnchor.ts's
   * `chapterStartAnchor`), so this needs no new anchoring machinery.
   */
  async function handleOpenChapter(spineIndex: number) {
    try {
      const res = await fetch(`/api/resources/${id}/chapter-anchor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spineIndex, quote: "" }),
      });
      if (!res.ok) return;
      const highlight = (await res.json()) as { id: string };
      navigate(`/read/${id}`, { state: { jumpToHighlightId: highlight.id } });
    } catch {
      // best-effort — a failed anchor just means the click does nothing
    }
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

  const filtersActive =
    filterKind !== null || filterTag !== null || filterTheme !== null || searchText.trim() !== "";

  const litIds = useMemo(() => {
    if (!data || !filtersActive) return null;
    const needle = searchText.trim().toLowerCase();
    const set = new Set<string>();
    for (const h of data.highlights) {
      if (filterKind && h.kind !== filterKind) continue;
      if (filterTag && !h.tags.includes(filterTag)) continue;
      if (filterTheme && !h.themes.includes(filterTheme)) continue;
      if (needle) {
        const haystack = `${h.exact} ${h.note} ${h.threadFirstLine ?? ""}`.toLowerCase();
        if (!haystack.includes(needle)) continue;
      }
      set.add(h.id);
    }
    return set;
  }, [data, filterKind, filterTag, filterTheme, searchText, filtersActive]);

  if (notFound) {
    return (
      <div className={`${styles.page} register-glass`}>
        <p>That book isn't in the library.</p>
        <button type="button" className={styles.backButton} onClick={onClose}>
          Close
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={`${styles.page} register-glass`}>
        <div className={styles.loading}>Loading scan…</div>
      </div>
    );
  }

  const maxChapterLength = Math.max(0.0001, ...data.chapters.map((c) => c.lengthPercent));

  return (
    <div className={`${styles.page} register-glass`}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>{data.resource.title}</h1>
          <div className={styles.subtitle}>
            {data.resource.author ?? "Unknown"} — instrument view
          </div>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.backButton}
            onClick={() => setSpotlightOpen((v) => !v)}
            aria-pressed={spotlightOpen}
          >
            Digest…
          </button>
          <Link to={`/digest/${id}`} className={styles.backButton}>
            Read digest
          </Link>
          <button type="button" className={styles.backButton} onClick={handleOpenReader}>
            ← Book
          </button>
        </div>
      </div>

      {/* M18 "one filter, one wrapper" (decisions.md 2026-07-28/2026-07-29):
          everything below the header — spotlight, readouts, filters, the
          strip, the revisit queue — is the base scan screen, and it warps
          as one continuous surface. The header itself stays outside: it's
          chrome (title, escape hatches) rather than the instrument glass,
          and keeping "← Book" at its exact raw position is worth more than
          strict completeness here — SPEC-GAP, see NOTES.md "M18". */}
      <div
        ref={warpWrapperRef}
        className={warpActive ? `${styles.warpWrapper} ${styles.wobbling}` : styles.warpWrapper}
        style={warpActive ? { filter: `url(#${warpFilterId})` } : undefined}
      >
        {spotlightOpen && (
          <DigestSpotlight
            resourceId={id}
            chapters={data.chapters}
            onClose={() => setSpotlightOpen(false)}
            warpGeometry={warpGeometry}
            warpWrapperRef={warpWrapperRef}
          />
        )}

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

        {/* M19.5 "the semantic scan: two layers" (decisions.md 2026-07-29
            later): Mine/Book are independent on/off toggles ("filter to
            either or show both"), and the theme dropdown is the one
            vocabulary shared by both — selecting a theme lights matching
            regions in each layer, never just one. A book with no digest at
            all falls back to kind mode with an explanation rather than an
            empty theme dropdown (decisions.md's explicit acceptance line). */}
        <div className={styles.filters}>
          <div className={styles.kindToggle} role="group" aria-label="Scan layers">
            <button
              type="button"
              className={showMineLayer ? `${styles.kindAllButton} ${styles.kindAllButtonActive}` : styles.kindAllButton}
              aria-pressed={showMineLayer}
              onClick={() => setShowMineLayer((v) => !v)}
            >
              Mine
            </button>
            <button
              type="button"
              className={showBookLayer ? `${styles.kindAllButton} ${styles.kindAllButtonActive}` : styles.kindAllButton}
              aria-pressed={showBookLayer}
              disabled={!data.book.hasDigest}
              onClick={() => setShowBookLayer((v) => !v)}
            >
              Book
            </button>
          </div>

          {data.book.hasDigest ? (
            data.book.themeVocabulary.length > 0 && (
              <select
                className={styles.tagSelect}
                value={filterTheme ?? ""}
                onChange={(e) => setFilterTheme(e.target.value || null)}
                aria-label="Filter by theme"
              >
                <option value="">All themes</option>
                {data.book.themeVocabulary.map((theme) => (
                  <option key={theme} value={theme}>
                    {theme}
                  </option>
                ))}
              </select>
            )
          ) : (
            <span className={styles.emptyState}>
              No book digest yet — theme mode needs one. Kind mode is unaffected.
            </span>
          )}
        </div>

        <div className={styles.stripSection}>
          {data.highlights.length === 0 && !data.book.hasDigest ? (
            <div className={styles.emptyState}>No highlights yet — read a passage and ask a question.</div>
          ) : (
            <HeatStrip
              chapters={data.chapters}
              highlights={data.highlights}
              litIds={litIds}
              showMineLayer={showMineLayer}
              bookChapters={data.book.chapters}
              showBookLayer={showBookLayer && data.book.hasDigest}
              litTheme={filterTheme}
              onOpenChapter={handleOpenChapter}
              warpGeometry={warpGeometry}
              warpWrapperRef={warpWrapperRef}
              onOpen={handleOpenHighlight}
              onImportanceChange={handleImportanceChange}
              onTagsChange={handleTagsChange}
            />
          )}
        </div>

        <RevisitQueue highlights={data.highlights} onOpen={handleOpenHighlight} />

        {warpActive && <VhsOverlay intensity={crtIntensity} />}
        {warpActive && <div className={styles.vignette} style={{ opacity: 0.12 + crtIntensity * 0.28 }} />}
      </div>

      {warpActive && (
        <ScanWarpFilter id={warpFilterId} width={warpSize.width} height={warpSize.height} intensity={crtIntensity} />
      )}
    </div>
  );
}
