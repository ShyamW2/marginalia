import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Canvas, type RootState } from "@react-three/fiber";
import { NoToneMapping } from "three";
import { useReducedMotion } from "motion/react";
import { SceneLights } from "./SceneLights.js";
import styles from "./Scene3D.module.css";

interface Scene3DContextValue {
  setLayer: (id: string, node: ReactNode | null) => void;
  contextLost: boolean;
}

const Scene3DContext = createContext<Scene3DContextValue | null>(null);

/** How long to wait before giving a genuinely-lost context a fresh canvas. */
const RECOVERY_DELAY_MS = 1500;
/** After this many real losses, stay in the 2D presentation for good rather
 * than thrashing a machine that plainly cannot hold a WebGL context. */
const MAX_RECOVERY_ATTEMPTS = 3;

/**
 * M23 §A: the one 3D seam. Mounted once near the app root (`App.tsx`), this
 * owns the single `<canvas>` three.js/React Three Fiber ever creates — the
 * Desk, the shelf, the turntable and the opening are consumers that register
 * content into it via `useScene3DLayer` rather than mounting their own
 * `<Canvas>`. Nothing outside this file may import `three` or
 * `@react-three/fiber` (settled decision 14).
 *
 * ## The seam's coordinate convention
 *
 * **One world unit is one CSS pixel, and the world origin is the viewport's
 * top-left corner**: +X runs right, +Z runs *down* the screen, +Y comes up
 * out of the desk toward the viewer. Every consumer shares it, which is what
 * lets a surface place 3D content from a DOM element's own
 * `getBoundingClientRect()` with no reprojection — and is why the lights
 * below are sized in pixels. A surface that wants a different framing sets
 * up its own camera (`desk/DeskScene3D.tsx`'s `DeskCameraRig`), never its
 * own units.
 *
 * ## A lost context is a designed state
 *
 * `contextLost` drops the canvas and flips every consumer's
 * `useScene3DAvailable()` to `false`, so each falls back to the 2D
 * presentation it already has — no per-surface escape hatch. It is not a
 * one-way door: a fresh canvas gets a fresh context, so a loss schedules one
 * retry (up to `MAX_RECOVERY_ATTEMPTS`) rather than degrading the app until
 * reload.
 */
export function Scene3DProvider({ children }: { children: ReactNode }) {
  const reducedMotion = useReducedMotion();
  const [layers, setLayers] = useState<Record<string, ReactNode>>({});
  const [contextLost, setContextLost] = useState(false);

  const setLayer = useMemo(
    () => (id: string, node: ReactNode | null) => {
      setLayers((prev) => {
        if (node === null) {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        }
        if (prev[id] === node) return prev;
        return { ...prev, [id]: node };
      });
    },
    [],
  );

  const layerIds = Object.keys(layers);
  const hasLayers = layerIds.length > 0;

  // Reduced motion renders zero canvases, full stop — checked here once
  // rather than by every consumer (TASKS.md M23 §A, "everywhere").
  const canRender = !reducedMotion && !contextLost;

  // ⚠️ The canvas is **sticky**: once a consumer has ever registered, it stays
  // mounted for the session and merely idles (`frameloop="never"`) when no
  // surface wants it. Tying its lifetime to `hasLayers` instead looked
  // tidier and was a real bug: R3F's own unmount path calls
  // `gl.forceContextLoss()` (500ms after the tree detaches), which fires a
  // `webglcontextlost` event on the canvas it is tearing down — caught by the
  // handler below, which latched `contextLost` and permanently degraded every
  // 3D surface. Live symptom: open a book, come back to the Desk, and the
  // Desk is flat 2D until a full reload. Keeping the canvas alive also skips
  // re-uploading every cover texture on each room change.
  const [everRegistered, setEverRegistered] = useState(false);
  useEffect(() => {
    if (hasLayers) setEverRegistered(true);
  }, [hasLayers]);
  const shouldMount = everRegistered && canRender;

  // Read by the context-lost handler to tell a real loss (the GPU took the
  // context away while we were using it) from our own teardown (reduced
  // motion turned on, or the app is unmounting) — the latter must not latch.
  const mountedIntentionally = useRef(shouldMount);
  mountedIntentionally.current = shouldMount;
  const lossCount = useRef(0);

  // Stable identity: R3F only calls `onCreated` once per canvas, but keeping
  // this referentially stable avoids re-registering listeners on every
  // provider re-render (and matters for anything, real or mocked, that keys
  // an effect off the callback's identity).
  const handleCreated = useCallback(({ gl }: RootState) => {
    const canvas = gl.domElement;
    function onLost(event: Event) {
      // Without preventDefault() the browser never fires
      // "webglcontextrestored" and the surface is stuck degraded.
      event.preventDefault();
      if (!mountedIntentionally.current) return;
      lossCount.current += 1;
      setContextLost(true);
    }
    function onRestored() {
      setContextLost(false);
    }
    canvas.addEventListener("webglcontextlost", onLost, false);
    canvas.addEventListener("webglcontextrestored", onRestored, false);
  }, []);

  // A canvas we tore down can never receive "webglcontextrestored" — so
  // recovery is ours to drive, not the browser's.
  useEffect(() => {
    if (!contextLost || lossCount.current > MAX_RECOVERY_ATTEMPTS) return;
    const timer = setTimeout(() => setContextLost(false), RECOVERY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [contextLost]);

  return (
    <Scene3DContext.Provider value={{ setLayer, contextLost }}>
      {children}
      {shouldMount && (
        <div
          className={styles.canvasLayer}
          aria-hidden="true"
          // ⚠️ **A sticky canvas keeps showing its last frame.** WebGL does not
          // clear a drawing buffer just because nothing is drawing into it, and
          // `frameloop="never"` below means nothing will: the moment the Desk
          // unregisters, R3F stops rendering and the desk's final frame — wood,
          // rim, books and all — stays painted on a fixed, full-viewport layer
          // over whatever room comes next. Live symptom: leave the Desk and the
          // reader and the list "don't open", because they render *underneath* a
          // photograph of the desk you just left. Hiding the layer (rather than
          // unmounting the canvas) keeps the context alive, which is the whole
          // point of the stickiness documented above.
          style={{ visibility: hasLayers ? "visible" : "hidden" }}
        >
          {/* R3F's own wrapping div sets `pointerEvents: "auto"` inline
              unless told otherwise (its default assumption is that *it* is
              the event source) — CSS on `.canvasLayer` alone can't win
              against that, since it's an inline style on a *child* div, not
              inherited from this one. Without this override, a mounted 3D
              layer silently ate every click and drag on the page underneath
              it — caught live once §B was the first consumer to ever make
              `shouldMount` true; §A's canvas never actually rendered.

              `flat` (NoToneMapping) because these scenes are UI, not film:
              the desk's material colours come straight from the same CSS
              custom properties the 2D presentation uses, and R3F's default
              ACES tone mapping desaturated them badly — a #faf7f0 desk
              rendered as flat grey, which read as a broken material rather
              than as tone mapping (found live). */}
          <Canvas
            onCreated={handleCreated}
            dpr={[1, 2]}
            shadows
            flat
            gl={{ toneMapping: NoToneMapping, antialias: true }}
            frameloop={hasLayers ? "always" : "never"}
            style={{ pointerEvents: "none" }}
          >
            <SceneLights />
            {layerIds.map((id) => (
              <group key={id}>{layers[id]}</group>
            ))}
          </Canvas>
        </div>
      )}
    </Scene3DContext.Provider>
  );
}

function useScene3DContext(): Scene3DContextValue {
  const ctx = useContext(Scene3DContext);
  if (!ctx) throw new Error("scene3d hooks used outside Scene3DProvider");
  return ctx;
}

/**
 * Registers `node` as `id`'s contribution to the shared canvas while the
 * calling component is mounted; automatically unregisters on unmount or when
 * `node` becomes `null`. `node` should be referentially stable (wrap it in
 * `useMemo`) — a new element every render re-registers every render.
 */
export function useScene3DLayer(id: string, node: ReactNode | null): void {
  const { setLayer } = useScene3DContext();
  useEffect(() => {
    setLayer(id, node);
    return () => setLayer(id, null);
  }, [id, node, setLayer]);
}

/**
 * Whether a surface's registered 3D content is actually being rendered right
 * now — `false` under reduced motion or after a lost context. A surface
 * checks this to decide whether to show its 3D layer or its existing 2D
 * presentation; it never needs to know *why* 3D isn't available.
 */
export function useScene3DAvailable(): boolean {
  const reducedMotion = useReducedMotion();
  const { contextLost } = useScene3DContext();
  return !reducedMotion && !contextLost;
}
