// marks-pane 1.0.9 ships no type declarations of its own (see
// marksPanePatch.ts for why this app imports it directly at all).
// Narrowed to exactly what's used here — the full library's surface is
// bigger, but nothing else in this app touches it.
declare module "marks-pane" {
  export class Highlight {
    range: Range;
    filteredRanges(): DOMRect[];
  }
}
