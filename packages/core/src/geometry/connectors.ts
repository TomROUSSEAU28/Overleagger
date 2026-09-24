/**
 * Flowcharts and process charts: shape outlines, connection points (anchors) and connectors
 * that stay attached to their shapes, with straight or orthogonal ("elbow") routing.
 */
import type { Anchor, Element, Id, LineElement, Pt, Rect, ShapeElement } from '../model/types';
import { textBBox, type SheetContext } from './elements';

type P = [number, number];

/** Points along an elliptical arc (angles in degrees, clockwise on screen). */
function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 16): P[] {
  const out: P[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}

export interface ShapeGeometry {
  /** Closed outline (curves approximated by points). */
  outline: P[];
  /** Open inner lines (e.g. the front edge of a cylinder, the bars of a predefined process). */
  extras: P[][];
}

/** Outline of a shape of any kind inside its box. */
export function shapeGeometry(
  el: Pick<ShapeElement, 'kind' | 'x' | 'y' | 'w' | 'h' | 'dir'>,
): ShapeGeometry {
  const { x, y, w, h } = el;
  const rect: P[] = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
  switch (el.kind) {
    case 'rect':
      return { outline: rect, extras: [] };
    case 'ellipse':
      return {
        outline: arc(x + w / 2, y + h / 2, w / 2, h / 2, 0, 360, 48).slice(0, -1),
        extras: [],
      };
    case 'diamond':
      return {
        outline: [
          [x + w / 2, y],
          [x + w, y + h / 2],
          [x + w / 2, y + h],
          [x, y + h / 2],
        ],
        extras: [],
      };
    case 'triangle': {
      const pts: Record<string, P[]> = {
        t: [
          [x + w / 2, y],
          [x + w, y + h],
          [x, y + h],
        ],
        b: [
          [x, y],
          [x + w, y],
          [x + w / 2, y + h],
        ],
        r: [
          [x, y],
          [x + w, y + h / 2],
          [x, y + h],
        ],
        l: [
          [x + w, y],
          [x + w, y + h],
          [x, y + h / 2],
        ],
      };
      return { outline: pts[el.dir ?? 't']!, extras: [] };
    }
    case 'terminator': {
      const r = Math.min(h / 2, w / 2);
      return {
        outline: [
          ...arc(x + w - r, y + h / 2, r, h / 2, -90, 90),
          ...arc(x + r, y + h / 2, r, h / 2, 90, 270),
        ],
        extras: [],
      };
    }
    case 'data': {
      const s = Math.min(w * 0.2, h * 0.6);
      return {
        outline: [
          [x + s, y],
          [x + w, y],
          [x + w - s, y + h],
          [x, y + h],
        ],
        extras: [],
      };
    }
    case 'document': {
      const base = y + h * 0.84;
      const amp = h * 0.09;
      const wave: P[] = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        wave.push([x + w - t * w, base + amp * Math.sin(t * 2 * Math.PI)]);
      }
      return { outline: [[x, y], [x + w, y], ...wave], extras: [] };
    }
    case 'predefined': {
      const d = Math.min(w * 0.1, 14);
      return {
        outline: rect,
        extras: [
          [
            [x + d, y],
            [x + d, y + h],
          ],
          [
            [x + w - d, y],
            [x + w - d, y + h],
          ],
        ],
      };
    }
    case 'database': {
      const ry = Math.min(h * 0.15, w * 0.25);
      const cx = x + w / 2;
      return {
        outline: [
          ...arc(cx, y + ry, w / 2, ry, 180, 360),
          ...arc(cx, y + h - ry, w / 2, ry, 0, 180),
        ],
        extras: [arc(cx, y + ry, w / 2, ry, 0, 180)],
      };
    }
    case 'manual-input':
      return {
        outline: [
          [x, y + h * 0.3],
          [x + w, y],
          [x + w, y + h],
          [x, y + h],
        ],
        extras: [],
      };
    case 'preparation': {
      const s = Math.min(w * 0.2, h / 2);
      return {
        outline: [
          [x + s, y],
          [x + w - s, y],
          [x + w, y + h / 2],
          [x + w - s, y + h],
          [x + s, y + h],
          [x, y + h / 2],
        ],
        extras: [],
      };
    }
    case 'delay': {
      const r = Math.min(h / 2, w / 2);
      return {
        outline: [[x, y], ...arc(x + w - r, y + h / 2, r, h / 2, -90, 90), [x, y + h]],
        extras: [],
      };
    }
    case 'offpage':
      return {
        outline: [
          [x, y],
          [x + w, y],
          [x + w, y + h * 0.7],
          [x + w / 2, y + h],
          [x, y + h * 0.7],
        ],
        extras: [],
      };
    case 'manual-op': {
      const s = w * 0.15;
      return {
        outline: [
          [x, y],
          [x + w, y],
          [x + w - s, y + h],
          [x + s, y + h],
        ],
        extras: [],
      };
    }
  }
}

/** Element types a connector can attach to. */
export const BINDABLE: Element['type'][] = [
  'shape',
  'note',
  'image',
  'button',
  'waveform',
  'block',
  'text',
];

/** Outline used for connection points (the shape outline, or the element's box). */
function outlineOf(el: Element): P[] | undefined {
  if (el.type === 'shape') return shapeGeometry(el).outline;
  let r: Rect | undefined;
  if (
    el.type === 'note' ||
    el.type === 'image' ||
    el.type === 'button' ||
    el.type === 'waveform' ||
    el.type === 'block'
  )
    r = { x: el.x, y: el.y, w: el.w, h: el.h };
  else if (el.type === 'text') {
    const b = textBBox(el);
    const pad = el.frame ? 6 : 3;
    r = { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
  }
  if (!r) return undefined;
  return [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x + r.w, r.y + r.h],
    [r.x, r.y + r.h],
  ];
}

const DIRS: Record<Anchor, P> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
export const ANCHORS: Anchor[] = ['n', 'e', 's', 'w'];

/** Where the ray from `c` in direction `d` leaves the polygon. */
function rayExit(poly: P[], c: P, d: P): P | undefined {
  let best: P | undefined;
  let bestT = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const den = d[0] * ey - d[1] * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a[0] - c[0]) * ey - (a[1] - c[1]) * ex) / den;
    const u = ((a[0] - c[0]) * d[1] - (a[1] - c[1]) * d[0]) / den;
    if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 && t < bestT) {
      bestT = t;
      best = [c[0] + d[0] * t, c[1] + d[1] * t];
    }
  }
  return best;
}

/** Connection points of an element (middle of each side of its outline). */
export function anchorPoints(el: Element): Record<Anchor, Pt> | undefined {
  const poly = outlineOf(el);
  if (!poly) return undefined;
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const c: P = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  const out = {} as Record<Anchor, Pt>;
  for (const a of ANCHORS) {
    const p = rayExit(poly, c, DIRS[a]) ?? c;
    out[a] = { x: Math.round(p[0] * 100) / 100, y: Math.round(p[1] * 100) / 100 };
  }
  return out;
}

/** The connection point of `el` closest to `p`. */
export function nearestAnchor(el: Element, p: Pt): { anchor: Anchor; pt: Pt } | undefined {
  const pts = anchorPoints(el);
  if (!pts) return undefined;
  let best: { anchor: Anchor; pt: Pt } | undefined;
  let bestD = Infinity;
  for (const a of ANCHORS) {
    const q = pts[a];
    const dd = Math.hypot(q.x - p.x, q.y - p.y);
    if (dd < bestD) {
      bestD = dd;
      best = { anchor: a, pt: q };
    }
  }
  return best;
}

/** Topmost element a connector can attach to under `p` (with a small margin). */
export function bindableAt(
  elements: Element[],
  p: Pt,
  ctx: SheetContext,
  margin = 8,
  exclude?: Id,
) {
  void ctx;
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i]!;
    if (el.id === exclude || !BINDABLE.includes(el.type)) continue;
    const poly = outlineOf(el);
    if (!poly) continue;
    const xs = poly.map((q) => q[0]);
    const ys = poly.map((q) => q[1]);
    if (
      p.x >= Math.min(...xs) - margin &&
      p.x <= Math.max(...xs) + margin &&
      p.y >= Math.min(...ys) - margin &&
      p.y <= Math.max(...ys) + margin
    )
      return el;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

const STUB = 16;

function simplify(pts: P[]): P[] {
  const out: P[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-6 && Math.abs(last[1] - p[1]) < 1e-6) continue;
    out.push(p);
  }
  // Drop middle points of straight runs.
  for (let i = out.length - 2; i > 0; i--) {
    const a = out[i - 1]!;
    const b = out[i]!;
    const c = out[i + 1]!;
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-6) out.splice(i, 1);
  }
  return out;
}

/**
 * Orthogonal route from p1 (leaving in direction d1) to p2 (arriving from direction d2, i.e.
 * leaving p2 in d2). Unattached ends take the direction that faces the other end.
 */
export function elbowRoute(p1: Pt, a1: Anchor | undefined, p2: Pt, a2: Anchor | undefined): P[] {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const horiz = Math.abs(dx) >= Math.abs(dy);
  const d1: P = a1 ? DIRS[a1] : horiz ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dy) || 1];
  const d2: P = a2 ? DIRS[a2] : horiz ? [-(Math.sign(dx) || 1), 0] : [0, -(Math.sign(dy) || 1)];
  const a: P = [p1.x + d1[0] * STUB, p1.y + d1[1] * STUB];
  const b: P = [p2.x + d2[0] * STUB, p2.y + d2[1] * STUB];
  const h1 = d1[0] !== 0;
  const h2 = d2[0] !== 0;
  let mid: P[];
  if (h1 && h2) {
    const mx = (a[0] + b[0]) / 2;
    mid = [
      [mx, a[1]],
      [mx, b[1]],
    ];
  } else if (!h1 && !h2) {
    const my = (a[1] + b[1]) / 2;
    mid = [
      [a[0], my],
      [b[0], my],
    ];
  } else if (h1) mid = [[b[0], a[1]]];
  else mid = [[a[0], b[1]]];
  return simplify([[p1.x, p1.y], a, ...mid, b, [p2.x, p2.y]]);
}

/** Points of a connector as drawn (two points for a straight line). */
export function linePoints(el: Pick<LineElement, 'pts' | 'route' | 'from' | 'to'>): P[] {
  const [x1, y1, x2, y2] = el.pts as [number, number, number, number];
  if (el.route !== 'elbow')
    return [
      [x1, y1],
      [x2, y2],
    ];
  return elbowRoute({ x: x1, y: y1 }, el.from?.anchor, { x: x2, y: y2 }, el.to?.anchor);
}

/** Point halfway along a polyline (for the connector's label). */
export function polylineMiddle(pts: P[]): Pt {
  let total = 0;
  for (let i = 1; i < pts.length; i++)
    total += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  let left = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!;
    const [bx, by] = pts[i]!;
    const len = Math.hypot(bx - ax, by - ay);
    if (left <= len && len > 0)
      return { x: ax + ((bx - ax) * left) / len, y: ay + ((by - ay) * left) / len };
    left -= len;
  }
  const last = pts[pts.length - 1] ?? [0, 0];
  return { x: last[0], y: last[1] };
}

/**
 * After elements changed (moved, resized, rotated…), move the ends of the connectors attached
 * to them. Returns the updated connectors (including connectors that were already changed).
 */
export function followConnectors(all: Element[], changed: Element[]): LineElement[] {
  if (!changed.length) return [];
  const byId = new Map(all.map((e) => [e.id, e]));
  for (const c of changed) byId.set(c.id, c);
  const changedIds = new Set(changed.map((c) => c.id));
  const out: LineElement[] = [];
  for (const orig of all) {
    if (orig.type !== 'line') continue;
    const line = byId.get(orig.id) as LineElement;
    const fromHit = line.from && changedIds.has(line.from.id);
    const toHit = line.to && changedIds.has(line.to.id);
    if (!fromHit && !toHit) continue;
    const pts = [...line.pts];
    if (fromHit) {
      const t = byId.get(line.from!.id);
      const p = t && anchorPoints(t)?.[line.from!.anchor];
      if (p) [pts[0], pts[1]] = [p.x, p.y];
    }
    if (toHit) {
      const t = byId.get(line.to!.id);
      const p = t && anchorPoints(t)?.[line.to!.anchor];
      if (p) [pts[2], pts[3]] = [p.x, p.y];
    }
    out.push({ ...line, pts });
  }
  return out;
}
