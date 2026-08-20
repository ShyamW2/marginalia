import { ProgressPopover } from "@marginalia/web";

/* ProgressPopover is the readout that appears over the reader's progress bar.
   The stage gives it a paper ground to sit on, as it has in the Book. */
const stage: React.CSSProperties = {
  position: "relative",
  padding: "18px 26px",
  borderRadius: 10,
  background: "var(--color-bg)",
};

/** Mid-book: percent, page-of-total, and the chapter you're in. */
export function MidBook() {
  return (
    <div style={stage}>
      <ProgressPopover percent={36} page={148} totalPages={412} chapterLabel="III · The Illusion of Explanatory Depth" />
    </div>
  );
}

/** The opening page — 0% and a short chapter label. */
export function Opening() {
  return (
    <div style={stage}>
      <ProgressPopover percent={0} page={1} totalPages={412} chapterLabel="Preface" />
    </div>
  );
}

/** The end of the book, where the percent and the page count agree. */
export function Finished() {
  return (
    <div style={stage}>
      <ProgressPopover percent={100} page={412} totalPages={412} chapterLabel="Afterword" />
    </div>
  );
}
