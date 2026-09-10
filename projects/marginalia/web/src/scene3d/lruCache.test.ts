import { describe, expect, it } from "vitest";
import { LruCache } from "./lruCache.js";

describe("LruCache", () => {
  it("stays under capacity, evicting the least recently touched entry", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    expect(cache.size).toBe(2);
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);
  });

  it("a get() counts as use — it protects the entry from the next eviction", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a"); // "a" is now more-recently-used than "b"
    cache.set("c", 3);

    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);
  });

  it("re-setting an existing key updates its value and bumps recency without growing the map", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 100);
    cache.set("c", 3);

    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBe(100);
    expect(cache.has("b")).toBe(false);
  });

  it("calls onEvict with the evicted value and key, and never for a value still held", () => {
    const evicted: Array<[number, string]> = [];
    const cache = new LruCache<string, number>(1, (value, key) => evicted.push([value, key]));
    cache.set("a", 1);
    cache.set("b", 2);

    expect(evicted).toEqual([[1, "a"]]);
  });

  it("bounds a 200-book shelf to its stated capacity — the DESKTOP.md §4.1 scenario", () => {
    const disposed: string[] = [];
    const cache = new LruCache<string, string>(120, (value) => disposed.push(value));
    for (let i = 0; i < 200; i++) cache.set(`book-${i}`, `texture-${i}`);

    expect(cache.size).toBe(120);
    expect(disposed).toHaveLength(80);
    // The most recently added 120 books are the ones still resident.
    expect(cache.has("book-199")).toBe(true);
    expect(cache.has("book-79")).toBe(false);
  });

  it("rejects a non-positive capacity rather than silently never caching", () => {
    expect(() => new LruCache(0)).toThrow();
  });
});
