import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Canvas, type RootState } from "@react-three/fiber";
import { useReducedMotion } from "motion/react";
import styles from "./Scene3D.module.css";

interface Scene3DContextValue {
  setLayer: (id: string, node: ReactNode | null) => void;
  contextLost: boolean;
}

const Scene3DContext = createContext<Scene3DContextValue | null>(null);

/**
 * M23 §A: the one 3D seam. Mounted once near the app root (`App.tsx`), this
 * owns the single `<canvas>` three.js/React Three Fiber ever creates — the
 * Desk, the shelf, the turntable and the opening are consumers that register
 * content into it via `useScene3DLayer` rather than mounting their own
 * `<Canvas>`. Nothing outside this file may import `three` or
 * `@react-three/fiber` (settled decision 14).
 *
 * A lost WebGL context is a designed state, not an error: `contextLost`
 * tears the canvas down, and every consumer's own `useScene3DAvailable()`
 * flips to `false` so it falls back to the 2D presentation it already has —
 * there is no per-surface escape hatch to write.
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
  // Reduced motion renders zero canvases, full stop — checked here once
  // rather than by every consumer (TASKS.md M23 §A, "everywhere").
  const shouldMount = layerIds.length > 0 && !reducedMotion && !contextLost;

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
      setContextLost(true);
    }
    function onRestored() {
      setContextLost(false);
    }
    canvas.addEventListener("webglcontextlost", onLost, false);
    canvas.addEventListener("webglcontextrestored", onRestored, false);
  }, []);

  return (
    <Scene3DContext.Provider value={{ setLayer, contextLost }}>
      {children}
      {shouldMount && (
        <div className={styles.canvasLayer} aria-hidden="true">
          <Canvas onCreated={handleCreated} dpr={[1, 2]}>
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
