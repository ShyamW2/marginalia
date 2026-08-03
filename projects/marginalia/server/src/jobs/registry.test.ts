import { describe, expect, it, vi } from "vitest";
import { cancelJob, getJob, listJobs, startJob, subscribeJob } from "./registry.js";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("job registry", () => {
  it("starts running and shows up in listJobs/getJob immediately", async () => {
    const gate = deferred();
    const job = startJob("digest", "res-1", "Middlemarch", async () => {
      await gate.promise;
    });

    expect(job.status).toBe("running");
    expect(job.resourceTitle).toBe("Middlemarch");
    expect(getJob(job.id)?.status).toBe("running");
    expect(listJobs().some((j) => j.id === job.id)).toBe(true);

    gate.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });

  it("completes when the runner resolves, and reports progress as it goes", async () => {
    const job = startJob("digest", "res-1", "Book", async (_signal, reportProgress) => {
      reportProgress({ current: 1, total: 2, message: "S1" });
      await Promise.resolve();
      reportProgress({ current: 2, total: 2, message: "S2" });
    });

    // Wait for the microtask queue to drain the fire-and-forget runner.
    await new Promise((r) => setTimeout(r, 0));

    const final = getJob(job.id);
    expect(final?.status).toBe("completed");
    expect(final?.progress).toEqual({ current: 2, total: 2, message: "S2" });
    expect(final?.finishedAt).not.toBeNull();
  });

  it("marks a job failed, with the error message, when the runner rejects for a reason other than cancellation", async () => {
    const job = startJob("thematic", "res-1", "Book", async () => {
      throw new Error("provider exploded");
    });

    await new Promise((r) => setTimeout(r, 0));

    const final = getJob(job.id);
    expect(final?.status).toBe("failed");
    expect(final?.error).toBe("provider exploded");
  });

  it("cancelJob aborts the signal and the runner actually stops doing work, not just marks itself cancelled later", async () => {
    let stepsCompleted = 0;
    const stepGate = deferred();

    const job = startJob("digest", "res-1", "Book", async (signal) => {
      // Simulates one chapter's worth of "real work": it awaits, checks the
      // signal, and must not proceed once aborted — the same shape as
      // runDigest's per-chapter loop.
      await stepGate.promise;
      if (signal.aborted) throw new Error("should not resume after abort");
      stepsCompleted++;
    });

    const cancelled = cancelJob(job.id);
    expect(cancelled).toBe(true);
    // The registry must not wait for the runner to notice before reporting cancel requested —
    // but until the runner actually settles, status reflects that settling, not the request.
    stepGate.resolve();
    await new Promise((r) => setTimeout(r, 0));

    expect(stepsCompleted).toBe(0);
    expect(getJob(job.id)?.status).toBe("cancelled");
  });

  it("cancelling a job that already finished, or doesn't exist, is a no-op (not an error)", async () => {
    const job = startJob("digest", "res-1", "Book", async () => {});
    await new Promise((r) => setTimeout(r, 0));
    expect(getJob(job.id)?.status).toBe("completed");

    expect(cancelJob(job.id)).toBe(false);
    expect(cancelJob("does-not-exist")).toBe(false);
  });

  it("subscribing/watching a job never changes its outcome — only cancelJob does", async () => {
    const seen: string[] = [];
    const job = startJob("digest", "res-1", "Book", async (_signal, reportProgress) => {
      reportProgress({ current: 1, total: 1 });
    });
    const unsubscribe = subscribeJob(job.id, (j) => seen.push(j.status));
    unsubscribe?.();

    await new Promise((r) => setTimeout(r, 0));

    expect(getJob(job.id)?.status).toBe("completed");
    // Unsubscribing before the run settled just means this particular
    // listener missed the final event — it must not have cancelled anything.
    expect(seen).not.toContain("cancelled");
  });

  it("a runner whose promise resolves normally after its own signal was aborted is still recorded as cancelled, not completed", async () => {
    const gate = deferred();
    const job = startJob("digest", "res-1", "Book", async (signal) => {
      await gate.promise;
      // Cooperative early-return, like runDigest's between-chapter check —
      // resolves cleanly rather than throwing.
      if (signal.aborted) return;
    });

    cancelJob(job.id);
    gate.resolve();
    await new Promise((r) => setTimeout(r, 0));

    expect(getJob(job.id)?.status).toBe("cancelled");
  });

  it("emits progress updates to subscribers in order", async () => {
    const listener = vi.fn();
    const startGate = deferred();
    const job = startJob("digest", "res-1", "Book", async (_signal, reportProgress) => {
      await startGate.promise; // let the test subscribe before any progress fires
      reportProgress({ current: 1, total: 3 });
      reportProgress({ current: 2, total: 3 });
    });
    subscribeJob(job.id, listener);
    startGate.resolve();

    await new Promise((r) => setTimeout(r, 0));

    const progressValues = listener.mock.calls.map(([j]) => j.progress.current);
    // Two real progress reports, then the terminal (completed) snapshot —
    // finishing a job never mutates the last progress it reported.
    expect(progressValues).toEqual([1, 2, 2]);
  });
});
