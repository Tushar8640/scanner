/**
 * Geometry helpers for four-corner document crops.
 * All points are normalised to the source image: x and y run from 0 to 1.
 */

export interface Point {
  x: number;
  y: number;
}

/** Corners in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

export const FULL_QUAD: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

export function cloneQuad(q: Quad): Quad {
  return q.map((p) => ({ x: p.x, y: p.y })) as Quad;
}

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** True when the four corners form a convex, non-degenerate quadrilateral. */
export function isConvexQuad(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-6) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** True when the quad covers (almost) the whole image, so no warp is needed. */
export function isFullQuad(q: Quad, tolerance = 0.003): boolean {
  return q.every((p, i) => Math.abs(p.x - FULL_QUAD[i].x) <= tolerance && Math.abs(p.y - FULL_QUAD[i].y) <= tolerance);
}
