import { useEffect, useId, useMemo, useRef, useState, type MouseEvent } from "react";
import { useLocation, useNavigate, type Location } from "react-router-dom";
import { useReducedMotion } from "motion/react";
import type {
  CursorStyleChoice,
  HighlightImportance,
  HighlightKind,
  ScanData,
  ScanHighlight,
  SearchHit,
  SearchMatchMode,
} from "@marginalia/shared";
import { captureOverlayOrigin, setPendingOverlayOrigin } from "../controls/overlayOrigin.js";
import { updateHighlightImportance, updateHighlightTags } from "../highlights/highlightMeta.js";
import { DEFAULT_KIND_LABELS, kindLabelsFromSettings } from "../reader/highlightKinds.js";
import { onSettingsSaved } from "../settings/settingsBus.js";
import { SHORTCUT_KEYS } from "../shortcuts/keys.js";
import { useShortcuts } from "../shortcuts/useShortcuts.js";
import { stepFindCursor } from "../search/findCursor.js";
import { useSearchHits } from "../search/useSearchHits.js";
import { DigestSpotlight } from "./DigestSpotlight.js";
import { HeatStrip } from "./HeatStrip.js";
import { RevisitQueue } from "./RevisitQueue.js";
import { KIND_ORDER, phosphorHue } from "./scanPalette.js";
import { ScanWarpFilter } from "./ScanWarpFilter.js";
import { VhsOverlay } from "./VhsOverlay.js";
import { activeThemeNames, type ThemeSelection } from "./themeFilter.js";
import { ThemeFilterKey } from "./ThemeFilterKey.js";
import { computeWarpGeometry } from "./warp.js";
import styles from "./ScanPage.module.css";

async function fetchScanCursorSettings(): Promise<{
  crtIntensity: number;
  cursorStyle: CursorStyleChoice;
  kindLabels: Record<HighlightKind, string>;
}> {
  const fallback = { crtIntensity: 0.6, cursorStyle: "custom" as const, kindLabels: DEFAULT_KIND_LABELS };
  try {
    const res = await fetch("/api/settings");
    if (!res.ok) return fallback;
    const settings = (await res.json()) as {
      scanCrtIntensity: number;
      cursorStyle: CursorStyleChoice;
      kindLabelRose: string;
      kindLabelSage: string;
      kindLabelHoney: string;
      kindLabelSlate: string;
    };
    return {
      crtIntensity: settings.scanCrtIntensity,
      cursorStyle: settings.cursorStyle,
      kindLabels: kindLabelsFromSettings(settings),
    };
  } catch {
    return fallback;
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
  /** M24: the reader find bar's "see in Scan" handoff — seeds the search
   * field and jumps the cursor to the same hit once results resolve, so the
   * two surfaces agree on query, hit count and cursor from the first frame
   * (TASKS.md M24 A acceptance). */
  initialQuery?: string;
  initialCursorHitIndex?: number;
  /** M24.1 C: the matching rule the handed-off result set was produced
   * with — arriving with the query so both surfaces count the same set. */
  initialMatchMode?: SearchMatchMode;
}

/**
 * The Scan (M9, DESIGN.md Room 3): the book laid flat as data. Loads
 * without touching epub.js — every position is server-computed
 * (server/src/annotations/scan.ts) from the same anchoring rule the reader
 * uses, so the strip renders instantly even for a book that's never been
 * opened this session.
 */
export function ScanPage({
  resourceId: id,
  onClose,
  initialQuery,
  initialCursorHitIndex,
  initialMatchMode,
}: ScanPageProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const reducedMotion = Boolean(useReducedMotion());

  const [data, setData] = useState<ScanData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [filterKind, setFilterKind] = useState<HighlightKind | null>(null);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  // M24.5 §4: a book-level or specific theme selection — activeThemeNames()
  // expands either into the set of specific theme names both layers below
  // actually filter against, so this component never has to branch on which
  // case it is past this one point.
  const [themeSelection, setThemeSelection] = useState<ThemeSelection>(null);
  // M24 C: "the search field becomes the Scan's primary control" — one text
  // box, wired to the same server-side search the reader's find bar uses
  // (useSearchHits), still composing with the kind/tag/theme filters below
  // exactly as the old client-side substring match did (see `litIds`).
  const [searchText, setSearchText] = useState(initialQuery ?? "");
  // M24.1 C: whole words by default here too — one rule, named on both
  // surfaces, arriving with a handoff rather than being re-chosen.
  const [matchMode, setMatchMode] = useState<SearchMatchMode>(initialMatchMode ?? "word");
  const { hits: searchHits, loading: searchLoading } = useSearchHits(
    searchText.trim() ? id : null,
    searchText,
    matchMode,
  );
  const [searchCursorIndex, setSearchCursorIndex] = useState(-1);
  useEffect(() => {
    setSearchCursorIndex(-1);
  }, [searchHits]);
  // M24 A/C: the reader find bar's own handoff — consumed once, the same
  // "captured once at mount" story as ReaderPage's initialLocationState.
  const initialCursorConsumedRef = useRef(false);
  useEffect(() => {
    if (initialCursorHitIndex === undefined || initialCursorConsumedRef.current) return;
    if (searchHits.length === 0) return;
    initialCursorConsumedRef.current = true;
    setSearchCursorIndex(Math.min(initialCursorHitIndex, searchHits.length - 1));
  }, [searchHits, initialCursorHitIndex]);
  const searchHitHighlightIds = useMemo(
    () => new Set(searchHits.map((h) => h.highlightId).filter((hid): hid is string => hid !== null)),
    [searchHits],
  );
  const [crtIntensity, setCrtIntensity] = useState(0.6);
  const [cursorStyle, setCursorStyle] = useState<CursorStyleChoice>("custom");
  const [kindLabels, setKindLabels] = useState<Record<HighlightKind, string>>(DEFAULT_KIND_LABELS);
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
    fetchScanCursorSettings().then(({ crtIntensity, cursorStyle, kindLabels }) => {
      setCrtIntensity(crtIntensity);
      setCursorStyle(cursorStyle);
      setKindLabels(kindLabels);
    });
    return onSettingsSaved((settings) => {
      setCrtIntensity(settings.scanCrtIntensity);
      setCursorStyle(settings.cursorStyle);
      setKindLabels(kindLabelsFromSettings(settings));
    });
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

  // M20.5 "the Digest becomes a popup too": swaps to the Digest instrument
  // over the *same* background room rather than stacking Digest-over-Scan
  // — peer instruments, not nested ones (mirrors DigestPage's identical
  // "← Scan" swap in the other direction).
  function handleOpenDigest(event: MouseEvent<HTMLElement>) {
    const background = (location.state as { background?: Location } | null)?.background ?? location;
    setPendingOverlayOrigin(captureOverlayOrigin(event.currentTarget));
    navigate(`/digest/${id}`, { state: { background } });
  }

  function handleOpenHighlight(highlight: ScanHighlight) {
    navigate(`/read/${id}`, { state: { jumpToHighlightId: highlight.id } });
  }

  // M24 C: the search cursor steps inside the Scan; Enter is what opens the
  // reader (decisions.md 2026-08-14 point 4 — stepping never drives the
  // reader live underneath). Goes through `jumpToFindQuery`/
  // `jumpToFindHitIndex` rather than `jumpToHighlightId`: a "text" source
  // hit has no highlight to jump to at all, and this way the reader lands
  // on the exact same ordered hit either kind produces.
  function handleStepSearchCursor(direction: "next" | "prev") {
    setSearchCursorIndex((prev) => stepFindCursor(prev, searchHits.length, direction));
  }

  function handleOpenSearchHit(_hit: SearchHit) {
    navigate(`/read/${id}`, {
      state: {
        jumpToFindQuery: searchText.trim(),
        jumpToFindHitIndex: searchCursorIndex,
        jumpToFindMatchMode: matchMode,
      },
    });
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
    filterKind !== null || filterTag !== null || themeSelection !== null || searchText.trim() !== "";

  const litThemes = useMemo(
    () => activeThemeNames(themeSelection, data?.book.bookThemes ?? []),
    [themeSelection, data],
  );

  // M24 C: the query half moved server-side (searchHitHighlightIds, above)
  // — full thread bodies and notes are searched there now, not just
  // threadFirstLine — but composes with kind/tag/theme exactly as it did
  // when it was a local substring match (TASKS.md acceptance).
  const litIds = useMemo(() => {
    if (!data || !filtersActive) return null;
    const hasQuery = searchText.trim() !== "";
    const set = new Set<string>();
    for (const h of data.highlights) {
      if (filterKind && h.kind !== filterKind) continue;
      if (filterTag && !h.tags.includes(filterTag)) continue;
      if (litThemes && !h.themes.some((t) => litThemes.includes(t))) continue;
      if (hasQuery && !searchHitHighlightIds.has(h.id)) continue;
      set.add(h.id);
    }
    return set;
  }, [data, filterKind, filterTag, litThemes, searchText, searchHitHighlightIds, filtersActive]);

  const pageClassName = `${styles.page} register-glass${
    cursorStyle === "system" ? ` ${styles.systemCursor}` : ""
  }`;

  if (notFound) {
    return (
      <div className={pageClassName}>
        <p>That book isn't in the library.</p>
        <button type="button" className={styles.backButton} onClick={onClose}>
          Close
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={pageClassName}>
        <div className={styles.loading}>Loading scan…</div>
      </div>
    );
  }

  const maxChapterLength = Math.max(0.0001, ...data.chapters.map((c) => c.lengthPercent));

  return (
    <div className={pageClassName}>
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
          <button type="button" className={styles.backButton} onClick={handleOpenDigest}>
            Read digest
          </button>
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
          <DigestSpotlight resourceId={id} chapters={data.chapters} onClose={() => setSpotlightOpen(false)} />
        )}

        {/* M24 C: the Scan's primary control — searches the book's own text
            as well as annotations (the server does both now), composing
            with the kind/tag/theme filters below exactly as the old local
            substring match did. */}
        <div className={styles.searchRow}>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search the book and your annotations…"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            aria-label="Search the book and your annotations"
          />
          <span className={styles.searchStatus} aria-live="polite">
            {searchText.trim() === ""
              ? ""
              : searchLoading
                ? "Searching…"
                : `${searchHits.length} result${searchHits.length === 1 ? "" : "s"}`}
          </span>
          {/* M24.1 C: "whichever is chosen, say it in the UI." */}
          <label className={styles.searchRule}>
            <input
              type="checkbox"
              checked={matchMode === "word"}
              onChange={(e) => setMatchMode(e.target.checked ? "word" : "substring")}
            />
            Whole word
          </label>
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
                title={kindLabels[kind]}
                aria-label={`Filter by ${kindLabels[kind]}`}
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
              <ThemeFilterKey
                bookThemes={data.book.bookThemes}
                themeVocabulary={data.book.themeVocabulary}
                selection={themeSelection}
                onSelectionChange={setThemeSelection}
              />
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
              litThemes={litThemes}
              onOpenChapter={handleOpenChapter}
              warpGeometry={warpGeometry}
              warpWrapperRef={warpWrapperRef}
              onOpen={handleOpenHighlight}
              onImportanceChange={handleImportanceChange}
              onTagsChange={handleTagsChange}
              searchHits={searchHits}
              searchCursorIndex={searchCursorIndex}
              onStepSearchCursor={handleStepSearchCursor}
              onOpenSearchHit={handleOpenSearchHit}
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
