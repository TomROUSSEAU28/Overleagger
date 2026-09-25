/**
 * Animated currents (presentation): the current i(t) of a flow, where a point is along its
 * path, and the path of the wires and parts a current goes through.
 */
import { elementPins, type SheetContext } from './geometry/elements';
import { EPS, normalizeWire, onSegmentInterior } from './geometry/geom';
import type { Element, FlowElement, FlowSignal, Id } from './model/types';

/** Values used when a flow does not set them. */
export const FLOW_DEFAULTS = {
  period: 2,
  offset: 0,
  duty: 0.5,
  spacing: 26,
  speed: 60,
} as const;

/** Signals that repeat every period (the others start once, when the flow appears). */
export const PERIODIC_SIGNALS: readonly FlowSignal[] = [
  'sine',
  'square',
  'triangle',
  'sawtooth',
  'pwm',
];

/** Value of a signal at time t (s): −1…1 (sine, square, triangle) or 0…1 (the others). */
export function flowSignal(signal: FlowSignal, t: number, period: number, duty = 0.5): number {
  const T = Math.max(1e-3, period);
  const u = (((t / T) % 1) + 1) % 1;
  switch (signal) {
    case 'dc':
      return 1;
    case 'sine':
      return Math.sin(2 * Math.PI * u);
    case 'square':
      return u < 0.5 ? 1 : -1;
    case 'triangle':
      // Starts at 0 going up: 0 → 1 → −1 → 0.
      return u < 0.25 ? 4 * u : u < 0.75 ? 2 - 4 * u : 4 * u - 4;
    case 'sawtooth':
      return u;
    case 'pwm':
      return u < Math.min(1, Math.max(0, duty)) ? 1 : 0;
    case 'ramp':
      return Math.min(1, Math.max(0, t / T));
    case 'rise':
      return t <= 0 ? 0 : 1 - Math.exp(-t / T);
    case 'decay':
      return t <= 0 ? 1 : Math.exp(-t / T);
  }
}

/** The current of a flow at time t (s, from when it appears): offset + current × signal(t). */
export function flowCurrent(el: FlowElement, t: number): number {
  const period = el.period ?? FLOW_DEFAULTS.period;
  const duty = el.duty ?? FLOW_DEFAULTS.duty;
  return (el.offset ?? FLOW_DEFAULTS.offset) + el.current * flowSignal(el.signal, t, period, duty);
}

/**
 * Speed of the symbols along the path (px/s, positive = in the direction of the path).
 * Electrons go against the current.
 */
export function flowVelocity(el: FlowElement, t: number): number {
  const v = (el.speed ?? FLOW_DEFAULTS.speed) * flowCurrent(el, t);
  return el.electrons ? -v : v;
}

/** Points of the path, closed paths ending on their first point. */
export function flowPoints(el: Pick<FlowElement, 'pts' | 'closed'>): number[] {
  const p = el.pts;
  const n = p.length;
  if (!el.closed || n < 4) return p;
  if (Math.abs(p[0]! - p[n - 2]!) < EPS && Math.abs(p[1]! - p[n - 1]!) < EPS) return p;
  return [...p, p[0]!, p[1]!];
}

export interface PathSampler {
  length: number;
  /** Position and direction (radians) at a distance s along the path (0…length). */
  at(s: number): { x: number; y: number; angle: number };
}

/** Walks a polyline by distance. */
export function pathSampler(pts: number[]): PathSampler {
  const cum: number[] = [0];
  for (let i = 2; i < pts.length; i += 2)
    cum.push(cum[cum.length - 1]! + Math.hypot(pts[i]! - pts[i - 2]!, pts[i + 1]! - pts[i - 1]!));
  const length = cum[cum.length - 1] ?? 0;
  return {
    length,
    at(s: number) {
      const d = Math.min(length, Math.max(0, s));
      // Binary search of the segment.
      let lo = 0;
      let hi = cum.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid]! <= d) lo = mid;
        else hi = mid;
      }
      const seg = Math.max(0, Math.min(cum.length - 2, lo));
      const ax = pts[2 * seg]!;
      const ay = pts[2 * seg + 1]!;
      const bx = pts[2 * seg + 2] ?? ax;
      const by = pts[2 * seg + 3] ?? ay;
      const len = cum[seg + 1]! - cum[seg]! || 1;
      const k = (d - cum[seg]!) / len;
      return { x: ax + (bx - ax) * k, y: ay + (by - ay) * k, angle: Math.atan2(by - ay, bx - ax) };
    },
  };
}

/**
 * Where the symbols are when the flow has moved by `phase` px: distances along the path, with
 * how visible each one is (the symbols of an open path fade in and out at its ends).
 */
export function flowPositions(
  length: number,
  closed: boolean,
  spacing: number,
  phase: number,
): { s: number; alpha: number }[] {
  if (length <= 0) return [];
  // At most 500 symbols, whatever the spacing (a very long path stays light to draw).
  spacing = Math.max(4, spacing, length / 500);
  const out: { s: number; alpha: number }[] = [];
  if (closed) {
    // A whole number of symbols on the loop, so that it turns without a seam.
    const n = Math.max(1, Math.round(length / Math.max(4, spacing)));
    const sp = length / n;
    const off = ((phase % sp) + sp) % sp;
    for (let k = 0; k < n; k++) out.push({ s: off + k * sp, alpha: 1 });
    return out;
  }
  const sp = Math.max(4, spacing);
  const off = ((phase % sp) + sp) % sp;
  const fade = Math.min(sp, length / 4);
  for (let s = off; s <= length; s += sp) {
    const edge = Math.min(s, length - s);
    out.push({ s, alpha: fade > 0 ? Math.min(1, edge / fade) : 1 });
  }
  return out;
}

const key = (x: number, y: number) => `${Math.round(x * 2) / 2},${Math.round(y * 2) / 2}`;

/**
 * The path of a current through the selected wires and two-pin parts (a resistor, a coil…):
 * one continuous walk, going straight on at the crossings when it can. A loop gives a closed
 * path, turning clockwise; an open path starts at its top-left end. Null when there is nothing
 * to walk through.
 */
export function flowPathFromSelection(
  elements: Element[],
  ids: Id[],
  ctx: SheetContext,
): { pts: number[]; closed: boolean } | null {
  const chosen = new Set(ids);
  const segs: [number, number, number, number][] = [];
  for (const e of elements) {
    if (!chosen.has(e.id)) continue;
    if (e.type === 'wire') {
      for (let i = 2; i < e.pts.length; i += 2)
        segs.push([e.pts[i - 2]!, e.pts[i - 1]!, e.pts[i]!, e.pts[i + 1]!]);
    } else if (e.type === 'component') {
      const pins = elementPins(e, ctx);
      if (pins.length === 2) segs.push([pins[0]!.x, pins[0]!.y, pins[1]!.x, pins[1]!.y]);
    }
  }
  if (!segs.length) return null;
  // Cut the segments where another one starts or ends on them (a T-junction).
  const nodes: [number, number][] = [];
  for (const [ax, ay, bx, by] of segs) nodes.push([ax, ay], [bx, by]);
  const edges: [number, number, number, number][] = [];
  for (const [ax, ay, bx, by] of segs) {
    const cuts = nodes
      .filter(([x, y]) => onSegmentInterior(x, y, ax, ay, bx, by))
      .map(([x, y]) => ({ x, y, d: Math.hypot(x - ax, y - ay) }))
      .sort((p, q) => p.d - q.d);
    let px = ax;
    let py = ay;
    for (const c of cuts) {
      if (key(c.x, c.y) === key(px, py)) continue;
      edges.push([px, py, c.x, c.y]);
      px = c.x;
      py = c.y;
    }
    if (key(px, py) !== key(bx, by)) edges.push([px, py, bx, by]);
  }
  // The graph: for each node, its edges.
  const adj = new Map<string, number[]>();
  const pos = new Map<string, [number, number]>();
  edges.forEach(([ax, ay, bx, by], i) => {
    for (const [x, y] of [
      [ax, ay],
      [bx, by],
    ] as [number, number][]) {
      const k = key(x, y);
      pos.set(k, [x, y]);
      adj.set(k, [...(adj.get(k) ?? []), i]);
    }
  });
  const byTopLeft = (a: string, b: string) => {
    const [ax, ay] = pos.get(a)!;
    const [bx, by] = pos.get(b)!;
    return ay - by || ax - bx;
  };
  const len = edges.map(([ax, ay, bx, by]) => Math.hypot(bx - ax, by - ay));
  const other = (i: number, from: string): string => {
    const [ax, ay, bx, by] = edges[i]!;
    return key(ax, ay) === from ? key(bx, by) : key(ax, ay);
  };
  // The longest walk that never takes an edge twice (dead ends left aside), with as few turns
  // as possible: a small search, bounded for big selections.
  let best: { nodes: string[]; score: number } = { nodes: [], score: -1 };
  let budget = 40000;
  const used = new Set<number>();
  const walk = (nodes: string[], score: number, dir: [number, number] | null) => {
    if (--budget < 0) return;
    if (score > best.score + 1e-6) best = { nodes: [...nodes], score };
    const cur = nodes[nodes.length - 1]!;
    const [cx, cy] = pos.get(cur)!;
    for (const i of adj.get(cur)!) {
      if (used.has(i)) continue;
      const nk = other(i, cur);
      const [nx, ny] = pos.get(nk)!;
      const d: [number, number] = [(nx - cx) / (len[i] || 1), (ny - cy) / (len[i] || 1)];
      const turn = dir && Math.abs(d[0] * dir[0] + d[1] * dir[1]) < 0.99 ? 0.5 : 0;
      used.add(i);
      nodes.push(nk);
      walk(nodes, score + len[i]! - turn, d);
      nodes.pop();
      used.delete(i);
    }
  };
  const starts = [...adj.keys()].sort((a, b) => {
    // Ends first (a walk usually starts at one), then top-left.
    const da = adj.get(a)!.length % 2;
    const db = adj.get(b)!.length % 2;
    return db - da || byTopLeft(a, b);
  });
  for (const st of starts) walk([st], 0, null);
  let trail = best.nodes;
  if (trail.length < 2) return null;
  // An open walk starts at its top-left end.
  const first = trail[0]!;
  const last = trail[trail.length - 1]!;
  if (first !== last && byTopLeft(last, first) < 0) trail = [...trail].reverse();
  const out: number[] = trail.flatMap((k) => pos.get(k)!);
  const n = out.length;
  const closed = n >= 8 && key(out[0]!, out[1]!) === key(out[n - 2]!, out[n - 1]!);
  let pts = normalizeWire(closed ? out.slice(0, -2) : out);
  if (pts.length < 4) return null;
  if (closed) {
    // Clockwise on the screen (y down): the signed area is positive.
    let area = 0;
    for (let i = 0; i < pts.length; i += 2) {
      const j = (i + 2) % pts.length;
      area += pts[i]! * pts[j + 1]! - pts[j]! * pts[i + 1]!;
    }
    if (area < 0) pts = reversePath(pts);
  }
  return { pts, closed };
}

/** The same path, walked the other way. */
export function reversePath(pts: number[]): number[] {
  const out: number[] = [];
  for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i]!, pts[i + 1]!);
  return out;
}
