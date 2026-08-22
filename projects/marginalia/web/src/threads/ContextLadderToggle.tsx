import { useEffect, useState } from "react";
import type { ContextLadderDepth } from "@marginalia/shared";
import { Button } from "../controls/Button.js";
import { IconButton } from "../controls/IconButton.js";
import { GlobeIcon } from "../controls/icons.js";
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

  useEffect(() => {
    let cancelled = false;
    fetchDepth(resourceId).then((d) => {
      if (!cancelled) setDepth(d);
    });
    return () => {
      cancelled = true;
    };
  }, [resourceId]);

  function handleSelect(next: ContextLadderDepth) {
    setDepth(next);
    void putDepth(resourceId, next);
  }

  if (depth === null) return null;

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
      <IconButton
        icon={<GlobeIcon size={16} />}
        label="Web search — coming in a later milestone"
        variant="outline"
        size="sm"
        className={styles.webSearchIcon}
        disabled
      />
    </div>
  );
}
