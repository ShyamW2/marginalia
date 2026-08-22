import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { SearchHit, SearchMatchMode } from "@marginalia/shared";
import { Button } from "../controls/Button.js";
import { IconButton } from "../controls/IconButton.js";
import styles from "./FindBar.module.css";

interface FindBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  hits: SearchHit[];
  currentIndex: number;
  loading: boolean;
  onStep: (direction: "next" | "prev") => void;
  onClose: () => void;
  onSeeInScan: () => void;
  /** M24.1 D: the result card — a second *view* of these same hits, opened
   * from here because this is where the result set lives. */
  resultsOpen: boolean;
  onToggleResults: () => void;
  /** M24.1 C: which matching rule is in force. Shown, not implied — a
   * reader who searches "the" and gets two marks instead of forty is owed
   * the reason on screen. */
  matchMode: SearchMatchMode;
  onMatchModeChange: (mode: SearchMatchMode) => void;
  /** Bumped by the reader every time Cmd/Ctrl+F fires — re-focuses and
   * re-selects the field even when the bar was already open, matching a
   * native find bar's "press it again to jump back into the field". */
  focusToken: number;
}

/**
 * Cmd+F's find pebble (TASKS.md M24 A, floated in M24.7 §E). A direct child
 * of `.stage` — like AskPill, ThreadPanel and SearchResultsCard — rather
 * than chrome living inside `.topRow`, which is what "floating over the
 * page" costs: it no longer inherits `useFullscreenChrome`'s proximity
 * reveal for free (READER_REDESIGN.md's own warning that this needs an
 * explicit fullscreen behaviour). The explicit behaviour is the simplest
 * one — it ignores fullscreen's reveal/dim state entirely and stays fully
 * visible for as long as `findOpen` is true, on the theory that a reader who
 * deliberately pressed Cmd+F shouldn't have the tool they just asked for
 * play hide-and-seek with the pointer.
 */
export function FindBar({
  query,
  onQueryChange,
  hits,
  currentIndex,
  loading,
  onStep,
  onClose,
  onSeeInScan,
  resultsOpen,
  onToggleResults,
  matchMode,
  onMatchModeChange,
  focusToken,
}: FindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const statusId = useId();
  const wholeWordId = useId();
  const reducedMotion = Boolean(useReducedMotion());

  // Opening (or re-opening) the bar always hands focus straight to the
  // field, selection included — the same "just start typing" a native find
  // bar gives you, and what lets a second Cmd+F re-focus an already-open bar
  // (the component itself doesn't remount then, so this needs the token).
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusToken]);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      onStep(event.shiftKey ? "prev" : "next");
    } else if (event.key === "Escape") {
      // Also caught by the reader's own Escape shortcut, but stopping
      // propagation here keeps a bare Escape from doing double duty (closing
      // the bar *and* whatever else Escape clears in the reader underneath).
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }

  const trimmed = query.trim();
  const statusLabel =
    trimmed.length === 0
      ? ""
      : loading
        ? "Searching…"
        : hits.length === 0
          ? "No results"
          : currentIndex < 0
            ? `${hits.length} result${hits.length === 1 ? "" : "s"}`
            : `${currentIndex + 1} of ${hits.length}`;

  return (
    <div className={styles.pebbleAnchor}>
      <motion.div
        className={styles.pebble}
        role="search"
        initial={{ opacity: 0, y: reducedMotion ? 0 : -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: reducedMotion ? 0 : -6 }}
        transition={{ duration: reducedMotion ? 0.001 : 0.14, ease: "easeOut" }}
      >
        <input
          ref={inputRef}
          type="text"
          className={styles.input}
          placeholder="Find in book…"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Find in book"
          aria-describedby={statusId}
        />
        <span id={statusId} className={styles.count} aria-live="polite" aria-atomic="true">
          {statusLabel}
        </span>
        <IconButton
          icon="‹"
          label="Previous match"
          size="sm"
          disabled={hits.length === 0}
          onClick={() => onStep("prev")}
        />
        <IconButton
          icon="›"
          label="Next match"
          size="sm"
          disabled={hits.length === 0}
          onClick={() => onStep("next")}
        />
        {/* M24.1 C: "whichever is chosen, say it in the UI." */}
        <label className={styles.wholeWord} htmlFor={wholeWordId}>
          <input
            id={wholeWordId}
            type="checkbox"
            checked={matchMode === "word"}
            onChange={(event) => onMatchModeChange(event.target.checked ? "word" : "substring")}
          />
          Whole word
        </label>
        <Button
          variant="ghost"
          size="sm"
          className={styles.scanButton}
          aria-pressed={resultsOpen}
          disabled={trimmed.length === 0}
          onClick={onToggleResults}
        >
          {resultsOpen ? "Hide list" : "List"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={styles.scanButton}
          disabled={trimmed.length === 0}
          onClick={onSeeInScan}
        >
          See in Scan
        </Button>
        <IconButton icon="×" label="Close find" size="sm" onClick={onClose} />
      </motion.div>
    </div>
  );
}
