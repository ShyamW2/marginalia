import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ServerStatusBanner } from "./ServerStatusBanner.js";

/**
 * The behaviour under test is the anti-flap rule, not the markup: `tsx watch` restarts
 * the server on every source edit, and a banner that appears during a normal restart
 * would train the operator to ignore the one time it means something.
 */

const POLL_MS = 3000;

function mockFetchSequence(results: boolean[]) {
  let call = 0;
  return vi.fn(async () => {
    const ok = results[Math.min(call, results.length - 1)];
    call += 1;
    if (!ok) throw new TypeError("Failed to fetch");
    return { ok: true } as Response;
  });
}

/** Lets the poll's promise chain settle, then advances to the next tick. */
async function advanceOnePoll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(POLL_MS);
  });
}

describe("ServerStatusBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    cleanup();
  });

  it("stays hidden while the server is healthy", async () => {
    vi.stubGlobal("fetch", mockFetchSequence([true]));
    render(<ServerStatusBanner />);
    await advanceOnePoll();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not appear after a single missed check — that is a watch restart", async () => {
    // Fails once, then recovers: exactly the shape of `tsx watch` reloading.
    vi.stubGlobal("fetch", mockFetchSequence([false, true]));
    render(<ServerStatusBanner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByRole("alert")).toBeNull();
    await advanceOnePoll();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("appears once two consecutive checks fail", async () => {
    vi.stubGlobal("fetch", mockFetchSequence([false]));
    render(<ServerStatusBanner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByRole("alert")).toBeNull();
    await advanceOnePoll();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/isn’t responding/);
  });

  it("clears itself when the server comes back, with no reload", async () => {
    // Down, down, then up — the banner must disappear on the first success.
    vi.stubGlobal("fetch", mockFetchSequence([false, false, true]));
    render(<ServerStatusBanner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await advanceOnePoll();
    expect(screen.getByRole("alert")).toBeTruthy();
    await advanceOnePoll();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("names the command that fixes the native-module case", async () => {
    vi.stubGlobal("fetch", mockFetchSequence([false]));
    render(<ServerStatusBanner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await advanceOnePoll();
    expect(screen.getByRole("alert").textContent).toMatch(/pnpm sync/);
  });
});
