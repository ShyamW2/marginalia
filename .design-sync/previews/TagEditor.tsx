import { useState } from "react";
import { TagEditor } from "@marginalia/web";

const frame: React.CSSProperties = {
  maxWidth: 380,
  padding: 12,
  borderRadius: 10,
  background: "var(--color-bg-raised)",
  border: "1px solid var(--color-border)",
};

const caption: React.CSSProperties = {
  margin: "0 0 8px",
  font: "500 12px var(--font-sans)",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--color-text-muted)",
};

/** Tags as they appear on a highlight — concept names that become links in
 *  the compiled vault, not free-form labels. */
export function WithTags() {
  const [tags, setTags] = useState(["attention", "memory", "spaced-repetition"]);
  return (
    <div style={frame}>
      <p style={caption}>Tags</p>
      <TagEditor tags={tags} onChange={setTags} />
    </div>
  );
}

/** The empty state carries the placeholder — this is what an unread
 *  highlight's tag row looks like before anything is distilled from it. */
export function Empty() {
  const [tags, setTags] = useState<string[]>([]);
  return (
    <div style={frame}>
      <p style={caption}>Tags</p>
      <TagEditor tags={tags} onChange={setTags} placeholder="Add a concept…" />
    </div>
  );
}

/** A longer set, to show how the row wraps rather than scrolls. */
export function Wrapping() {
  const [tags, setTags] = useState([
    "attention",
    "memory",
    "encoding",
    "retrieval-practice",
    "interleaving",
    "desirable-difficulty",
  ]);
  return (
    <div style={frame}>
      <p style={caption}>Tags</p>
      <TagEditor tags={tags} onChange={setTags} />
    </div>
  );
}
