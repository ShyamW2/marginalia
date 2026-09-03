import { useEffect, useMemo, useState } from "react";
import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import { useScene3DAvailable, useScene3DLayer } from "../scene3d/Scene3D.js";
import { setDepartedBook } from "../scene3d/departedBook.js";
import { clearPutDown, usePutDownRequest, type PutDownDestination, type PutDownSnapshot } from "../scene3d/putDown.js";
import { BookOpening3D } from "./BookOpening3D.js";
import { LANDING_EASE, LANDING_MS, openSequenceMs } from "./openingGeometry.js";
import { PAGE_SETTLE_MS } from "./BookOpening.js";
import styles from "./BookClosing.module.css";

/** How long the bridge picture takes to hand off — to the 3D layer once it
 * has real geometry (an overlap, not a gap: `landingStep` reproduces this
 * exact picture at this exact rect at `landing = 1`, so the two are
 * pixel-identical for as long as they coexist), or to the Desk showing
 * through on a plain crossfade. */
const BRIDGE_FADE_MS = 200;

/** How long a destination is worth waiting for before giving up on it and
 * falling back to a plain crossfade — the resource genuinely not being on
 * the Desk in its current view (deleted mid-read, or some other race) is
 * the only way this fires in practice. */
const DESTINATION_TIMEOUT_MS = 2000;

/**
 * M33 §C "the put-down": mounted once, persistently, from `App.tsx` — there
 * is no room to mount it *from* the way `BookOpening` mounts from
 * `ReaderPage`, because by the time a destination is known the reader has
 * already unmounted (`putDown.ts`'s own docstring). Its whole life is driven
 * by the store instead of by props, and it renders nothing while the store
 * is empty.
 */
export function BookClosingHost() {
  const request = usePutDownRequest();
  if (!request.resourceId || !request.snapshot) return null;
  return (
    <BookClosing
      key={request.resourceId}
      resourceId={request.resourceId}
      title={request.title}
      snapshot={request.snapshot}
      destination={request.destination}
    />
  );
}

interface BookClosingProps {
  resourceId: string;
  title: string;
  snapshot: PutDownSnapshot;
  destination: PutDownDestination | null;
}

type Phase = "waiting" | "landing" | "settling" | "closing";

/**
 * The put-down, as DESIGN.md states it: "the literal reversal of the
 * opening." TASKS.md M33 §C2 is explicit that this must reuse the opening's
 * own machinery rather than build a second one — and because `BookOpening3D`
 * is already a pure function of `progress`/`landing`/`settle` motion values
 * with no direction baked in, that reuse is literal: this component renders
 * `BookOpening3D` itself, driving those same values from 1 down to 0 instead
 * of 0 up to 1, on the exact constants (`LANDING_MS`, `LANDING_EASE`,
 * `PAGE_SETTLE_MS`, `openSequenceMs`) the opening was tuned on.
 *
 * ⚠️ **No hold, unlike the opening.** `useScene3DHold` exists to keep a room
 * drawing after the route that owned it has gone — the opening needs that
 * because the Desk is the room being *left*. Here the Desk is the room being
 * *arrived at*: by the time this component has anything to draw, `navigate
 * ("/")` has already run and the Desk is the live route, registering its own
 * "desk"/"shelf" layer for real. The only thing genuinely borrowed from the
 * opening's toolkit is `departedBook` (so the Desk doesn't draw the book
 * twice) and `useScene3DLayer` (to draw it in flight) — see NOTES.md "M33".
 */
function BookClosing({ resourceId, title, snapshot, destination }: BookClosingProps) {
  const reducedMotion = Boolean(useReducedMotion());
  const scene3DAvailable = useScene3DAvailable();

  useEffect(() => {
    setDepartedBook(resourceId);
    return () => setDepartedBook(null);
  }, [resourceId]);

  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (destination) return;
    const timer = setTimeout(() => setTimedOut(true), DESTINATION_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [destination]);

  // Null pose (the list view, which has no 3D presentation to continue —
  // the same reason the opening's own `pose` is null from there) or reduced
  // motion or a lost context all collapse to the same crossfade, exactly as
  // BookOpening's `use3D` gate does.
  const use3D = Boolean(destination?.pose) && scene3DAvailable && !reducedMotion;
  const settled = destination !== null || timedOut;

  const [phase, setPhase] = useState<Phase>("waiting");
  const [finished3D, setFinished3D] = useState(false);
  const progress = useMotionValue(1);
  const landing = useMotionValue(1);
  const settle = useMotionValue(1);

  useEffect(() => {
    if (phase !== "waiting" || !settled) return;
    setPhase(use3D ? "landing" : "closing");
  }, [phase, settled, use3D]);

  // The spread flying off the reading pane, back toward the centred, fully
  // open pose — "the reading pane zooms out", read literally.
  useEffect(() => {
    if (phase !== "landing") return;
    const controls = animate(landing, 0, { duration: LANDING_MS / 1000, ease: LANDING_EASE });
    controls.then(() => setPhase("settling"));
    return () => controls.stop();
  }, [phase, landing]);

  // The mirror of the opening's own settle beat: the book relaxing back to
  // its authored proportions (see `flattenTowardPane`) before it travels,
  // rather than travelling home stretched to the pane's aspect the whole way.
  useEffect(() => {
    if (phase !== "settling") return;
    const controls = animate(settle, 0, { duration: PAGE_SETTLE_MS / 1000, ease: "easeOut" });
    controls.then(() => setPhase("closing"));
    return () => controls.stop();
  }, [phase, settle]);

  // "The book closes onto its cover; the cover travels to its place" — the
  // opening's own travel/open/recentre sequence, run at progress 1 → 0.
  useEffect(() => {
    if (phase !== "closing" || !use3D || !destination?.pose) return;
    const controls = animate(progress, 0, {
      duration: openSequenceMs(destination.pose.surface) / 1000,
      ease: "linear",
    });
    controls.then(() => setFinished3D(true));
    return () => controls.stop();
  }, [phase, use3D, destination, progress]);

  const sceneNode = useMemo(
    () =>
      use3D && destination?.pose ? (
        <BookOpening3D
          pose={destination.pose}
          resourceId={resourceId}
          title={title}
          progress={progress}
          landing={landing}
          settle={settle}
          stage={snapshot.stage}
          paneAspect={snapshot.paneAspect}
          spreadImage={snapshot.spreadImage}
          spreadInset={snapshot.spreadInset}
        />
      ) : null,
    [use3D, destination, resourceId, title, progress, landing, settle, snapshot],
  );
  useScene3DLayer("book-closing", sceneNode);

  // The bridge fades the instant there is somewhere else to look — either
  // the 3D layer above (already drawing the same picture at `landing = 1`)
  // or, on a crossfade, the Desk itself, already live underneath. Kept
  // mounted through its own fade rather than pulled the instant `phase`
  // changes, so a 3D layer that takes an extra frame or two to actually
  // paint (`useScene3DLayer`'s registration is itself an effect, one commit
  // behind this one) still has a picture over it the whole time.
  const [bridgeFading, setBridgeFading] = useState(false);
  const [bridgeGone, setBridgeGone] = useState(false);
  useEffect(() => {
    if (phase !== "waiting") setBridgeFading(true);
  }, [phase]);

  const done = use3D ? finished3D : bridgeGone;
  useEffect(() => {
    if (done) clearPutDown();
  }, [done]);

  return !bridgeGone ? (
    <motion.div
      className={styles.bridge}
      style={{
        left: snapshot.stage.x,
        top: snapshot.stage.y,
        width: snapshot.stage.width,
        height: snapshot.stage.height,
      }}
      initial={{ opacity: 1 }}
      animate={{ opacity: bridgeFading ? 0 : 1 }}
      transition={{ duration: reducedMotion ? 0.001 : BRIDGE_FADE_MS / 1000, ease: "easeOut" }}
      onAnimationComplete={() => {
        if (bridgeFading) setBridgeGone(true);
      }}
      aria-hidden="true"
    >
      {snapshot.spreadImage && <img src={snapshot.spreadImage} alt="" className={styles.bridgeImage} />}
    </motion.div>
  ) : null;
}
