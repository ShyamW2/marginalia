import { describe, expect, it } from "vitest";
import {
  anchorForPinch,
  anchorPoint,
  computeConeFold,
  computeFold,
  coneLiftAt,
  constrainFoldPointer,
  hingeRelease,
  hingeSettlePointer,
  settleArc,
  constrainToSpineHinge,
  curlArcLength,
  deformPoint,
  deformPointOnCone,
  spineEdgeForAnchor,
  syntheticFoldPointer,
  syntheticHingePointer,
  type Corner,
  type FoldAnchor,
  type Point,
} from "./pageFold.js";

/**
 * M27, "the geometry grows an apex" and "the sheet hinges at the spine". The
 * cone is the model over-the-spine needs and the flat-crease roll cannot
 * express — see `ConeFold` for the proof it rests on. The renderer is still
 * the flat one; these pin the pure geometry ahead of it.
 */

const W = 600;
const H = 800;
const CORNERS: readonly Corner[] = ["topLeft", "topRight", "bottomLeft", "bottomRight"];
/** Every kind of anchor the geometry can be handed, including the `EdgePinch`
 * that replaces the other two once the sheet is bound — a mid-edge one, which
 * is the case the flat model had to pin flat, and an off-centre one, which is
 * the case neither of the old two could name at all. */
const PINCHES: readonly FoldAnchor[] = [
  { edge: "left", t: 0.5 },
  { edge: "right", t: 0.5 },
  { edge: "right", t: 0.22 },
];
const ANCHORS: readonly FoldAnchor[] = [
  ...CORNERS,
  { edge: "left" },
  { edge: "right" },
  ...PINCHES,
];

/**
 * Both page modes, in the only terms the geometry knows them: a leaf is a
 * rect, and `nearLeafRect` hands it half the stage in spread mode and all of
 * it in single-page. One model, two sizes — which is the whole of §2d's
 * "both modes keep one model".
 */
const LEAVES = [
  { mode: "spread", width: 460, height: 760 },
  { mode: "single-page", width: 920, height: 760 },
] as const;

/** `pageFold.ts`'s own `FAR_APEX_DIAGONALS`, which is private to it. Only ever
 * used here to ask "was this apex solved or merely held", so an approximation
 * of it is the honest thing to keep: a test that had to be edited whenever the
 * constant moved would be pinning the wrong thing. */
const FAR_APEX_DIAGONALS_APPROX = 1e6;

/** Drag depths well past the point where a tail exists, plus one shallow one. */
const DEPTHS = [0.15, 0.35, 0.6, 0.85];

/** A pointer dragged from `anchor` toward the opposite corner at `t` of the way. */
function draggedPointer(anchor: FoldAnchor, t: number): Point {
  const c = anchorPoint(anchor, W, H);
  // Aim at the opposite corner, which is the natural peel path.
  const to = { x: W - c.x, y: H - c.y };
  return { x: c.x + (to.x - c.x) * t, y: c.y + (to.y - c.y) * t };
}

function spineX(anchor: FoldAnchor, width = W): number {
  return spineEdgeForAnchor(anchor) === "left" ? 0 : width;
}

/** Every direction, every depth, and both synthetic sweeps — the closest a
 * unit test gets to "at every drag depth and from every anchor". */
function everyDrag(anchor: FoldAnchor, width: number, height: number): Point[] {
  const c = anchorPoint(anchor, width, height);
  const diagonal = Math.hypot(width, height);
  const out: Point[] = [];
  for (let k = 0; k < 32; k++) {
    const theta = (k / 32) * Math.PI * 2;
    for (const r of [6, 40, 150, 0.5 * diagonal, diagonal, 2.2 * diagonal]) {
      out.push({ x: c.x + Math.cos(theta) * r, y: c.y + Math.sin(theta) * r });
    }
  }
  for (let i = 0; i <= 24; i++) {
    out.push(syntheticFoldPointer(anchor, width, height, i / 24));
    out.push(syntheticHingePointer(anchor, width, height, i / 24));
  }
  return out;
}

describe("spineEdgeForAnchor", () => {
  it("is always the edge opposite the grab, for corners and edges alike", () => {
    // One rule for both page modes — PAGE_CURL.md §2d. A single page is still
    // bound; it merely has no facing leaf to land on.
    expect(spineEdgeForAnchor("bottomRight")).toBe("left");
    expect(spineEdgeForAnchor("topRight")).toBe("left");
    expect(spineEdgeForAnchor("bottomLeft")).toBe("right");
    expect(spineEdgeForAnchor("topLeft")).toBe("right");
    expect(spineEdgeForAnchor({ edge: "right" })).toBe("left");
    expect(spineEdgeForAnchor({ edge: "left" })).toBe("right");
  });
});

describe("EdgePinch — the anchor is where the paper was grabbed", () => {
  it("puts the anchor at the grab, and makes the corners its own endpoints", () => {
    // The point of the kind: no band, no snap. A grab a fifth of the way down
    // anchors a fifth of the way down, and `t = 0`/`t = 1` are not special
    // cases that agree with the corners — they *are* them.
    expect(anchorPoint(anchorForPinch("right", H * 0.2, H), W, H)).toEqual({ x: W, y: H * 0.2 });
    expect(anchorPoint(anchorForPinch("left", H * 0.2, H), W, H)).toEqual({ x: 0, y: H * 0.2 });
    expect(anchorPoint({ edge: "right", t: 0 }, W, H)).toEqual(anchorPoint("topRight", W, H));
    expect(anchorPoint({ edge: "right", t: 1 }, W, H)).toEqual(anchorPoint("bottomRight", W, H));
    expect(anchorPoint({ edge: "left", t: 0 }, W, H)).toEqual(anchorPoint("topLeft", W, H));
    expect(anchorPoint({ edge: "left", t: 1 }, W, H)).toEqual(anchorPoint("bottomLeft", W, H));
    // A grab surface may be a shade taller than the leaf; the paper is not.
    expect(anchorForPinch("right", -30, H).t).toBe(0);
    expect(anchorForPinch("right", H + 30, H).t).toBe(1);
    expect(spineEdgeForAnchor({ edge: "right", t: 0.4 })).toBe("left");
    expect(spineEdgeForAnchor({ edge: "left", t: 0.4 })).toBe("right");
  });

  it("is not pinned flat the way an edge peel is — it fans like a corner", () => {
    // The whole reason the kind exists. `EdgeAnchor`'s crease is held parallel
    // to the spine because a flat crease cannot converge; a cone's rulings do,
    // so the *same* grab tilts once it is a pinch. Pull square across and the
    // apex is at infinity (the cylinder); pull up and across and it comes in.
    const pinch: FoldAnchor = { edge: "right", t: 0.5 };
    const c = anchorPoint(pinch, W, H);
    expect(constrainFoldPointer(pinch, { x: c.x - 200, y: c.y - 260 }, W, H)).toEqual({
      x: c.x - 200,
      y: c.y - 260,
    });
    // ...where the edge peel of the same grab throws the tilt away.
    expect(constrainFoldPointer({ edge: "right" }, { x: c.x - 200, y: c.y - 260 }, W, H)).toEqual({
      x: c.x - 200,
      y: c.y,
    });

    const square = computeConeFold(pinch, { x: c.x - 200, y: c.y }, W, H)!;
    const tilted = computeConeFold(pinch, { x: c.x - 200, y: c.y - 60 }, W, H)!;
    // Square across is the far field: the apex is held a million diagonals off
    // and the two ends of the crease lift alike.
    expect(Math.abs(square.apex.y)).toBeGreaterThan(H * 1e5);
    const squareTop = coneLiftAt(square, { x: W, y: 0 });
    const squareBottom = coneLiftAt(square, { x: W, y: H });
    // Alike to a millionth, not to the last bit: the apex is held far rather
    // than actually at infinity, so the far corner is a hair further from it.
    expect(Math.abs(squareTop - squareBottom) / squareTop).toBeLessThan(1e-5);
    // Pulled up and across, the apex comes in to a few leaf-lengths and the
    // fan opens: the two ends of the outer edge stop lifting alike.
    //
    // Which of them lifts *more* is deliberately not asserted, because it is
    // not monotonic in the tilt and the reason is real geometry rather than a
    // wobble: lift is `r * arcAngle * profile`, so the corner further from the
    // apex has the longer arc while the corner at the larger fan angle is
    // further past the crease, and the two trade places as the drag steepens.
    // A hard pull up ends as a diagonal fold hinged on the *bottom* gutter
    // corner with the top corner left lying flat, which is what paper does.
    // See NOTES.md 2026-08-26.
    expect(Math.abs(tilted.apex.y)).toBeLessThan(H * 1e3);
    const tiltedTop = coneLiftAt(tilted, { x: W, y: 0 });
    const tiltedBottom = coneLiftAt(tilted, { x: W, y: H });
    expect(Math.abs(tiltedTop - tiltedBottom) / tiltedTop).toBeGreaterThan(0.1);
  });

  it("crosses its own height without the sheet jumping", () => {
    // A mid-edge pinch sits exactly on the apex's sign change — the apex runs
    // off whichever end of the spine the pointer passes, and for *this* anchor
    // the crossing is the natural drag rather than an unusual one. The two
    // held apexes are ~1e-3 px apart by `FAR_APEX_DIAGONALS`'s construction,
    // so this must not be able to be felt. Move that constant nearer and this
    // is the test that goes first.
    const pinch: FoldAnchor = { edge: "right", t: 0.5 };
    const probe = { x: W * 0.72, y: H * 0.5 };
    const steps = 600;
    const span = H * 0.6;
    const step = span / steps;
    let previous: Point | null = null;
    let previousApexY: number | null = null;
    let swapped = false;
    for (let i = 0; i <= steps; i++) {
      const y = H * 0.5 - span / 2 + step * i;
      const cone = computeConeFold(pinch, { x: W * 0.3, y }, W, H);
      expect(cone).not.toBeNull();
      if (previousApexY !== null && cone!.apex.y > 0 !== previousApexY > 0) swapped = true;
      previousApexY = cone!.apex.y;
      const here = deformPointOnCone(cone!, probe);
      if (previous) {
        expect(Math.hypot(here.x - previous.x, here.y - previous.y)).toBeLessThan(step * 3);
      }
      previous = here;
    }
    // The swap has to actually happen, or the assertions above proved nothing
    // about the case this test is named for.
    expect(swapped).toBe(true);
  });
});

describe("computeConeFold — the three invariants a bound sheet owes", () => {
  it("lands the grabbed anchor exactly under the pointer, everywhere it can reach", () => {
    // The property a drag lives or dies by, carried over from the flat model.
    // Under a cone it is what *forces* the apex to be solved rather than given.
    // It is now stated against the pointer as the hinge can honour it: paper
    // that has run out does not stretch to the finger. `constrainToSpineHinge`
    // is that limit, and it is the identity for every ordinary peel.
    for (const corner of CORNERS) {
      for (const t of DEPTHS) {
        const pointer = draggedPointer(corner, t);
        const reached = constrainToSpineHinge(corner, pointer, W, H);
        const cone = computeConeFold(corner, pointer, W, H);
        expect(cone).not.toBeNull();
        if (cone!.creaseAngle <= 0) continue; // fully turned; see the saturation test
        const landed = deformPointOnCone(cone!, anchorPoint(corner, W, H));
        // Not exact to the last bit only because a far-held apex foreshortens
        // the anchor's radius by `anchorToSpine^2 / 2R` — real geometry, and
        // four decimal places below a pixel.
        expect(landed.x).toBeCloseTo(reached.x, 3);
        expect(landed.y).toBeCloseTo(reached.y, 3);
      }
    }
  });

  it("never moves the spine edge, at any drag depth or anchor, in either page mode", () => {
    // M27's "the gutter-side corners cannot curl away", and the reason the
    // whole model had to change: a cylinder lifts uniformly and would tear a
    // bound sheet off its binding. Here the spine is angle 0, so it is fixed by
    // construction rather than by a clamp — and the drag is clamped instead, so
    // that there is no depth at which the construction stops applying.
    // Acceptance asks for a pixel; this holds to a millionth of one.
    for (const { width, height } of LEAVES) {
      for (const anchor of ANCHORS) {
        for (const pointer of everyDrag(anchor, width, height)) {
          const cone = computeConeFold(anchor, pointer, width, height);
          if (!cone) continue; // the sheet did not move at all
          const x = spineX(anchor, width);
          for (const y of [0, height * 0.25, height * 0.5, height * 0.75, height]) {
            const moved = deformPointOnCone(cone, { x, y });
            expect(moved.x).toBeCloseTo(x, 6);
            expect(moved.y).toBeCloseTo(y, 6);
            // ...and it is not merely projecting back onto itself: it is flat.
            expect(coneLiftAt(cone, { x, y })).toBeCloseTo(0, 9);
          }
        }
      }
    }
  });

  it("lifts nothing at the spine and most at the outer corner", () => {
    // The physical requirement the cone exists to satisfy. A cylinder's lift
    // is constant across the sheet; this one has to fall to zero at the
    // binding and grow with distance from the apex.
    const corner: Corner = "bottomRight";
    const cone = computeConeFold(corner, draggedPointer(corner, 0.6), W, H);
    expect(cone).not.toBeNull();
    const atSpine = coneLiftAt(cone!, { x: 0, y: H / 2 });
    const atOuter = coneLiftAt(cone!, anchorPoint(corner, W, H));
    expect(atSpine).toBeCloseTo(0, 9);
    expect(atOuter).toBeGreaterThan(0);
  });

  it("covers the whole leaf, but for the spine edge, by progress 1", () => {
    // "The leaf is still fully covered by progress 1", restated for a hinge:
    // the one thing left lying flat is the binding itself, which is the point.
    // The path is `syntheticHingePointer`, because the flat sweep's 2.2x
    // diagonal overshoot is not a path a bound sheet can take — see below.
    for (const { width, height } of LEAVES) {
      for (const anchor of ANCHORS) {
        const cone = computeConeFold(
          anchor,
          syntheticHingePointer(anchor, width, height, 1),
          width,
          height,
        );
        expect(cone).not.toBeNull();
        const sx = spineX(anchor, width);
        for (const x of [width * 0.05, width * 0.5, width]) {
          for (const y of [0, height * 0.5, height]) {
            if (Math.abs(x - sx) < 1e-9) continue;
            expect(coneLiftAt(cone!, { x, y })).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});

describe("constrainToSpineHinge — the binding is a limit on the drag too", () => {
  it("leaves an ordinary peel exactly where it is", () => {
    // The clamp is the identity everywhere a real dog-ear happens; it exists
    // for the far end of a turn, not for the middle of one.
    for (const corner of CORNERS) {
      for (const t of [0.1, 0.25, 0.4]) {
        const pointer = draggedPointer(corner, t);
        expect(constrainToSpineHinge(corner, pointer, W, H)).toEqual(pointer);
      }
    }
  });

  it("gives nothing to a pull straight outward, away from the spine", () => {
    // There is no more sheet in that direction: the corner is already as far
    // from its gutter corner as the paper reaches.
    for (const anchor of ANCHORS) {
      const c = anchorPoint(anchor, W, H);
      const outward = spineEdgeForAnchor(anchor) === "left" ? 1 : -1;
      const reached = constrainToSpineHinge(anchor, { x: c.x + outward * 300, y: c.y }, W, H);
      expect(reached.x).toBeCloseTo(c.x, 9);
      expect(reached.y).toBeCloseTo(c.y, 9);
      expect(computeConeFold(anchor, { x: c.x + outward * 300, y: c.y }, W, H)).toBeNull();
    }
  });

  it("keeps the apex off the binding — which is the whole reason it exists", () => {
    // The clamp was derived from this and not the other way round: `apexY = 0`
    // and `apexY = height` are exactly the two circles through the anchor, so
    // the lens between them is precisely the set of drags a cone can express
    // with its apex off the leaf's own span of the spine. An apex *on* the
    // binding would put the two halves of the spine edge on opposite rays and
    // there would be no fixed binding at all.
    for (const { width, height } of LEAVES) {
      for (const anchor of ANCHORS) {
        for (const pointer of everyDrag(anchor, width, height)) {
          const cone = computeConeFold(anchor, pointer, width, height);
          if (!cone) continue;
          expect(cone.apex.x).toBe(spineX(anchor, width));
          expect(cone.apex.y <= 0 || cone.apex.y >= height).toBe(true);
        }
      }
    }
  });

  it("moves the fold no faster than the pointer that drives it", () => {
    // A regression guard with a real failure behind it: a clamp that projects
    // the pointer onto the *nearest* point of the lens reads plausibly and
    // snaps the sheet ~750px end for end partway through a diagonal sweep,
    // because a lens is a sliver and its nearest point flips. Following the
    // drag's own direction to where it leaves the lens does not.
    const steps = 400;
    for (const anchor of ANCHORS) {
      const c = anchorPoint(anchor, W, H);
      const to = { x: W - c.x, y: H - c.y };
      const at = (s: number) => ({
        x: c.x + (to.x - c.x) * (s / steps) * 2.2,
        y: c.y + (to.y - c.y) * (s / steps) * 2.2,
      });
      const probe = { x: W * 0.5, y: H * 0.5 };
      const step = Math.hypot(to.x - c.x, to.y - c.y) * (2.2 / steps);
      let previous: Point | null = null;
      for (let s = 0; s <= steps; s++) {
        const cone = computeConeFold(anchor, at(s), W, H);
        const here = cone ? deformPointOnCone(cone, probe) : null;
        if (previous && here) {
          expect(Math.hypot(here.x - previous.x, here.y - previous.y)).toBeLessThan(step * 3);
        }
        previous = here;
      }
    }
  });
});

describe("hingeRelease — the sheet finishes the turn on the hinge it already has", () => {
  /** A drag stopped partway, from every anchor and at four depths. */
  function releases(): { anchor: FoldAnchor; pointer: Point }[] {
    const out: { anchor: FoldAnchor; pointer: Point }[] = [];
    for (const anchor of ANCHORS) {
      for (const t of DEPTHS) {
        out.push({ anchor, pointer: draggedPointer(anchor, t) });
        // ...and one pulled hard enough to be sitting on the clamp, which is
        // the release the whole thing exists for (a drag cannot reach the end).
        out.push({ anchor, pointer: syntheticHingePointer(anchor, W, H, t) });
      }
    }
    return out;
  }

  it("swings the pointer onto the fully-turned pose", () => {
    for (const { anchor, pointer } of releases()) {
      const release = hingeRelease(anchor, pointer, W, H);
      expect(release).not.toBeNull();
      const landed = hingeSettlePointer(release!, release!.toTurned);
      const turned = syntheticHingePointer(anchor, W, H, 1);
      expect(landed.x).toBeCloseTo(turned.x, 3);
      expect(landed.y).toBeCloseTo(turned.y, 3);
    }
  });

  it("lands the sheet flat on the far side of the spine, with the arc relaxed", () => {
    // The landing itself, which is the swing *and* `settleArc` — the whole
    // point of that function is that the first without the second does not
    // land. Both criteria are the ones an invisible unmount needs: the sheet's
    // anchor on its mirror, and nothing of the leaf still off the page.
    const full = curlArcLength(W, H);
    for (const { anchor, pointer } of releases()) {
      const release = hingeRelease(anchor, pointer, W, H)!;
      const at = hingeSettlePointer(release, release.toTurned);
      const cone = computeConeFold(anchor, at, W, H, settleArc(full, 1));
      expect(cone).not.toBeNull();
      const mirror = syntheticHingePointer(anchor, W, H, 1);
      const landed = deformPointOnCone(cone!, anchorPoint(anchor, W, H));
      expect(landed.x).toBeCloseTo(mirror.x, 1);
      expect(landed.y).toBeCloseTo(mirror.y, 1);
      // Flat: a sheet still floating its own roll-diameter is the pop this
      // exists to remove.
      for (const x of [W * 0.25, W * 0.5, W * 0.75, W]) {
        for (const y of [0, H * 0.5, H]) {
          expect(coneLiftAt(cone!, { x, y })).toBeLessThan(0.5);
        }
      }
    }
  });

  it("does not land at all if the arc is held at the value it was dragged at", () => {
    // The measurement behind `settleArc`, kept as a test so the relax cannot be
    // quietly dropped as a flourish: with a fixed arc the crease saturates at
    // the binding and the sheet stops ~100px short, still lifted.
    const anchor: FoldAnchor = "bottomRight";
    const release = hingeRelease(anchor, draggedPointer(anchor, 0.35), W, H)!;
    const at = hingeSettlePointer(release, release.toTurned);
    const cone = computeConeFold(anchor, at, W, H)!;
    const mirror = syntheticHingePointer(anchor, W, H, 1);
    const landed = deformPointOnCone(cone, anchorPoint(anchor, W, H));
    expect(cone.creaseAngle).toBe(0); // saturated against the binding
    expect(Math.hypot(landed.x - mirror.x, landed.y - mirror.y)).toBeGreaterThan(50);
    expect(coneLiftAt(cone, { x: W * 0.5, y: H * 0.5 })).toBeGreaterThan(20);
  });

  it("puts the sheet back flat when it springs back instead", () => {
    for (const { anchor, pointer } of releases()) {
      const release = hingeRelease(anchor, pointer, W, H);
      const rested = hingeSettlePointer(release!, release!.toRest);
      const c = anchorPoint(anchor, W, H);
      expect(rested.x).toBeCloseTo(c.x, 3);
      expect(rested.y).toBeCloseTo(c.y, 3);
      // The anchor back under its own start is the fold at rest: nothing drawn.
      expect(computeConeFold(anchor, rested, W, H)).toBeNull();
    }
  });

  it("never leaves the lens, so nothing on the path is ever clamped", () => {
    // The claim that makes this a rotation rather than a lerp: every point of
    // the circle about a legal apex re-solves to that same apex, so the swing
    // cannot run out of paper partway. A lerp toward the turned pose does not
    // have this property and would be clamped — visibly — mid-flight.
    for (const { anchor, pointer } of releases()) {
      const release = hingeRelease(anchor, pointer, W, H)!;
      for (let i = 0; i <= 40; i++) {
        const at = hingeSettlePointer(release, release.toTurned * (i / 40));
        const reached = constrainToSpineHinge(anchor, at, W, H);
        expect(reached.x).toBeCloseTo(at.x, 3);
        expect(reached.y).toBeCloseTo(at.y, 3);
      }
    }
  });

  it("holds a real apex still for the whole swing, so the fan cannot collapse", () => {
    // ...which is what keeps the fan the drag opened. Re-solving the cone at
    // each step of the settle returns the apex the release froze — otherwise
    // the sheet is quietly relaxing toward the far field as it lands, and the
    // cone the milestone exists for is gone by the time you can see it.
    //
    // Stated of a *finite* apex only, and that is not a hedge. A release in
    // the far field has no apex to hold: it is held at
    // `FAR_APEX_DIAGONALS`, off one end or the other depending on which side
    // of square-on the pointer passed, and the swing can cross that. The two
    // held apexes differ by ~1e-3 px of geometry, which is what that constant
    // was sized for — so the invariant that covers the far field is the
    // continuity one below, not this one.
    const full = curlArcLength(W, H);
    const far = FAR_APEX_DIAGONALS_APPROX * Math.hypot(W, H);
    for (const { anchor, pointer } of releases()) {
      const release = hingeRelease(anchor, pointer, W, H)!;
      if (Math.abs(release.apex.y) > far * 0.5) continue; // held, not solved
      // Stops one step short of the landing, and for a stated reason rather
      // than to dodge a failure: at the fully-turned pose every point of the
      // spine is equidistant from anchor and pointer, so the apex is *not
      // determined* there (`bisectorApexY` says so). It does not matter,
      // because it is also the pose where `creaseAngle` reaches zero — the
      // crease becomes the spine itself and the sheet reflects across the
      // binding whatever apex the arithmetic happened to land on. The
      // continuity test below covers the landing, and measures no step there
      // bigger than the ordinary ones.
      for (let i = 1; i < 40; i++) {
        const t = i / 40;
        const at = hingeSettlePointer(release, release.toTurned * t);
        const cone = computeConeFold(anchor, at, W, H, settleArc(full, t));
        if (!cone) continue;
        expect(cone.apex.y).toBeCloseTo(release.apex.y, 6);
        expect(cone.apex.x).toBeCloseTo(release.apex.x, 9);
      }
    }
  });

  it("moves the sheet no faster than the swing that drives it", () => {
    // The invariant that does cover the far field, and the one a viewer would
    // actually notice: whatever the apex does with its own representation, the
    // paper may not jump. Note the arc relaxes over these steps too, so this
    // is the settle as it is really driven rather than the swing alone.
    const full = curlArcLength(W, H);
    const steps = 240;
    for (const { anchor, pointer } of releases()) {
      const release = hingeRelease(anchor, pointer, W, H)!;
      const probes = [
        { x: W * 0.5, y: H * 0.5 },
        { x: W * 0.95, y: H * 0.05 },
        { x: W * 0.95, y: H * 0.95 },
      ];
      let previous: Point[] | null = null;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const at = hingeSettlePointer(release, release.toTurned * t);
        const cone = computeConeFold(anchor, at, W, H, settleArc(full, t));
        if (!cone) {
          previous = null;
          continue;
        }
        const here = probes.map((q) => deformPointOnCone(cone, q));
        if (previous) {
          for (let k = 0; k < here.length; k++) {
            const moved = Math.hypot(here[k]!.x - previous[k]!.x, here[k]!.y - previous[k]!.y);
            // Measured worst over all releases is 9.7px at these 240 steps and
            // it halves as the steps double — i.e. smooth motion, not a bound
            // that happens to hold. The landing step is the same size as the
            // rest of them, which is the thing being claimed: the apex going
            // undetermined at the mirror is invisible in the paper.
            expect(moved).toBeLessThan(W / 50);
          }
        }
        previous = here;
      }
    }
  });

  it("reads a deeper drag as more of the turn already made", () => {
    // What the commit threshold reads, so it has to be monotone in the drag.
    for (const anchor of ANCHORS) {
      let previous = -Infinity;
      for (let i = 1; i <= 20; i++) {
        const release = hingeRelease(anchor, syntheticHingePointer(anchor, W, H, i / 20), W, H);
        expect(release).not.toBeNull();
        expect(release!.progress).toBeGreaterThan(previous);
        previous = release!.progress;
      }
      // The synthetic path's own end is the fully-turned pose, by definition.
      expect(previous).toBeCloseTo(1, 6);
    }
  });

  it("has nothing to settle when the sheet was never lifted", () => {
    for (const anchor of ANCHORS) {
      expect(hingeRelease(anchor, anchorPoint(anchor, W, H), W, H)).toBeNull();
    }
  });
});

describe("computeConeFold — the far field is the flat-crease roll", () => {
  it("answers a square pull with the cylinder, rather than handing it back", () => {
    // ⚠️ This test changed meaning in M27's hinge work rather than being
    // deleted. It used to assert `null` for a square pull — the apex really is
    // at infinity there, and the shipped flat model really is the right answer.
    // But handing the drag back to `computeFold` hands the spine back to a
    // model that lets it move, which is what the hinge exists to stop. So the
    // apex is *held* a million diagonals away instead and the cone answers
    // every drag; the two models agree far below a pixel, which is the point.
    const pointer = { x: W - 300, y: H / 2 };
    const cone = computeConeFold({ edge: "right" }, pointer, W, H);
    expect(cone).not.toBeNull();
    const flat = computeFold({ edge: "right" }, pointer, W, H);
    expect(flat).not.toBeNull();
    for (const x of [W * 0.1, W * 0.5, W * 0.9]) {
      for (const y of [0, H * 0.5, H]) {
        const viaCone = deformPointOnCone(cone!, { x, y });
        const viaFlat = deformPoint(flat!, { x, y });
        // The residue is the `L^2 / 2R` foreshortening of a radius measured
        // from a held apex rather than from infinity — real geometry of the
        // stand-in, and three decades below a device pixel.
        expect(Math.hypot(viaCone.x - viaFlat.x, viaCone.y - viaFlat.y)).toBeLessThan(1e-3);
      }
    }
  });

  it("converges on the flat model as the apex is pushed away along the spine", () => {
    // "Every existing property survives as the far-field degenerate case."
    // Drag an edge peel with a shrinking vertical component: the apex runs off
    // down the spine and the cone's answer approaches the flat model's.
    const anchor: FoldAnchor = { edge: "right" };
    const c = anchorPoint(anchor, W, H);
    const arc = curlArcLength(W, H);
    const probe = { x: W * 0.45, y: H * 0.5 };

    // Convergence is fast enough to reach the floating-point noise floor, so
    // "strictly decreasing" stops being meaningful once it is there.
    const NOISE = 1e-9;
    let previous = Infinity;
    for (const tilt of [40, 10, 2.5, 0.6]) {
      const pointer = { x: c.x - 300, y: c.y + tilt };
      const cone = computeConeFold(anchor, pointer, W, H, arc);
      expect(cone).not.toBeNull();
      const flat = computeFold(anchor, pointer, W, H, arc);
      expect(flat).not.toBeNull();

      const viaCone = deformPointOnCone(cone!, probe);
      const viaFlat = deformPoint(flat!, probe);
      const gap = Math.hypot(viaCone.x - viaFlat.x, viaCone.y - viaFlat.y);
      // Monotone convergence, not merely "small at the end".
      expect(gap).toBeLessThan(Math.max(previous, NOISE));
      previous = gap;
    }
    expect(previous).toBeLessThan(NOISE);
  });

  it("keeps an edge peel's crease parallel to the spine only in the far-field limit", () => {
    // ⚠️ This test changed meaning in M27 rather than being deleted. Under a
    // hinge the crease converges on the apex, so it is *not* parallel to the
    // spine — the flat model's version of this property is now a statement
    // about the limit. Measured as the spread in how far two points on the
    // same crease-side sit from the spine after deformation.
    const anchor: FoldAnchor = { edge: "right" };
    const c = anchorPoint(anchor, W, H);
    const spread = (tilt: number) => {
      const cone = computeConeFold(anchor, { x: c.x - 300, y: c.y + tilt }, W, H);
      if (!cone) return 0;
      const a = deformPointOnCone(cone, { x: W * 0.5, y: H * 0.2 });
      const b = deformPointOnCone(cone, { x: W * 0.5, y: H * 0.8 });
      return Math.abs(a.x - b.x);
    };
    // A pronounced hinge fans visibly; a nearly-square pull does not.
    expect(spread(120)).toBeGreaterThan(spread(3));
    expect(spread(0.5)).toBeLessThan(1);
  });
});

describe("syntheticHingePointer — the flat sweep is not a path a bound sheet can take", () => {
  it("stays reachable the whole way, where the flat sweep leaves the sheet behind", () => {
    for (const anchor of ANCHORS) {
      for (let i = 0; i <= 20; i++) {
        const hinged = syntheticHingePointer(anchor, W, H, i / 20);
        expect(constrainToSpineHinge(anchor, hinged, W, H).x).toBeCloseTo(hinged.x, 6);
        expect(constrainToSpineHinge(anchor, hinged, W, H).y).toBeCloseTo(hinged.y, 6);
      }
    }
  });

  it("exists because the flat sweep stalls a hinge with the leaf uncovered", () => {
    // The substantive claim, not a displacement threshold: run the flat
    // model's own path against the hinge and a *corner* grab never finishes.
    // Its 2.2x diagonal overshoot leaves the lens early, the clamp holds the
    // anchor there, and most of the leaf is still lying flat at progress 1.
    // (An edge grab is unaffected — that path is already square across, and
    // only overshoots the mirror.)
    for (const corner of CORNERS) {
      const cone = computeConeFold(corner, syntheticFoldPointer(corner, W, H, 1), W, H);
      expect(cone).not.toBeNull();
      let flat = 0;
      let total = 0;
      for (let i = 1; i <= 8; i++) {
        for (let j = 0; j <= 8; j++) {
          const x = spineX(corner) === 0 ? (W * i) / 8 : W - (W * i) / 8;
          total++;
          if (coneLiftAt(cone!, { x, y: (H * j) / 8 }) <= 0) flat++;
        }
      }
      expect(flat / total).toBeGreaterThan(0.25);
    }
  });

  it("finishes with the anchor turned onto the far side of the spine", () => {
    for (const anchor of ANCHORS) {
      const end = syntheticHingePointer(anchor, W, H, 1);
      const sx = spineX(anchor);
      const c = anchorPoint(anchor, W, H);
      expect(end.y).toBe(c.y);
      expect(end.x).toBeCloseTo(2 * sx - c.x, 9);
    }
  });
});
