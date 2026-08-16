import { describe, expect, it } from "vitest";
import { PAGE_LIFT, bookParts, openSpread } from "../scene3d/bookGeometry.js";
import type { OpeningPose } from "../scene3d/openingPose.js";
import {
  DESK_SEQUENCE_MS,
  HANDOFF_DELAY_MS,
  LANDING_EASE,
  LANDING_MS,
  ROOM_FADE_DELAY_MS,
  ROOM_FADE_MS,
  SHELF_SEQUENCE_MS,
  SPREAD_FLATTEN_FLOOR,
  creaseX,
  flattenTowardPane,
  landingStep,
  lerpToLanding,
  openingStep,
  recentreDistance,
  spreadAspect,
  spreadRect,
} from "./openingGeometry.js";

const VIEWPORT = { width: 1440, height: 900 };

/** A book as the Desk hands it over: lying flat, cover up, nudged a few degrees
 * off square and parked away from the viewport's centre. */
const DESK_POSE: OpeningPose = {
  surface: "desk",
  width: 168,
  height: 252,
  thickness: 22,
  centerX: 320,
  centerY: 610,
  centerZ: 11.35,
  yaw: 0,
  roll: -0.07,
};

/** And as the shelf does: standing spine-out, body receding away from the
 * camera, so its bounding box centre is *behind* the 1:1 plane. */
const SHELF_POSE: OpeningPose = {
  surface: "shelf",
  width: 240,
  height: 360,
  thickness: 46,
  centerX: 880,
  centerY: 300,
  centerZ: -120,
  yaw: Math.PI / 2,
  roll: 0,
};

const STAGE = { x: 372, y: 96, width: 696, height: 742 };

describe("openSpread", () => {
  it("is exactly two boards wide, creased at the hinge", () => {
    const parts = bookParts(168, 252, 22);
    const spread = openSpread(168, 252, 22);
    expect(spread.width).toBeCloseTo(parts.boardWidth * 2, 10);
    expect(spread.creaseX).toBeCloseTo(parts.bulge, 10);
    // The crease is the spread's own centre — the property the landing depends
    // on, and the thing today's `.spread { inset: 0 }` gets wrong by half a
    // cover.
    expect((spread.left + spread.right) / 2).toBeCloseTo(spread.creaseX, 10);
  });

  it("puts the front board's free edge where a 180° swing about the hinge leaves it", () => {
    const parts = bookParts(168, 252, 22);
    // Closed, the board spans [bulge, bulge + boardWidth]; opened flat about
    // x = bulge it spans [bulge - boardWidth, bulge].
    expect(openSpread(168, 252, 22).left).toBeCloseTo(parts.bulge - parts.boardWidth, 10);
  });
});

describe("openingStep", () => {
  it("starts exactly where the book was — the whole of object permanence", () => {
    for (const pose of [DESK_POSE, SHELF_POSE]) {
      const step = openingStep(0, pose, VIEWPORT);
      expect(step.position.x).toBeCloseTo(pose.centerX, 10);
      expect(step.position.y).toBeCloseTo(pose.centerY, 10);
      expect(step.position.z).toBeCloseTo(pose.centerZ, 10);
      expect(step.yaw).toBeCloseTo(pose.yaw, 10);
      expect(step.roll).toBeCloseTo(pose.roll, 10);
      expect(step.openProgress).toBe(0);
      expect(step.recentre).toBe(0);
    }
  });

  it("ends centred, square to the camera, fully open, with the crease on the viewport's axis", () => {
    for (const pose of [DESK_POSE, SHELF_POSE]) {
      const step = openingStep(1, pose, VIEWPORT);
      expect(step.position.x).toBeCloseTo(VIEWPORT.width / 2, 10);
      expect(step.position.y).toBeCloseTo(VIEWPORT.height / 2, 10);
      expect(step.yaw).toBeCloseTo(0, 10);
      expect(step.roll).toBeCloseTo(0, 10);
      expect(step.openProgress).toBeCloseTo(1, 10);
      expect(step.recentre).toBeCloseTo(recentreDistance(pose), 10);
      // TASKS.md: "the scene then translates so the crease sits centred".
      expect(creaseX(step, pose)).toBeCloseTo(VIEWPORT.width / 2, 10);
    }
  });

  it("opens to a spread twice the cover's width, still at 1:1", () => {
    const parts = bookParts(DESK_POSE.width, DESK_POSE.height, DESK_POSE.thickness);
    const rect = spreadRect(openingStep(1, DESK_POSE, VIEWPORT), DESK_POSE);
    expect(rect.width).toBeCloseTo(parts.boardWidth * 2, 10);
    expect(rect.height).toBeCloseTo(DESK_POSE.height, 10);
  });

  it("leaves the shelf toward the camera before it turns, and turns before it opens", () => {
    // TASKS.md §E: "the book comes out, turns side-on, then opens" — three
    // moves that overlap but keep their order. Asserted as an ordering of the
    // *crossings*, not at hand-picked times, so retuning the ranges can loosen
    // the overlap without silently reversing the story.
    const pull = SHELF_POSE.centerZ + (150 - SHELF_POSE.centerZ) / 2;
    let clearedAt = Infinity;
    let turnedAt = Infinity;
    let openedAt = Infinity;
    for (let t = 0; t <= 1.0001; t += 0.005) {
      const step = openingStep(t, SHELF_POSE, VIEWPORT);
      if (clearedAt === Infinity && step.position.z >= pull) clearedAt = t;
      if (turnedAt === Infinity && step.yaw <= SHELF_POSE.yaw * 0.9) turnedAt = t;
      if (openedAt === Infinity && step.openProgress > 0) openedAt = t;
    }
    expect(clearedAt).toBeLessThan(turnedAt);
    expect(turnedAt).toBeLessThan(openedAt);
  });

  it("gives the shelf's move out of the row a clock, not a corner of a curve", () => {
    // The operator's minimum on 2026-08-14: the pull-out and the turn are what
    // makes a shelf a shelf, and at the previous build's ~100ms they were a
    // pop. Asserted in **ms**, because that is what "you cannot follow it" is a
    // statement about — a phase's fraction of the clock means nothing without
    // the clock.
    const ms = (t: number) => t * SHELF_SEQUENCE_MS;
    let clearedAt = Infinity;
    let turnStartedAt = Infinity;
    let turnEndedAt = Infinity;
    for (let t = 0; t <= 1.0001; t += 0.001) {
      const step = openingStep(t, SHELF_POSE, VIEWPORT);
      // "Out of the row" is the pull essentially complete, not merely begun.
      if (clearedAt === Infinity && step.position.z >= 150 * 0.99) clearedAt = t;
      if (turnStartedAt === Infinity && step.yaw <= SHELF_POSE.yaw * 0.99) turnStartedAt = t;
      if (turnEndedAt === Infinity && step.yaw <= SHELF_POSE.yaw * 0.01) turnEndedAt = t;
    }
    expect(ms(clearedAt)).toBeGreaterThanOrEqual(400);
    expect(ms(turnEndedAt - turnStartedAt)).toBeGreaterThanOrEqual(400);
    // And the cover is facing you before the book crosses the room: the turn
    // happens in the clear air the pull bought, not on the way past the
    // neighbours.
    expect(turnEndedAt).toBeLessThan(0.4);
  });

  it("runs the same open off both surfaces, in ms and not just in shape", () => {
    // TASKS.md's "one opening, two approaches", now that the two clocks are
    // different lengths (`SHELF_SEQUENCE_MS`): the shelf's extra time is spent
    // *before* the shared part, and the shared part itself must be the same
    // animation. Measured as the open's own duration on each surface.
    function openMs(pose: OpeningPose, total: number): number {
      let from = Infinity;
      let to = Infinity;
      for (let t = 0; t <= 1.0001; t += 0.0005) {
        const step = openingStep(t, pose, VIEWPORT);
        if (from === Infinity && step.openProgress > 0) from = t;
        if (to === Infinity && step.openProgress >= 1) to = t;
      }
      return (to - from) * total;
    }
    const desk = openMs(DESK_POSE, DESK_SEQUENCE_MS);
    expect(openMs(SHELF_POSE, SHELF_SEQUENCE_MS)).toBeCloseTo(desk, -1);
    // And it is an open you can watch: the first cut ran the whole travel in
    // less than this.
    expect(desk).toBeGreaterThan(700);
  });

  it("crosses to the centre in a travel you can watch, not a flick", () => {
    // The first cut's travel was 0.52 of a 760ms clock — 395ms — which the
    // operator could not follow; it went to ~990ms, which they then found a
    // touch slow ("maybe 20-30% faster", 2026-08-14). This bound is the floor
    // that survives both notes, not the current value: it is what "you can
    // watch it cross" costs, and re-tuning within it is free.
    let arrivedAt = Infinity;
    for (let t = 0; t <= 1.0001; t += 0.001) {
      if (openingStep(t, DESK_POSE, VIEWPORT).position.x >= VIEWPORT.width / 2 - 1) {
        arrivedAt = t;
        break;
      }
    }
    expect(arrivedAt * DESK_SEQUENCE_MS).toBeGreaterThan(600);
  });

  it("holds the crease still in the book's own coordinates through the whole open", () => {
    // decisions.md 2026-08-12 ruling 7: M22.5 §F's ≤2px criterion, rescoped.
    // The hinge is a fixed point of the cover's rotation, so the spread's
    // centre never moves relative to the book; only the scene translates.
    const spread = openSpread(DESK_POSE.width, DESK_POSE.height, DESK_POSE.thickness);
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const step = openingStep(t, DESK_POSE, VIEWPORT);
      const creaseInBook = creaseX(step, DESK_POSE) - step.position.x - step.scale.x * step.recentre;
      expect(creaseInBook).toBeCloseTo(spread.creaseX - DESK_POSE.width / 2, 10);
    }
  });
});

describe("landingStep", () => {
  it("lands the spread on the reading pane's rect", () => {
    for (const pose of [DESK_POSE, SHELF_POSE]) {
      const rect = spreadRect(landingStep(pose, STAGE), pose);
      expect(rect.x).toBeCloseTo(STAGE.x, 6);
      expect(rect.y).toBeCloseTo(STAGE.y, 6);
      expect(rect.width).toBeCloseTo(STAGE.width, 6);
      expect(rect.height).toBeCloseTo(STAGE.height, 6);
    }
  });

  it("puts the paper on the camera's 1:1 plane, not the book's mid-plane", () => {
    // Otherwise the spread is scaled correctly and then magnified by sitting
    // proud of the plane where a stage px is a world unit.
    const step = landingStep(DESK_POSE, STAGE);
    const spread = openSpread(DESK_POSE.width, DESK_POSE.height, DESK_POSE.thickness);
    expect(step.position.z + spread.paperZ * step.scale.z).toBeCloseTo(0, 10);
  });

  it("puts both halves of the spread on that one plane, not either side of it", () => {
    // The 2026-08-14 fix for "the left page and right page aren't equal in
    // size". Two pages a board thickness apart under a perspective camera are
    // two pages at two magnifications, and no choice of *where* to plant that
    // pair fixes it — the midpoint this used to assert merely halved the error.
    // `Book3D.tsx` floats both printed pages `PAGE_LIFT` above the open front
    // board, so `paperZ` is that one plane and the separation is zero.
    const spread = openSpread(DESK_POSE.width, DESK_POSE.height, DESK_POSE.thickness);
    expect(spread.paperZ).toBeCloseTo(DESK_POSE.thickness / 2 + PAGE_LIFT, 10);
  });

  it("interpolates from the held-open pose to the pane without moving the crease off centre", () => {
    const held = openingStep(1, DESK_POSE, VIEWPORT);
    const landed = landingStep(DESK_POSE, STAGE);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const step = lerpToLanding(held, landed, t);
      const rect = spreadRect(step, DESK_POSE);
      // The crease stays the spread's centre the whole way across.
      expect(creaseX(step, DESK_POSE)).toBeCloseTo(rect.x + rect.width / 2, 6);
    }
    const end = lerpToLanding(held, landed, 1);
    expect(spreadRect(end, DESK_POSE).width).toBeCloseTo(STAGE.width, 6);
  });
});

describe("flattenTowardPane", () => {
  // The pane the operator was looking at when they called the printed page
  // "slightly vertically stretched" — measured live on a 1440×900 window, and
  // far wider than any book's spread. (`STAGE` above is a *narrow* pane, which
  // this deliberately is not: it is the case where there is stretch to relieve.)
  const WIDE_STAGE = { x: 16, y: 102, width: 1364, height: 703 };
  const WIDE = WIDE_STAGE.width / WIDE_STAGE.height;

  it("leaves the book alone until the settle runs", () => {
    const held = openingStep(1, DESK_POSE, VIEWPORT);
    expect(flattenTowardPane(held, DESK_POSE, WIDE, 0).scale.y).toBeCloseTo(held.scale.y, 10);
    // And with no measurement at all — a failed capture prints nothing, so
    // there is no stretched type to relieve.
    expect(flattenTowardPane(held, DESK_POSE, null, 1).scale.y).toBeCloseTo(held.scale.y, 10);
  });

  it("takes out some of the stretch, and stops well short of a letterbox", () => {
    const held = openingStep(1, DESK_POSE, VIEWPORT);
    const flat = flattenTowardPane(held, DESK_POSE, WIDE, 1);
    expect(flat.scale.y).toBeLessThan(held.scale.y);
    // "A tad", not "a different object": never past the floor, and never all
    // the way to the pane's own proportions.
    expect(flat.scale.y).toBeGreaterThanOrEqual(held.scale.y * SPREAD_FLATTEN_FLOOR);
    expect(flat.scale.y).toBeGreaterThan(held.scale.y * (spreadAspect(DESK_POSE) / WIDE));
    // Width is untouched — the relief comes off the height, so a narrow window
    // can never push the spread off its own sides.
    expect(flat.scale.x).toBeCloseTo(held.scale.x, 10);
  });

  it("does nothing for a pane narrower than the spread", () => {
    const held = openingStep(1, DESK_POSE, VIEWPORT);
    const narrow = spreadAspect(DESK_POSE) / 2;
    expect(flattenTowardPane(held, DESK_POSE, narrow, 1).scale.y).toBeCloseTo(held.scale.y, 10);
  });

  it("does not move where the landing ends", () => {
    // The whole reason the flattening is applied *before* the lerp: it changes
    // where the zoom starts, never the pane it finishes on.
    const held = flattenTowardPane(openingStep(1, DESK_POSE, VIEWPORT), DESK_POSE, WIDE, 1);
    const rect = spreadRect(lerpToLanding(held, landingStep(DESK_POSE, WIDE_STAGE), 1), DESK_POSE);
    expect(rect.width).toBeCloseTo(WIDE_STAGE.width, 6);
    expect(rect.height).toBeCloseTo(WIDE_STAGE.height, 6);
  });
});

describe("the landing's clock", () => {
  it("empties the room inside the zoom's own window: 10% in, done by 60%", () => {
    // The operator's 2026-08-16 cut. The room used to run the landing's whole
    // 850ms, which is the *other* failure mode from the one before it (a fade
    // shorter than the landing and on an ease-out, which emptied the room before
    // the spread had grown: "we've now lost the zoom"). Both numbers are
    // fractions of the landing, so retiming the landing can never leave the two
    // clocks disagreeing.
    expect(ROOM_FADE_DELAY_MS).toBeCloseTo(LANDING_MS * 0.1, 6);
    expect(ROOM_FADE_DELAY_MS + ROOM_FADE_MS).toBeCloseTo(LANDING_MS * 0.6, 6);
    // And the room is gone well before the handoff rather than under it: the
    // last 40% of the growth happens over the reader's own paper.
    expect(ROOM_FADE_DELAY_MS + ROOM_FADE_MS).toBeLessThan(HANDOFF_DELAY_MS);
  });

  it("spends the landing's middle on the growth, not on a settle", () => {
    // `LANDING_EASE` is symmetric — the defining property of the ease-in-out
    // that replaced the front-loaded decelerate, and the reason the room fading
    // on the same curve stays behind the spread while it is actually growing.
    const [x1, y1, x2, y2] = LANDING_EASE;
    expect(x1).toBeCloseTo(1 - x2, 10);
    expect(y1).toBeCloseTo(1 - y2, 10);
    // And it is genuinely eased in: a curve that starts fast is what put the
    // whole zoom in the first third.
    expect(y1).toBe(0);
    expect(x1).toBeGreaterThan(0.5);
  });
});
