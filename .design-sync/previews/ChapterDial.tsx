import { useState } from "react";
import { ChapterDial } from "@marginalia/web";

/* The Scan's dark-native scope (ScanPage.module.css `.page`) plus the glass
   register — see CrtBezel's preview for why a Scan card reproduces both. */
const scanScope: React.CSSProperties = {
  ["--color-bg" as string]: "#05070a",
  ["--color-bg-raised" as string]: "#0d1318",
  ["--color-text" as string]: "#cfeeff",
  ["--color-text-muted" as string]: "rgba(207, 238, 255, 0.6)",
  ["--color-border" as string]: "rgba(140, 220, 255, 0.25)",
  ["--color-accent" as string]: "#5ec8ff",
  ["--color-accent-text" as string]: "#04141c",
  ["--color-highlight" as string]: "rgba(94, 200, 255, 0.15)",
  ["--color-highlight-active" as string]: "rgba(94, 200, 255, 0.3)",
  ["--font-mono" as string]: 'ui-monospace, "SF Mono", "Cascadia Code", monospace',
  background: "var(--color-bg)",
  color: "var(--color-text)",
  padding: 18,
  borderRadius: 10,
};

/* ScanChapter percents are fractions (0–1) in the schema, not 0–100.
   "S<n> is the only number that appears in any UI" — chapters carry a section
   ordinal, a start percent and a length, which is what the dial steps over. */
const chapters = [
  { title: "Preface", spineIndex: 0, chapterNumber: 0, startPercent: 0, lengthPercent: 0.06 },
  { title: "What Knowing Feels Like", spineIndex: 1, chapterNumber: 1, startPercent: 0.06, lengthPercent: 0.15 },
  { title: "The Curse of Fluency", spineIndex: 2, chapterNumber: 2, startPercent: 0.21, lengthPercent: 0.13 },
  { title: "The Illusion of Explanatory Depth", spineIndex: 3, chapterNumber: 3, startPercent: 0.34, lengthPercent: 0.18 },
  { title: "Desirable Difficulty", spineIndex: 4, chapterNumber: 4, startPercent: 0.52, lengthPercent: 0.16 },
  { title: "Interleaving", spineIndex: 5, chapterNumber: 5, startPercent: 0.68, lengthPercent: 0.23 },
];

/** The dial the Digest steps over sections with. Its unit is a whole section,
 *  never a fraction of one — `value` is an index into `chapters`. */
export function Sections() {
  const [value, setValue] = useState(3);
  return (
    <div className="register-glass" style={scanScope}>
      <ChapterDial label="Digest section" chapters={chapters} value={value} onCommit={setValue} />
    </div>
  );
}

/** At the first section, where stepping backward has nowhere to go. */
export function AtStart() {
  const [value, setValue] = useState(0);
  return (
    <div className="register-glass" style={scanScope}>
      <ChapterDial label="Digest section" chapters={chapters} value={value} onCommit={setValue} />
    </div>
  );
}

/** `disabled` — the book has no digest yet, so there is nothing to step over. */
export function Disabled() {
  return (
    <div className="register-glass" style={scanScope}>
      <ChapterDial label="Digest section" chapters={chapters} value={2} onCommit={() => {}} disabled />
    </div>
  );
}
