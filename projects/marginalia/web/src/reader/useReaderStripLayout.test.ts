import { describe, expect, it } from "vitest";
import { shouldRestack } from "./useReaderStripLayout.js";

// M42 §E (decisions.md 2026-09-07): a sibling panel (ThreadPanel, the margin
// rail) opening/closing narrows the reading pane without touching the
// tab/window, and must not restack the strip — only an actual tab/window
// resize should. jsdom has no ResizeObserver, so this exercises the pure
// decision function the hook's measure() delegates to, the same pattern
// pdfLayout.test.ts uses for PdfRenderer's own layout math.
describe("shouldRestack", () => {
  it("applies the pane's own measurement on first mount, with no prior window width to compare against", () => {
    expect(shouldRestack({ next: true, currentStacked: false, currentWindowWidth: 800, priorWindowWidth: null })).toBe(
      true,
    );
    expect(shouldRestack({ next: false, currentStacked: true, currentWindowWidth: 800, priorWindowWidth: null })).toBe(
      false,
    );
  });

  it("is a no-op when the pane measurement agrees with the current state", () => {
    expect(shouldRestack({ next: false, currentStacked: false, currentWindowWidth: 800, priorWindowWidth: 800 })).toBe(
      false,
    );
    expect(shouldRestack({ next: true, currentStacked: true, currentWindowWidth: 600, priorWindowWidth: 900 })).toBe(
      true,
    );
  });

  it("restacks when the window itself shrank", () => {
    expect(shouldRestack({ next: true, currentStacked: false, currentWindowWidth: 700, priorWindowWidth: 900 })).toBe(
      true,
    );
  });

  it("unstacks when the window itself grew", () => {
    expect(shouldRestack({ next: false, currentStacked: true, currentWindowWidth: 900, priorWindowWidth: 700 })).toBe(
      false,
    );
  });

  it("refuses to stack when the pane narrowed but the window width did not change (a sibling panel opened)", () => {
    expect(shouldRestack({ next: true, currentStacked: false, currentWindowWidth: 900, priorWindowWidth: 900 })).toBe(
      false,
    );
  });

  it("refuses to unstack when the pane widened but the window width did not change (a sibling panel closed)", () => {
    expect(shouldRestack({ next: false, currentStacked: true, currentWindowWidth: 900, priorWindowWidth: 900 })).toBe(
      true,
    );
  });

  it("refuses to stack when the window actually grew (pane narrowed by a panel while the window widened)", () => {
    expect(shouldRestack({ next: true, currentStacked: false, currentWindowWidth: 950, priorWindowWidth: 900 })).toBe(
      false,
    );
  });
});
