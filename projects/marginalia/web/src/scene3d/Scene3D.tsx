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
import { Canvas, useFrame, type RootState } from "@react-three/fiber";
import { NoToneMapping, type Group, type Material, type Mesh } from "three";
import { useReducedMotion } from "motion/react";
import { SceneLights } from "./SceneLights.js";
import styles from "./Scene3D.module.css";

/** A layer on its way out: where its opacity is going, and how long it takes to
 * get there. See `useScene3DLayerFade`. */
export interface LayerFade {
  to: number;
  ms: number;
}

interface Scene3DContextValue {
  setLayer: (id: string, node: ReactNode | null) => void;
  holdLayer: (id: string) => void;
  releaseLayer: (id: string) => void;
  setLayerFade: (id: string, fade: LayerFade | null) => void;
  setFade: (ms: number | null) => void;
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

  // Which layers have a live owner mounted, and which are being held past
  // their owner's unmount (see `useScene3DHold`). Refs rather than state:
  // they only ever decide what a *later* `setLayers` does, so re-rendering on
  // a change to either would be a render nobody reads.
  const liveIds = useRef(new Set<string>());
  const heldIds = useRef(new Set<string>());

  /**
   * Drop a layer *unless* someone still wants it — a live owner, or a hold.
   *
   * ⚠️ **Deferred by a microtask, and that is the whole reason it works.**
   * React runs an unmounting component's effect cleanups *before* the newly
   * mounted ones' effects, in the same commit. The opening and the room it
   * leaves are exactly that pair: the Desk unregisters and the opening takes
   * its hold in one commit, in that order, so a synchronous drop would delete
   * the layer a moment before the thing that wanted to keep it could say so.
   * Checking on the microtask after the commit lets the whole commit have its
   * say first — and makes StrictMode's mount/cleanup/mount double-invoke a
   * no-op here rather than a dropped room.
   */
  const scheduleDrop = useCallback((id: string) => {
    queueMicrotask(() => {
      if (liveIds.current.has(id) || heldIds.current.has(id)) return;
      setLayers((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    });
  }, []);

  const setLayer = useCallback(
    (id: string, node: ReactNode | null) => {
      if (node === null) {
        liveIds.current.delete(id);
        // ⚠️ A held layer keeps its **last** node and goes on rendering. That
        // node's components live inside the `<Canvas>` tree here, not inside
        // the room that registered them, so they survive that room unmounting
        // — which is the whole mechanism behind the Desk staying under the
        // opening (M23 §E rework). They are frozen only in the sense that
        // nothing re-renders them from above; anything they subscribe to
        // themselves still moves them (`departedBook.ts`).
        scheduleDrop(id);
        return;
      }
      liveIds.current.add(id);
      setLayers((prev) => (prev[id] === node ? prev : { ...prev, [id]: node }));
    },
    [scheduleDrop],
  );

  const holdLayer = useCallback((id: string) => {
    heldIds.current.add(id);
  }, []);

  const releaseLayer = useCallback(
    (id: string) => {
      heldIds.current.delete(id);
      // Not an unconditional drop: by the time a hold is released the room may
      // have come *back* (Escape during the opening lands straight on the Desk
      // again) and re-registered a live layer under the same id. Blanking that
      // one is blanking the room the user is now looking at.
      scheduleDrop(id);
    },
    [scheduleDrop],
  );

  // Per-layer fades, keyed the same way as the layers themselves. Empty in the
  // ordinary case; the opening writes one entry (see `useScene3DLayerFade`).
  const [layerFades, setLayerFades] = useState<Record<string, LayerFade>>({});
  const setLayerFade = useCallback((id: string, fade: LayerFade | null) => {
    setLayerFades((prev) => {
      if (fade === null) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      const current = prev[id];
      if (current && current.to === fade.to && current.ms === fade.ms) return prev;
      return { ...prev, [id]: fade };
    });
  }, []);

  // How long the whole canvas takes to fade out, or null for "fully opaque".
  // See `useScene3DFade` for why this is a property of the canvas rather than
  // of a layer.
  const [fadeMs, setFadeMs] = useState<number | null>(null);
  const setFade = useCallback((ms: number | null) => setFadeMs(ms), []);

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
    <Scene3DContext.Provider
      value={{ setLayer, holdLayer, releaseLayer, setLayerFade, setFade, contextLost }}
    >
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
          // ⚠️ The fade's transition is only *present* while a fade is asked
          // for. Leaving it on would make the reset at the end of one — which
          // happens in the same commit as the faded layer being dropped — a
          // 380ms fade back *up* of whatever the canvas draws next.
          style={{
            visibility: hasLayers ? "visible" : "hidden",
            opacity: fadeMs === null ? 1 : 0,
            transition: fadeMs === null ? "none" : `opacity ${fadeMs}ms ease-out`,
          }}
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
              <FadingLayer key={id} fade={layerFades[id] ?? null}>
                {layers[id]}
              </FadingLayer>
            ))}
          </Canvas>
        </div>
      )}
    </Scene3DContext.Provider>
  );
}

interface MaterialState {
  opacity: number;
  transparent: boolean;
}

/**
 * One layer's group, with an opacity of its own.
 *
 * ⚠️ **three.js has no group opacity**, so this is what one costs: every
 * material under the group, walked and written each frame the value moves, with
 * its as-authored state remembered so the layer can be handed back intact. That
 * is also why the map is keyed on the *material* — the page block's is shared
 * across every mounted book (`Book3D.tsx`), so restoring by re-traversal at
 * unmount (when the tree is already coming apart) would leave a shared material
 * stuck at zero and the next room's books invisible.
 *
 * The one caller is the opening's landing, which needs the room the book came
 * from to *leave* while the book is still on screen — see `useScene3DLayerFade`
 * for why the canvas-wide fade cannot do that job.
 */
function FadingLayer({ fade, children }: { fade: LayerFade | null; children: ReactNode }) {
  const groupRef = useRef<Group>(null!);
  const original = useRef(new Map<Material, MaterialState>());
  const applied = useRef(1);
  const startedAt = useRef<number | null>(null);

  const write = useCallback((value: number) => {
    const group = groupRef.current;
    if (!group) return;
    group.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.material) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        let base = original.current.get(material);
        if (!base) {
          base = { opacity: material.opacity, transparent: material.transparent };
          original.current.set(material, base);
        }
        const transparent = base.transparent || value < 1;
        // Toggling `transparent` changes the program three.js compiles for the
        // material, so it is one of the few flags that genuinely needs this.
        if (material.transparent !== transparent) material.needsUpdate = true;
        material.transparent = transparent;
        material.opacity = base.opacity * value;
      }
    });
    applied.current = value;
  }, []);

  useFrame(() => {
    if (!fade) {
      if (applied.current !== 1) {
        write(1);
        startedAt.current = null;
      }
      return;
    }
    if (startedAt.current === null) startedAt.current = performance.now();
    const t = fade.ms <= 0 ? 1 : Math.min(1, (performance.now() - startedAt.current) / fade.ms);
    // ⚠️ **Ease-in-out, and it was ease-out for one build.** A layer fades out
    // because something else is taking its place, so the curve has to leave it
    // legible for as long as that something is still arriving — an ease-out is a
    // third gone in the first eighth of its clock, which emptied the room before
    // the opening's spread had done any of its growing ("we've now lost the
    // zoom", 2026-08-14). Same curve as `openingGeometry.ts`'s `LANDING_EASE`,
    // so a caller that runs the two on one duration gets one gesture.
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const value = 1 + (fade.to - 1) * eased;
    if (value !== applied.current) write(value);
  });

  useEffect(() => {
    const materials = original.current;
    return () => {
      for (const [material, base] of materials) {
        material.opacity = base.opacity;
        if (material.transparent !== base.transparent) material.needsUpdate = true;
        material.transparent = base.transparent;
      }
      materials.clear();
    };
  }, []);

  return <group ref={groupRef}>{children}</group>;
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
 * Keeps layer `id` on the canvas after the room that registered it has
 * unmounted, for as long as the calling component is mounted. `null` holds
 * nothing.
 *
 * M23 §E's rework: the opening is a *transition between rooms*, and the room
 * it leaves has to still be there while the book climbs out of it — otherwise
 * the Desk (or the shelf) blinks out on the click and the book spends a second
 * travelling across the room it is only just arriving in. The reader mounts and
 * loads underneath the whole time, hidden behind the held surface, which is why
 * `contentReady` usually resolves long before it is needed.
 *
 * ⚠️ The held room is **scenery, not a room you are in**: its DOM is gone, so
 * nothing in it is hoverable, clickable or focusable, and no gesture it owned
 * still works. That is exactly what is wanted here (the user has already left)
 * and is the reason this is a hold on one *layer* rather than a second mounted
 * room — two live rooms would mean two of every fetch, shortcut and drag
 * handler, and two cameras fighting over `set({ camera })`.
 */
export function useScene3DHold(id: string | null): void {
  const { holdLayer, releaseLayer } = useScene3DContext();
  useEffect(() => {
    if (!id) return;
    holdLayer(id);
    return () => releaseLayer(id);
  }, [id, holdLayer, releaseLayer]);
}

/**
 * Fades layer `id` alone toward `fade.to` over `fade.ms`, and hands it back at
 * its authored opacity on `null` or on unmount.
 *
 * ⚠️ **Not the same tool as `useScene3DFade` below, and the difference is the
 * whole reason this exists** (2026-08-14). The canvas-wide fade can only take
 * *everything* — and during the landing the canvas holds two things that want
 * opposite treatment: the room the book left, which should be gone by the time
 * the spread arrives, and the book itself, which is the thing arriving. Fading
 * both is a ghost book mid-flight over an empty page; fading neither is what the
 * operator saw — a desk still fully drawn behind an almost-open reader, and then
 * blinking out at the end ("it looks weird ... then it awkwardly disappears").
 * So the room goes on its own clock, and the canvas fade keeps its one job: the
 * handoff, where the book and the pane are the same picture anyway.
 *
 * Held layers are the expected subject: the room is scenery by then
 * (`useScene3DHold`), so nothing about a fading layer is interactive.
 */
export function useScene3DLayerFade(id: string | null, fade: LayerFade | null): void {
  const { setLayerFade } = useScene3DContext();
  useEffect(() => {
    if (!id) return;
    setLayerFade(id, fade);
    return () => setLayerFade(id, null);
  }, [id, fade, setLayerFade]);
}

/**
 * Fades the **whole shared canvas** out over `ms` while the calling component
 * asks for it, and restores it instantly on unmount or on `null`.
 *
 * ⚠️ The whole canvas, not one layer, and that is not a shortcut. The canvas is
 * a single fixed layer that paints *over* the page (settled decision 14c), so
 * nothing in the DOM can crossfade with what is drawn in it — which is exactly
 * why the opening's backdrop carries no tint (`BookOpening.module.css`). The one
 * consumer is the opening's handoff, where the canvas holds precisely two
 * things: the room the book left, and the book, now landed on the reading pane
 * and printed with a picture of it. Both should go at once — the room because
 * the reader's own room is coming up underneath it, the book because the pane it
 * is lying on is the same picture. Fading either alone would be the wrong half.
 *
 * ⚠️ **Only the handoff, and only because of what the canvas holds *there*.** The
 * argument above does not extend to the 850ms of landing before it, where the room
 * is leaving and the book is arriving and the two want opposite treatment — that is
 * `useScene3DLayerFade`, which is the per-layer opacity this docstring used to say
 * the layer map could carry if a second caller ever wanted one. It did. The two now
 * split the sequence between them, and this one stayed a single field.
 */
export function useScene3DFade(ms: number | null): void {
  const { setFade } = useScene3DContext();
  useEffect(() => {
    setFade(ms);
    return () => setFade(null);
  }, [ms, setFade]);
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
