import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  Scene3DProvider,
  useScene3DAvailable,
  useScene3DElevated,
  useScene3DHold,
  useScene3DLayer,
} from "./Scene3D.js";

afterEach(cleanup);

// The real Canvas needs a WebGL context jsdom can't provide. The seam's own
// logic — one canvas, layer registration, reduced-motion and context-lost
// gating — doesn't depend on anything three.js actually draws, so a stand-in
// that renders a plain <canvas> and forwards `onCreated` is enough to test it
// without a real GPU.
vi.mock("@react-three/fiber", () => ({
  Canvas: ({
    children,
    onCreated,
    frameloop,
  }: {
    children?: ReactNode;
    onCreated?: (state: unknown) => void;
    frameloop?: string;
  }) => {
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
      if (ref.current) onCreated?.({ gl: { domElement: ref.current } });
    }, [onCreated]);
    return (
      <canvas ref={ref} data-frameloop={frameloop}>
        {children}
      </canvas>
    );
  },
  // Every layer is wrapped in a `FadingLayer`, which subscribes to the frame
  // loop so it can walk its own materials while a fade runs. There is no frame
  // loop here and nothing to walk; what this file tests is which layers exist,
  // which is decided before any of that.
  useFrame: () => {},
}));

// The shared lights reach into real three.js objects through refs (sizing the
// key light's shadow frustum in viewport pixels — see SceneLights.tsx). Under
// the stand-in Canvas those refs are DOM nodes, and none of it is what this
// file tests: the seam's state machine is.
vi.mock("./SceneLights.js", () => ({ SceneLights: () => null }));

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

/** The provider's own fixed full-viewport wrapper around the canvas — the
 * element that carries the visibility the idle case turns off. Found through
 * the canvas rather than by class name, since CSS modules aren't processed
 * under vitest. */
function canvasLayer(): HTMLElement | null {
  return document.querySelector("canvas")?.parentElement ?? null;
}

function Holder({ id }: { id: string }) {
  useScene3DHold(id);
  return null;
}

function Elevator({ on = true }: { on?: boolean }) {
  useScene3DElevated(on);
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

  // ⚠️ Deliberately *not* "unmounts once the last layer unregisters", which is
  // what this asserted until it was found to be the mechanism behind a live
  // bug: R3F's unmount path calls `gl.forceContextLoss()`, whose
  // `webglcontextlost` event the provider's own handler then read as a real
  // loss and latched — so leaving the Desk for the reader and coming back
  // dropped every 3D surface to its 2D fallback until a full reload.
  it("keeps the canvas alive but idle once the last registered layer unregisters", async () => {
    function Toggle({ show }: { show: boolean }) {
      return <Scene3DProvider>{show && <Registrar id="desk" />}</Scene3DProvider>;
    }
    const { rerender } = render(<Toggle show={true} />);
    await waitFor(() => expect(document.querySelectorAll("canvas")).toHaveLength(1));
    expect(document.querySelector("canvas")?.dataset.frameloop).toBe("always");
    expect(canvasLayer()?.style.visibility).toBe("visible");

    rerender(<Toggle show={false} />);
    await waitFor(() => expect(document.querySelector("canvas")?.dataset.frameloop).toBe("never"));
    expect(document.querySelectorAll("canvas")).toHaveLength(1);
    // ⚠️ And it is *hidden* while idle. An idle canvas still displays the last
    // frame it drew, so a canvas that merely stops rendering leaves the Desk
    // painted over the reader and the list — the room you navigate to appears
    // not to open at all.
    expect(canvasLayer()?.style.visibility).toBe("hidden");

    // And picks straight back up when a surface returns — the round trip the
    // bug above broke.
    rerender(<Toggle show={true} />);
    await waitFor(() => expect(document.querySelector("canvas")?.dataset.frameloop).toBe("always"));
    expect(document.querySelectorAll("canvas")).toHaveLength(1);
    expect(canvasLayer()?.style.visibility).toBe("visible");
  });

  // M23 §E's rework: the opening is a transition *between* rooms, so the room
  // it left has to stay on the canvas while the book climbs out of it —
  // otherwise the Desk blinks out on the click and the whole sequence plays
  // over a reader the book has not reached yet.
  it("holds a layer past its owner's unmount, and drops it when the hold ends", async () => {
    function Rooms({ desk, opening }: { desk: boolean; opening: boolean }) {
      return (
        <Scene3DProvider>
          {desk && <Registrar id="desk" />}
          {opening && <Holder id="desk" />}
        </Scene3DProvider>
      );
    }
    const { rerender } = render(<Rooms desk={true} opening={false} />);
    await waitFor(() => expect(screen.queryByTestId("layer-desk")).toBeTruthy());

    // The click: the opening takes the hold, the Desk unmounts. The desk's
    // scene stays.
    rerender(<Rooms desk={false} opening={true} />);
    await waitFor(() => expect(document.querySelector("canvas")?.dataset.frameloop).toBe("always"));
    expect(screen.queryByTestId("layer-desk")).toBeTruthy();

    // The opening finishes: nothing is holding it and nothing owns it.
    rerender(<Rooms desk={false} opening={false} />);
    await waitFor(() => expect(screen.queryByTestId("layer-desk")).toBeNull());
  });

  // ⚠️ Escape during the opening lands straight back on the Desk, which
  // re-registers a *live* layer under the same id before the hold is released.
  // Releasing must not drop that one, or the room the user is now looking at
  // goes blank.
  it("leaves a re-registered layer alone when an old hold is released", async () => {
    function Rooms({ desk, opening }: { desk: boolean; opening: boolean }) {
      return (
        <Scene3DProvider>
          {desk && <Registrar id="desk" />}
          {opening && <Holder id="desk" />}
        </Scene3DProvider>
      );
    }
    const { rerender } = render(<Rooms desk={true} opening={true} />);
    await waitFor(() => expect(screen.queryByTestId("layer-desk")).toBeTruthy());

    rerender(<Rooms desk={true} opening={false} />);
    await waitFor(() => expect(document.querySelector("canvas")?.dataset.frameloop).toBe("always"));
    expect(screen.queryByTestId("layer-desk")).toBeTruthy();
  });

  it("ignores the context-loss event its own teardown fires", async () => {
    // Reduced motion turning on mid-session is the one path that still
    // unmounts the canvas, and R3F fires `webglcontextlost` as it goes. That
    // must not latch `contextLost`, or turning reduced motion back off would
    // leave the app permanently 2D.
    function Room() {
      return (
        <Scene3DProvider>
          <Registrar id="desk" />
          <AvailabilityProbe />
        </Scene3DProvider>
      );
    }
    const { rerender } = render(<Room />);
    await waitFor(() => expect(document.querySelectorAll("canvas")).toHaveLength(1));
    const canvas = document.querySelector("canvas")!;

    mockUseReducedMotion.mockReturnValue(true);
    try {
      rerender(<Room />);
      await waitFor(() => expect(document.querySelectorAll("canvas")).toHaveLength(0));
      canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    } finally {
      mockUseReducedMotion.mockReturnValue(false);
    }

    rerender(<Room />);
    await waitFor(() => expect(document.querySelectorAll("canvas")).toHaveLength(1));
    expect(screen.getByTestId("available").textContent).toBe("true");
  });

  // M27, operator's two asks (2026-08-26): a turning page is in front of the
  // screen, so it has to outrank the reader's chrome — which at the seam's
  // ordinary `z-index: 0` it did not. The number itself lives in
  // `Scene3D.module.css`; what this file owns is *when* the attribute is on.
  it("leaves the canvas at the seam's ordinary depth when nobody asks to be elevated", async () => {
    render(
      <Scene3DProvider>
        <Registrar id="desk" />
      </Scene3DProvider>,
    );
    await waitFor(() => expect(document.querySelectorAll("canvas")).toHaveLength(1));
    // Absent, not "false": the ordinary case must be exactly the CSS it always
    // was, with no rule matching it.
    expect(canvasLayer()?.hasAttribute("data-elevated")).toBe(false);
  });

  it("elevates the canvas while a consumer asks, and drops it again on unmount", async () => {
    function Room({ turning }: { turning: boolean }) {
      return (
        <Scene3DProvider>
          <Registrar id="desk" />
          {turning && <Elevator />}
        </Scene3DProvider>
      );
    }
    const { rerender } = render(<Room turning={false} />);
    await waitFor(() => expect(document.querySelectorAll("canvas")).toHaveLength(1));

    rerender(<Room turning={true} />);
    await waitFor(() => expect(canvasLayer()?.getAttribute("data-elevated")).toBe("true"));

    rerender(<Room turning={false} />);
    await waitFor(() => expect(canvasLayer()?.hasAttribute("data-elevated")).toBe(false));
  });

  // The count, not a flag: two overlapping callers must not have the first one
  // to leave strand the canvas above the app's chrome — which is what a boolean
  // would do, and what a stuck elevation looks like is every dialog in the app
  // rendering *under* an idle canvas.
  it("stays elevated until the last consumer has let go", async () => {
    function Room({ a, b }: { a: boolean; b: boolean }) {
      return (
        <Scene3DProvider>
          <Registrar id="desk" />
          {a && <Elevator />}
          {b && <Elevator />}
        </Scene3DProvider>
      );
    }
    const { rerender } = render(<Room a={true} b={true} />);
    await waitFor(() => expect(canvasLayer()?.getAttribute("data-elevated")).toBe("true"));

    rerender(<Room a={false} b={true} />);
    await waitFor(() => expect(document.querySelectorAll("canvas")).toHaveLength(1));
    expect(canvasLayer()?.getAttribute("data-elevated")).toBe("true");

    rerender(<Room a={false} b={false} />);
    await waitFor(() => expect(canvasLayer()?.hasAttribute("data-elevated")).toBe(false));
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

  it("gives a genuinely lost context a fresh canvas rather than degrading until reload", async () => {
    render(
      <Scene3DProvider>
        <Registrar id="desk" />
        <AvailabilityProbe />
      </Scene3DProvider>,
    );
    await waitFor(() => expect(document.querySelectorAll("canvas")).toHaveLength(1));
    document.querySelector("canvas")!.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    await waitFor(() => expect(document.querySelectorAll("canvas")).toHaveLength(0));

    // A new canvas gets a new context, so recovery is the provider's to drive:
    // the browser can't fire "webglcontextrestored" at an element we removed.
    await waitFor(() => expect(document.querySelectorAll("canvas")).toHaveLength(1), { timeout: 4000 });
    expect(screen.getByTestId("available").textContent).toBe("true");
  });
});
