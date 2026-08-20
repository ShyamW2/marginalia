import { LibraryGrid } from "@marginalia/web";

/*
 * LibraryGrid is the Desk's list view — and per settled decision 15 it is the
 * library's accessibility floor, the keyboard/screen-reader path. The 3D shelf
 * is an additional view mode, never a replacement, so this is the view that
 * must always work.
 */
const resources = [
  { id: "res-1", title: "The Feeling of Knowing", author: "M. Halloran", highlightCount: 37, threadCount: 9 },
  { id: "res-2", title: "Interleaving", author: "R. Bjork", highlightCount: 12, threadCount: 3 },
  { id: "res-3", title: "Desirable Difficulty", author: "E. Bjork", highlightCount: 4, threadCount: 0 },
  { id: "res-4", title: "The Curse of Fluency", author: "D. Willingham", highlightCount: 0, threadCount: 0 },
];

const noop = () => {};

/** The populated library: cover, title, author and the highlight/thread
 *  counts that say how much work a book has had done on it. */
export function Populated() {
  return <LibraryGrid resources={resources} publishingId="" onPublish={noop} />;
}

/** `publishingId` marks the row whose publish is in flight — one book at a
 *  time, so the affordance is per-row rather than global. */
export function Publishing() {
  return <LibraryGrid resources={resources} publishingId="res-1" onPublish={noop} />;
}

/*
 * Two axes deliberately have no story here, because neither is visible:
 *  · `listeningEngaged` only sets the router link's `state`
 *    ({ listenOnOpen: true }) — the rendering is byte-identical, so a story
 *    for it would be a duplicate cell claiming to show a variant.
 *  · the empty library is DeskPage's state (`hasBooks`), not this
 *    component's: LibraryGrid with `resources={[]}` renders an empty
 *    container and nothing else.
 */
