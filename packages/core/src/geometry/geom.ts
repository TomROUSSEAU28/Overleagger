import type { Pt, Rect } from '../model/types';

export const snap = (v: number, grid: number) => Math.round(v / grid) * grid;

export const snapPt = (p: Pt, grid: number): Pt => ({ x: snap(p.x, grid), y: snap(p.y, grid) });

export const EPS = 1e-6;

export const samePt = (ax: number, ay: number, bx: number, by: number) =>
  Math.abs(ax - bx) < EPS && Math.abs(ay - by) < EPS;

export const ptKey = (x: number, y: number) =>
  `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`;

export function rectFromPoints(a: Pt, b: Pt): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

export function rectUnion(rects: Rect[]): Rect | undefined {
  if (rects.length === 0) return undefined;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export const rectsIntersect = (a: Rect, b: Rect) =>
  a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

export const rectContains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h;

export const inflate = (r: Rect, d: number): Rect => ({
  x: r.x - d,
  y: r.y - d,
  w: r.w + 2 * d,
  h: r.h + 2 * d,
});

/** Bounding box of a flat point list. */
export function ptsBBox(pts: number[]): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]!);
    y0 = Math.min(y0, pts[i + 1]!);
    x1 = Math.max(x1, pts[i]!);
    y1 = Math.max(y1, pts[i + 1]!);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** True when p lies strictly inside segment a–b (not on an end point). */
export function onSegmentInterior(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  if (samePt(px, py, ax, ay) || samePt(px, py, bx, by)) return false;
  const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const len = Math.hypot(bx - ax, by - ay);
  if (len < EPS || Math.abs(cross) / len > 0.01) return false;
  const dot = (px - ax) * (bx - ax) + (py - ay) * (by - ay);
  return dot > 0 && dot < len * len;
}

/** Distance from p to segment a–b. */
export function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 < EPS ? 0 : ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Remove duplicate consecutive vertices and collinear middle vertices. */
export function normalizeWire(pts: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i]!;
    const y = pts[i + 1]!;
    const n = out.length;
    if (n >= 2 && samePt(out[n - 2]!, out[n - 1]!, x, y)) continue;
    if (n >= 4) {
      const ax = out[n - 4]!;
      const ay = out[n - 3]!;
      const bx = out[n - 2]!;
      const by = out[n - 1]!;
      const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
      const sameDir = (bx - ax) * (x - bx) + (by - ay) * (y - by) > 0;
      if (Math.abs(cross) < EPS && sameDir) {
        out[n - 2] = x;
        out[n - 1] = y;
        continue;
      }
    }
    out.push(x, y);
  }
  return out;
}

/** Wire length (sum of segment lengths). */
export function wireLength(pts: number[]): number {
  let l = 0;
  for (let i = 2; i < pts.length; i += 2)
    l += Math.hypot(pts[i]! - pts[i - 2]!, pts[i + 1]! - pts[i - 1]!);
  return l;
}

/**
 * Orthogonal route from a to b with one bend.
 * `hFirst` = leave `a` horizontally first.
 */
export function elbow(a: Pt, b: Pt, hFirst: boolean): number[] {
  if (a.x === b.x || a.y === b.y) return [a.x, a.y, b.x, b.y];
  return hFirst ? [a.x, a.y, b.x, a.y, b.x, b.y] : [a.x, a.y, a.x, b.y, b.x, b.y];
}
