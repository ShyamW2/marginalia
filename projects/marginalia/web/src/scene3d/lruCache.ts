/**
 * A `Map`-backed cache bounded to `capacity` entries, evicting the
 * least-recently-used one once a `set` would exceed it.
 *
 * M46 (DESKTOP.md §4.1): the three `scene3d/` module-level `Map`s this
 * replaces the guts of — `spineTexture.ts`, `useCoverTexture.ts`,
 * `useSpinePalette.ts` — were unbounded, growing for the life of the
 * session as a shelf remounts every book on every view change. Recency is
 * tracked the cheap way `Map` already gives it for free: re-inserting a key
 * moves it to the end of iteration order, so the first key iteration yields
 * is always the least recently touched.
 *
 * ⚠️ Bounding the `Map` is not, by itself, "freeing the memory" — that's
 * only true for a cache whose values are plain data. `three` textures hold
 * GPU memory released only by their own `.dispose()`, so a consumer whose
 * values need that gets an `onEvict` callback; a consumer whose values
 * don't (`useSpinePalette.ts`) passes none. Passing the wrong one for the
 * wrong cache is the mistake DESKTOP.md's §4.1 warns against, not something
 * this class can catch on its own.
 */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();

  constructor(
    private readonly capacity: number,
    private readonly onEvict?: (value: V, key: K) => void,
  ) {
    if (capacity < 1) throw new Error(`LruCache capacity must be at least 1, got ${capacity}`);
  }

  get size(): number {
    return this.map.size;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  /** Touching a hit counts as use — it moves the entry to most-recently-used. */
  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key) as V;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldestKey = this.map.keys().next().value as K | undefined;
      if (oldestKey === undefined) break;
      const oldestValue = this.map.get(oldestKey) as V;
      this.map.delete(oldestKey);
      this.onEvict?.(oldestValue, oldestKey);
    }
  }
}
