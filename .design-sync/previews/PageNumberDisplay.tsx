import { PageNumberDisplay } from "@marginalia/web";

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: "8px 0",
  font: "400 12px var(--font-sans)",
  color: "var(--color-text-muted)",
};

/** The reader's footer readout. `mode` is a reader preference, not a state:
 *  "book" counts the whole book, "chapter" counts within the current one,
 *  "off" renders nothing at all. */
export function Modes() {
  return (
    <div>
      <div style={row}>
        <PageNumberDisplay mode="book" bookPage={148} bookTotal={412} chapterPage={12} chapterTotal={31} />
        <span>mode="book"</span>
      </div>
      <div style={row}>
        <PageNumberDisplay mode="chapter" bookPage={148} bookTotal={412} chapterPage={12} chapterTotal={31} />
        <span>mode="chapter"</span>
      </div>
      <div style={row}>
        <PageNumberDisplay mode="off" bookPage={148} bookTotal={412} chapterPage={12} chapterTotal={31} />
        <span>mode="off" — renders nothing</span>
      </div>
    </div>
  );
}

/** First and last page, so the number formatting is legible at both ends. */
export function Extremes() {
  return (
    <div>
      <div style={row}>
        <PageNumberDisplay mode="book" bookPage={1} bookTotal={412} chapterPage={1} chapterTotal={18} />
        <span>opening page</span>
      </div>
      <div style={row}>
        <PageNumberDisplay mode="book" bookPage={412} bookTotal={412} chapterPage={9} chapterTotal={9} />
        <span>final page</span>
      </div>
    </div>
  );
}
