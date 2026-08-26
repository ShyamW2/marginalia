import { describe, expect, it } from "vitest";
import { buildFoldMesh, type FoldMesh } from "./foldMesh.js";
import {
  anchorPoint,
  computeConeFold,
  sampleConeAt,
  spineEdgeForAnchor,
  syntheticFoldPointer,
  syntheticHingePointer,
  type ConeFold,
  type FoldAnchor,
  type Point,
} from "./pageFold.js";

/**
 * M27 "over the spine": the hinged sheet as triangles. These pin the
 * tessellation's own promises — that it covers the leaf exactly once, that its
 * vertices sit on the surface `pageFold.ts` solved, and that the sheet faces
 * the right way — none of which a rendered frame would tell you clearly.
 */

const LEAVES = [
  { mode: "spread", width: 460, height: 760 },
  { mode: "single-page", width: 920, height: 760 },
] as const;

const ANCHORS: readonly FoldAnchor[] = [
  "topLeft",
  "topRight",
  "bottomLeft",
  "bottomRight",
  { edge: "left" },
  { edge: "right" },
];

/** Every fold worth meshing: a corner dog-ear, a hinged turn at three depths
 * (its end is the far field, where the apex is held a million diagonals away),
 * and the flat model's own sweep for good measure. */
function everyFold(anchor: FoldAnchor, width: number, height: number): Point[] {
  const c = anchorPoint(anchor, width, height);
  const inward = c.x > width / 2 ? -1 : 1;
  const downward = c.y > height / 2 ? -1 : 1;
  return [
    { x: c.x + inward * 150, y: c.y + downward * 90 },
    { x: c.x + inward * 300, y: c.y + downward * 60 },
    syntheticHingePointer(anchor, width, height, 0.2),
    syntheticHingePointer(anchor, width, height, 0.6),
    syntheticHingePointer(anchor, width, height, 1),
    syntheticFoldPointer(anchor, width, height, 0.3),
  ];
}

function eachMesh(fn: (mesh: FoldMesh, cone: ConeFold, leaf: (typeof LEAVES)[number], anchor: FoldAnchor) => void) {
  for (const leaf of LEAVES) {
    for (const anchor of ANCHORS) {
      for (const pointer of everyFold(anchor, leaf.width, leaf.height)) {
        const cone = computeConeFold(anchor, pointer, leaf.width, leaf.height);
        expect(cone).not.toBeNull();
        const mesh = buildFoldMesh(cone!, leaf.width, leaf.height);
        expect(mesh).not.toBeNull();
        fn(mesh!, cone!, leaf, anchor);
      }
    }
  }
}

/** Triangle `t`'s vertex indices. */
function tri(mesh: FoldMesh, t: number): [number, number, number] {
  return [mesh.index[t * 3]!, mesh.index[t * 3 + 1]!, mesh.index[t * 3 + 2]!];
}

function sourceAt(mesh: FoldMesh, i: number): Point {
  return { x: mesh.source[i * 2]!, y: mesh.source[i * 2 + 1]! };
}

describe("buildFoldMesh — the tessellation's own promises", () => {
  it("covers the leaf exactly once — no gap, no overlap", () => {
    // The one property a fan of clipped wedges can silently get wrong, and the
    // one a rendered frame hides: a sliver of missing sheet reads as a seam
    // only when the page underneath happens to differ. Summed *source* area
    // catches both directions at once, since an overlap counts twice.
    eachMesh((mesh, _cone, leaf) => {
      let area = 0;
      for (let t = 0; t < mesh.index.length / 3; t++) {
        const [a, b, c] = tri(mesh, t);
        const p = sourceAt(mesh, a);
        const q = sourceAt(mesh, b);
        const r = sourceAt(mesh, c);
        area += Math.abs((q.x - p.x) * (r.y - p.y) - (r.x - p.x) * (q.y - p.y)) / 2;
      }
      expect(area / (leaf.width * leaf.height)).toBeCloseTo(1, 9);
    });
  });

  it("puts every vertex on the surface pageFold solved", () => {
    // The mesh is allowed to approximate *between* vertices; it is not allowed
    // to invent one. Positions are the seam's units — x right, y up out of the
    // page, z down the screen — so the cone's ground projection lands in xz and
    // its lift in y.
    eachMesh((mesh, cone) => {
      for (let i = 0; i < mesh.vertexCount; i++) {
        const { at, lift, phi } = sampleConeAt(cone, sourceAt(mesh, i));
        expect(mesh.position[i * 3]!).toBeCloseTo(at.x, 3);
        expect(mesh.position[i * 3 + 1]!).toBeCloseTo(lift, 3);
        expect(mesh.position[i * 3 + 2]!).toBeCloseTo(at.y, 3);
        // Four places, not more: `source` is float32 too, so re-sampling
        // reads a point a hundred-thousandth of a pixel away — and where the
        // roll turns fastest that is worth a few ten-millionths of a radian.
        expect(mesh.phi[i]!).toBeCloseTo(phi, 4);
      }
    });
  });

  it("leaves the spine edge lying exactly where it was", () => {
    // The hinge invariant, restated for whatever actually gets drawn — a mesh
    // that quietly rounded the binding away would satisfy every test in
    // pageCone.test.ts and still tear the page off the book on screen.
    eachMesh((mesh, _cone, leaf, anchor) => {
      const spineX = spineEdgeForAnchor(anchor) === "left" ? 0 : leaf.width;
      for (let i = 0; i < mesh.vertexCount; i++) {
        const source = sourceAt(mesh, i);
        if (Math.abs(source.x - spineX) > 1e-6) continue;
        expect(mesh.position[i * 3]!).toBeCloseTo(source.x, 3);
        expect(mesh.position[i * 3 + 1]!).toBeCloseTo(0, 6);
        expect(mesh.position[i * 3 + 2]!).toBeCloseTo(source.y, 3);
      }
    });
  });

  it("faces the reader where the sheet is flat, and away from them on the tail", () => {
    // What lets one draw with `FrontSide` and one with `BackSide` put the right
    // page on each side. Nothing sets this — it falls out of the winding being
    // taken from the source polygon and the tail having turned through PI.
    let flatTris = 0;
    let tailTris = 0;
    eachMesh((mesh) => {
      for (let t = 0; t < mesh.index.length / 3; t++) {
        const [a, b, c] = tri(mesh, t);
        const at = (i: number) => [mesh.position[i * 3]!, mesh.position[i * 3 + 1]!, mesh.position[i * 3 + 2]!] as const;
        const [p, q, r] = [at(a), at(b), at(c)];
        // The up component of (q - p) x (r - p).
        const up = (q[2]! - p[2]!) * (r[0]! - p[0]!) - (q[0]! - p[0]!) * (r[2]! - p[2]!);
        if (Math.abs(up) < 1e-6) continue;
        const phis = [mesh.phi[a]!, mesh.phi[b]!, mesh.phi[c]!];
        if (phis.every((v) => v < 1e-9)) {
          flatTris++;
          expect(up).toBeGreaterThan(0);
        } else if (phis.every((v) => v > Math.PI - 1e-9)) {
          tailTris++;
          expect(up).toBeLessThan(0);
        }
      }
    });
    expect(flatTris).toBeGreaterThan(0);
    expect(tailTris).toBeGreaterThan(0);
  });

  it("spends its vertices on the roll and almost none anywhere else", () => {
    // The reason this is a fan and not a grid. A regular grid fine enough to
    // resolve the roll's lip runs to tens of thousands of vertices — and still
    // misses it in the far field, where the roll is a ten-millionth of the
    // leaf's angular span. Here the flat page and the tail are one wedge each,
    // because they are planar, and the count barely moves between the two.
    const counts: number[] = [];
    eachMesh((mesh) => counts.push(mesh.vertexCount));
    expect(Math.max(...counts)).toBeLessThan(400);
    // ...and it is genuinely tessellating, not degenerating to a quad.
    expect(Math.min(...counts)).toBeGreaterThan(20);
  });

  it("throws a shadow from the roll, and from the tail once there is one", () => {
    // Two footprints, matching the two shadows `drawPageFold` throws — the gap
    // under a lifted sheet darkens all round it rather than in one direction.
    eachMesh((mesh) => {
      expect(mesh.rollShadow.length % 2).toBe(0);
      expect(mesh.tailShadow.length % 2).toBe(0);
      expect(mesh.rollShadow.length).toBeGreaterThan(0);
      const hasTail = Array.from(mesh.phi).some((v) => v > Math.PI - 1e-9);
      expect(mesh.tailShadow.length > 0).toBe(hasTail);
    });
  });

  it("has nothing to draw when the leaf has no area", () => {
    // Not a crash and not an empty mesh: a fold with no leaf under it is a
    // caller mistake the renderer should skip, and `null` is how it says so.
    const cone = computeConeFold("bottomRight", { x: 300, y: 700 }, 460, 760);
    expect(cone).not.toBeNull();
    expect(buildFoldMesh(cone!, 460, 760)).not.toBeNull();
    expect(buildFoldMesh(cone!, 0, 0)).toBeNull();
  });
});
