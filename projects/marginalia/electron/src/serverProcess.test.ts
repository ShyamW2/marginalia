import { afterEach, describe, expect, it, vi } from "vitest";
import { watchServerMemory } from "./serverProcess.js";
import type { UtilityProcess } from "electron";

/**
 * M46 (DESKTOP.md §4): the one part of `serverProcess.ts` worth a real unit
 * test — `startServer` itself forks a real `utilityProcess` and is only
 * verifiable live (same reasoning `main.ts` has no test file). This covers
 * `watchServerMemory`'s polling/threshold logic in isolation, the same way
 * `gpu.ts` keeps its pure classification separate from `gpuDetect.ts`'s
 * Electron-touching wrapper.
 *
 * ⚠️ `--max-old-space-size` via `execArgv` was the first approach tried
 * here and was dropped after live verification (Xvfb, a real forked
 * utility process) showed Electron 40 does not actually apply it — see
 * `watchServerMemory`'s own doc comment. This RSS-polling replacement is
 * what that verification led to.
 */
function fakeChild(pid: number | undefined): UtilityProcess {
  return { pid } as unknown as UtilityProcess;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("watchServerMemory", () => {
  it("fires once RSS crosses the cap", () => {
    vi.useFakeTimers();
    const child = fakeChild(4242);
    const getMetrics = vi
      .fn()
      .mockReturnValueOnce([{ pid: 4242, memory: { workingSetSize: 100 * 1024 } }])
      .mockReturnValueOnce([{ pid: 4242, memory: { workingSetSize: 600 * 1024 } }]);
    const onExceeded = vi.fn();

    const stop = watchServerMemory(child, 512, getMetrics, onExceeded);
    vi.advanceTimersByTime(10_000);
    expect(onExceeded).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(onExceeded).toHaveBeenCalledWith(600);
    stop();
  });

  it("never fires while RSS stays under the cap", () => {
    vi.useFakeTimers();
    const child = fakeChild(1);
    const getMetrics = vi.fn().mockReturnValue([{ pid: 1, memory: { workingSetSize: 200 * 1024 } }]);
    const onExceeded = vi.fn();

    const stop = watchServerMemory(child, 512, getMetrics, onExceeded);
    vi.advanceTimersByTime(60_000);
    expect(onExceeded).not.toHaveBeenCalled();
    stop();
  });

  it("fires only once even if RSS stays over the cap on later polls", () => {
    vi.useFakeTimers();
    const child = fakeChild(1);
    const getMetrics = vi.fn().mockReturnValue([{ pid: 1, memory: { workingSetSize: 900 * 1024 } }]);
    const onExceeded = vi.fn();

    const stop = watchServerMemory(child, 512, getMetrics, onExceeded);
    vi.advanceTimersByTime(50_000);
    expect(onExceeded).toHaveBeenCalledTimes(1);
    stop();
  });

  it("skips a poll when the child has no pid yet (still starting up)", () => {
    vi.useFakeTimers();
    const child = fakeChild(undefined);
    const getMetrics = vi.fn().mockReturnValue([{ pid: 1, memory: { workingSetSize: 900 * 1024 } }]);
    const onExceeded = vi.fn();

    const stop = watchServerMemory(child, 512, getMetrics, onExceeded);
    vi.advanceTimersByTime(10_000);
    expect(getMetrics).not.toHaveBeenCalled();
    expect(onExceeded).not.toHaveBeenCalled();
    stop();
  });

  it("stop() clears the timer — no further calls after stopping", () => {
    vi.useFakeTimers();
    const child = fakeChild(1);
    const getMetrics = vi.fn().mockReturnValue([{ pid: 1, memory: { workingSetSize: 900 * 1024 } }]);
    const onExceeded = vi.fn();

    const stop = watchServerMemory(child, 512, getMetrics, onExceeded);
    stop();
    vi.advanceTimersByTime(60_000);
    expect(getMetrics).not.toHaveBeenCalled();
    expect(onExceeded).not.toHaveBeenCalled();
  });
});
