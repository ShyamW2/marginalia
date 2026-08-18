import { useState, type CSSProperties } from "react";
import type { ScanBookTheme } from "@marginalia/shared";
import { themePhosphorHue } from "./scanPalette.js";
import type { ThemeSelection } from "./themeFilter.js";
import styles from "./ThemeFilterKey.module.css";

interface ThemeFilterKeyProps {
  bookThemes: ScanBookTheme[];
  themeVocabulary: string[];
  selection: ThemeSelection;
  onSelectionChange: (next: ThemeSelection) => void;
}

/**
 * M24.5 §4: the Scan's theme filter as a colour-keyed, toggleable legend —
 * one chip per book-level theme, with its specific/chapter-level themes
 * reachable underneath via a disclosure toggle. Falls back to today's flat
 * dropdown when no distillation has run yet (`bookThemes` empty) — the same
 * "a book with no digest still shows a coherent Scan" fallback spirit
 * TASKS.md's acceptance line asks for, extended one step earlier.
 */
export function ThemeFilterKey({
  bookThemes,
  themeVocabulary,
  selection,
  onSelectionChange,
}: ThemeFilterKeyProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (bookThemes.length === 0) {
    return (
      <select
        className={styles.fallbackSelect}
        value={selection?.kind === "specific" ? selection.name : ""}
        onChange={(e) =>
          onSelectionChange(e.target.value ? { kind: "specific", name: e.target.value } : null)
        }
        aria-label="Filter by theme"
      >
        <option value="">All themes</option>
        {themeVocabulary.map((theme) => (
          <option key={theme} value={theme}>
            {theme}
          </option>
        ))}
      </select>
    );
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className={styles.key} role="group" aria-label="Filter by theme">
      {bookThemes.map((theme) => {
        const isSelected = selection?.kind === "book" && selection.id === theme.id;
        const isExpanded = expanded.has(theme.id);
        return (
          <div key={theme.id} className={styles.entry}>
            <button
              type="button"
              className={isSelected ? `${styles.chip} ${styles.chipActive}` : styles.chip}
              style={{ "--chip-color": themePhosphorHue(theme.colorIndex) } as CSSProperties}
              aria-pressed={isSelected}
              onClick={() => onSelectionChange(isSelected ? null : { kind: "book", id: theme.id })}
            >
              <span className={styles.swatch} aria-hidden="true" />
              {theme.name}
            </button>
            {theme.children.length > 0 && (
              <button
                type="button"
                className={styles.disclosure}
                aria-expanded={isExpanded}
                aria-label={`${isExpanded ? "Hide" : "Show"} specific themes under ${theme.name}`}
                onClick={() => toggleExpanded(theme.id)}
              >
                {isExpanded ? "−" : "+"}
              </button>
            )}
            {isExpanded && (
              <div className={styles.children}>
                {theme.children.map((child) => {
                  const childSelected = selection?.kind === "specific" && selection.name === child;
                  return (
                    <button
                      key={child}
                      type="button"
                      className={
                        childSelected ? `${styles.childChip} ${styles.childChipActive}` : styles.childChip
                      }
                      aria-pressed={childSelected}
                      onClick={() =>
                        onSelectionChange(childSelected ? null : { kind: "specific", name: child })
                      }
                    >
                      {child}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
