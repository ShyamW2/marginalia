/**
 * Shared `layoutId` for a resource's cover across routes — the library
 * card's cover and the reader's title-bar thumbnail use the same id so
 * `motion` can animate one growing into the other on navigation (DESIGN.md
 * "doorway" transitions; M7 ships the first proof of this system).
 */
export function coverLayoutId(resourceId: string): string {
  return `book-cover-${resourceId}`;
}
