import { useEffect, useState } from "react";
import type { ContextLadderDepth } from "@marginalia/shared";
import { Button } from "../controls/Button.js";
import { IconButton } from "../controls/IconButton.js";
import { EyeIcon, GlobeIcon } from "../controls/icons.js";
import styles from "./ContextLadderToggle.module.css";

const DEPTHS: { value: ContextLadderDepth; label: string; title: string }[] = [
  { value: "off", label: "Off", title: "Passage + surrounding pages only — cheapest" },
  { value: "digest", label: "Digest", title: "Book digest + surrounding pages — best answers per token" },
  { value: "full", label: "Full", title: "Whole book — maximum fidelity, maximum cost" },
];

async function fetchDepth(resourceId: string): Promise<ContextLadderDepth | null> {
  try {
    const res = await fetch(`/api/resources/${resourceId}/context-ladder`);
    if (!res.ok) return null;
    const body = (await res.json()) as { depth: ContextLadderDepth };
    return body.depth;
  } catch {
    return null;
  }
}

async function putDepth(resourceId: string, depth: ContextLadderDepth): Promise<void> {
  await fetch(`/api/resources/${resourceId}/context-ladder`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ depth }),
  }).catch(() => {
    // best-effort — the next question just re-resolves the default server-side
  });
}

// M34 §B5/§B6: the lookahead/spoilers toggle — independent of depth above,
// same fetch/put shape.
async function fetchLookahead(resourceId: string): Promise<boolean | null> {
  try {
    const res = await fetch(`/api/resources/${resourceId}/lookahead`);
    if (!res.ok) return null;
    const body = (await res.json()) as { enabled: boolean };
    return body.enabled;
  } catch {
    return null;
  }
}

async function putLookahead(resourceId: string, enabled: boolean): Promise<void> {
  await fetch(`/api/resources/${resourceId}/lookahead`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  }).catch(() => {
    // best-effort, same as putDepth above
  });
}

// M35 §C7: the thematic-quotes show/hide toggle — same fetch/put shape as
// lookahead above, its own independent setting.
async function fetchShowThematicQuotes(resourceId: string): Promise<boolean | null> {
  try {
    const res = await fetch(`/api/resources/${resourceId}/show-thematic-quotes`);
    if (!res.ok) return null;
    const body = (await res.json()) as { enabled: boolean };
    return body.enabled;
  } catch {
    return null;
  }
}

async function putShowThematicQuotes(resourceId: string, enabled: boolean): Promise<void> {
  await fetch(`/api/resources/${resourceId}/show-thematic-quotes`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  }).catch(() => {
    // best-effort, same as putDepth above
  });
}

/**
 * M17 "the context ladder (the brain button)": Off / Digest / Full,
 * remembered per book (decisions.md 2026-07-28 later). Lives in the
 * composer since that's this app's only per-question point of contact,
 * even though the setting itself is book-wide, not per-thread — switching
 * it here changes every highlight's next question on this book, not just
 * this one.
 */
export function ContextLadderToggle({ resourceId }: { resourceId: string }) {
  const [depth, setDepth] = useState<ContextLadderDepth | null>(null);
  const [lookahead, setLookahead] = useState<boolean | null>(null);
  const [showThematicQuotes, setShowThematicQuotes] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDepth(resourceId).then((d) => {
      if (!cancelled) setDepth(d);
    });
    fetchLookahead(resourceId).then((enabled) => {
      if (!cancelled) setLookahead(enabled);
    });
    fetchShowThematicQuotes(resourceId).then((enabled) => {
      if (!cancelled) setShowThematicQuotes(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, [resourceId]);

  function handleSelect(next: ContextLadderDepth) {
    setDepth(next);
    void putDepth(resourceId, next);
  }

  function handleToggleLookahead() {
    setLookahead((prev) => {
      const next = !prev;
      void putLookahead(resourceId, next);
      return next;
    });
  }

  function handleToggleShowThematicQuotes() {
    setShowThematicQuotes((prev) => {
      const next = !prev;
      void putShowThematicQuotes(resourceId, next);
      return next;
    });
  }

  if (depth === null) return null;

  const lookaheadTitle = lookahead
    ? "Lookahead is on — no chapter is masked as a spoiler"
    : "Lookahead is off — chapters past your bookmark are masked as spoilers";

  return (
    <div className={styles.row}>
      {/* M24.7 §F: two renderings of the same three depths, one CSS
          `@container composer-controls` swap between them (READER_REDESIGN.md's
          resolved narrow table) — no JS width measurement, the established
          convention since §C. Wide: the segmented group. Below the fit
          threshold (measured, not the doc's own "~300px" — see
          ContextLadderToggle.module.css): a native `<select>`, which is what
          "buys the width that keeps Ask legible" actually means for a
          control this narrow. */}
      <div className={styles.toggle} role="group" aria-label="Context depth">
        {DEPTHS.map((d) => (
          <Button
            key={d.value}
            variant="ghost"
            size="sm"
            className={styles.button}
            pressed={depth === d.value}
            title={d.title}
            onClick={() => handleSelect(d.value)}
          >
            {d.label}
          </Button>
        ))}
      </div>
      <select
        aria-label="Context depth"
        className={styles.ladderSelect}
        value={depth}
        onChange={(event) => handleSelect(event.target.value as ContextLadderDepth)}
      >
        {DEPTHS.map((d) => (
          <option key={d.value} value={d.value} title={d.title}>
            {d.label}
          </option>
        ))}
      </select>
      {/* M23 "web search" — present but inert per decisions.md 2026-07-28
          (later): a second cloud dependency, off by default, never silently
          on, and deliberately out of scope until M25 builds the seam
          (renumbered from M23, settled decision 10). Restyled to a globe
          icon below the fit threshold (grounding note 6: "restyled, still disabled,
          still titled as coming later") — same dual-render, same reason. */}
      <Button
        variant="outline"
        size="sm"
        className={styles.webSearchPill}
        disabled
        title="Web search — coming in a later milestone"
      >
        Web search
      </Button>
      {/* M34 §B6: same register as the ladder above, its own control — a
          word, not a sentence ("Lookahead"), with the sentence in the
          title. Wide/narrow dual-render matches the web-search pill/icon
          pair this sits beside. */}
      {lookahead !== null && (
        <>
          <Button
            variant="outline"
            size="sm"
            className={styles.lookaheadPill}
            pressed={lookahead}
            title={lookaheadTitle}
            onClick={handleToggleLookahead}
          >
            Lookahead
          </Button>
          <IconButton
            icon={<EyeIcon size={16} />}
            label={lookaheadTitle}
            variant="outline"
            size="sm"
            className={styles.lookaheadIcon}
            pressed={lookahead}
            onClick={handleToggleLookahead}
          />
        </>
      )}
      <IconButton
        icon={<GlobeIcon size={16} />}
        label="Web search — coming in a later milestone"
        variant="outline"
        size="sm"
        className={styles.webSearchIcon}
        disabled
      />
      {/* M35 §C7: "only my own marks" is the reasonable default — off unless
          the reader opts in. Same wide/narrow dual-render as lookahead. */}
      {showThematicQuotes !== null && (
        <>
          <Button
            variant="outline"
            size="sm"
            className={styles.lookaheadPill}
            pressed={showThematicQuotes}
            title={
              showThematicQuotes
                ? "Showing the thematic pass's proposed quotes in the text"
                : "Thematic quotes are hidden — only your own marks show"
            }
            onClick={handleToggleShowThematicQuotes}
          >
            Thematic quotes
          </Button>
          <IconButton
            icon="“"
            label={
              showThematicQuotes
                ? "Showing the thematic pass's proposed quotes in the text"
                : "Thematic quotes are hidden — only your own marks show"
            }
            variant="outline"
            size="sm"
            className={styles.lookaheadIcon}
            pressed={showThematicQuotes}
            onClick={handleToggleShowThematicQuotes}
          />
        </>
      )}
    </div>
  );
}
