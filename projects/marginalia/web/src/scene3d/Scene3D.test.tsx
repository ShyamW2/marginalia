import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Scene3DProvider, useScene3DAvailable, useScene3DLayer } from "./Scene3D.js";

afterEach(cleanup);

// The real Canvas needs a WebGL context jsdom can't provide. The seam's own
// logic — one canvas, layer registration, reduced-motion and context-lost
// gating — doesn't depend on anything three.js actually draws, so a stand-in
// that renders a plain <canvas> and forwards `onCreated` is enough to test it
// without a real GPU.
vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children, onCreated }: { children?: ReactNode; onCreated?: (state: unknown) => void }) => {
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
      if (ref.current) onCreated?.({ gl: { domElement: ref.current } });
    }, [onCreated]);
    return <canvas ref={ref}>{children}</canvas>;
  },
}));

// `motion/react`'s real useReducedMotion lazily caches `matchMedia`'s result
// in a module-level singleton the first time anything calls it — fine for an
// app, useless for a test file that needs both states. Mocking the hook
// directly controls what the seam sees without fighting that cache.
const mockUseReducedMotion = vi.fn(() => false);
vi.mock("motion/react", () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

function Registrar({ id }: { id: string }) {
  // useScene3DLayer's own contract: the node must be referentially stable or
  // every provider re-render re-registers it, which is exactly the loop this
  // memoization avoids.
  const node = useMemo(() => <div data-testid={`layer-${id}`} />, [id]);
  useScene3DLayer(id, node);
  return null;
}

function AvailabilityProbe() {
  const available = useScene3DAvailable();
  return <div data-testid="available">{String(available)}</div>;
}

describe("Scene3DProvider", () => {
  it("mounts zero canvases with nothing registered", () => {
    render(
      <Scene3DProvider>
        <div>empty room</div>
      </Scene3DProvider>,
    );
    expect(document.querySelectorAll("canvas")).toHaveLength(0);
  });

  it("mounts exactly one canvas no matter how many surfaces register content", async () => {
    render(
      <Scene3DProvider>
        <Registrar id="desk" />
        <Registrar id="turntable" />
      </Scene3DProvider>,
    );
    await waitFor(() => expect(document.querySelectorAll("canvas")).toHaveLength(1));
    expect(screen.getByTestId("layer-desk")).toBeTruthy();
    expect(screen.getByTestId("layer-turntable")).toBeTruthy();
  });

  it("unmounts the canvas once the last registered layer unregisters", async () => {
    function Toggle({ show }: { show: boolean }) {
      return <Scene3DProvider>{show && <Registrar id="desk" />}</Scene3DProvider>;
    }
    const { rerender } = render(<Toggle show={true} />);
    await waitFor(() => expect(document.querySelectorAll("canvas")).toHaveLength(1));
    rerender(<Toggle show={false} />);
    await waitFor(() => expect(document.querySelectorAll("canvas")).toHaveLength(0));
  });

  it("renders zero canvases under reduced motion even with content registered", () => {
    mockUseReducedMotion.mockReturnValue(true);
    try {
      render(
        <Scene3DProvider>
          <Registrar id="desk" />
        </Scene3DProvider>,
      );
      expect(document.querySelectorAll("canvas")).toHaveLength(0);
    } finally {
      mockUseReducedMotion.mockReturnValue(false);
    }
  });

  it("degrades to zero canvases on a lost WebGL context, and reports it as unavailable", async () => {
    render(
      <Scene3DProvider>
        <Registrar id="desk" />
        <AvailabilityProbe />
      </Scene3DProvider>,
    );
    await waitFor(() => expect(document.querySelectorAll("canvas")).toHaveLength(1));
    expect(screen.getByTestId("available").textContent).toBe("true");

    const canvas = document.querySelector("canvas")!;
    const event = new Event("webglcontextlost", { cancelable: true });
    canvas.dispatchEvent(event);

    await waitFor(() => expect(document.querySelectorAll("canvas")).toHaveLength(0));
    expect(screen.getByTestId("available").textContent).toBe("false");
  });
});
