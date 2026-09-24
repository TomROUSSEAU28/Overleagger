import { elementPins, type SheetContext, type WorldPin } from './geometry/elements';
import { EPS, onSegmentInterior, ptKey } from './geometry/geom';
import type { Element, Id, LabelElement, Pt, WireElement } from './model/types';

interface Segment {
  wire: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/** Spatial index of wire segments: horizontal ones by y, vertical ones by x, the rest in a list. */
class SegmentIndex {
  private h = new Map<number, Segment[]>();
  private v = new Map<number, Segment[]>();
  private other: Segment[] = [];

  constructor(wires: WireElement[]) {
    wires.forEach((w, wi) => {
      for (let i = 2; i < w.pts.length; i += 2) {
        const s: Segment = {
          wire: wi,
          ax: w.pts[i - 2]!,
          ay: w.pts[i - 1]!,
          bx: w.pts[i]!,
          by: w.pts[i + 1]!,
        };
        if (Math.abs(s.ay - s.by) < EPS) push(this.h, key(s.ay), s);
        else if (Math.abs(s.ax - s.bx) < EPS) push(this.v, key(s.ax), s);
        else this.other.push(s);
      }
    });
  }

  /** Segments whose interior contains (x, y). */
  through(x: number, y: number): Segment[] {
    const out: Segment[] = [];
    for (const s of this.h.get(key(y)) ?? [])
      if (onSegmentInterior(x, y, s.ax, s.ay, s.bx, s.by)) out.push(s);
    for (const s of this.v.get(key(x)) ?? [])
      if (onSegmentInterior(x, y, s.ax, s.ay, s.bx, s.by)) out.push(s);
    for (const s of this.other) if (onSegmentInterior(x, y, s.ax, s.ay, s.bx, s.by)) out.push(s);
    return out;
  }
}

const key = (v: number) => Math.round(v * 100) / 100;

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

interface PointInfo {
  x: number;
  y: number;
  /** Number of branches leaving this point. */
  branches: number;
  wires: number;
  /** A wire end or a pin lies here (only such points can be connections). */
  poi: boolean;
  /** Connectivity nodes touching this point (wire indices and pin keys). */
  wireIdx: Set<number>;
  pins: WorldPin[];
}

export interface Connectivity {
  /** Points where a junction dot must be drawn (≥ 3 branches meet). */
  junctions: Pt[];
  /** Ids of the wires meeting at each junction (same order as `junctions`). */
  junctionWires: Id[][];
  /** Net number of every wire (by wire id) and pin (`elId:pinId`). */
  netOf: Map<string, number>;
  /** Pins that touch at least one wire or other pin. */
  connectedPins: Set<string>;
}

export const pinKey = (elId: Id, pinId: string) => `${elId}:${pinId}`;

/**
 * Analyse the connections of a sheet.
 *
 * Rules:
 *  - Connections only happen at wire end points and pins ("points of interest").
 *  - At such a point, count branches: a wire ending there = 1, a wire passing through
 *    (bend or straight segment) = 2, a pin = 1.
 *  - 3 or more branches with at least one wire → junction dot.
 *  - Two wires that simply cross (no end point there) are not connected and get no dot.
 */
export function analyzeConnectivity(elements: Element[], ctx: SheetContext): Connectivity {
  const wires = elements.filter((e): e is WireElement => e.type === 'wire' && e.pts.length >= 4);
  const points = new Map<string, PointInfo>();
  const at = (x: number, y: number): PointInfo => {
    const k = ptKey(x, y);
    let p = points.get(k);
    if (!p) {
      p = { x, y, branches: 0, wires: 0, poi: false, wireIdx: new Set(), pins: [] };
      points.set(k, p);
    }
    return p;
  };

  wires.forEach((w, wi) => {
    const n = w.pts.length / 2;
    for (let i = 0; i < n; i++) {
      const p = at(w.pts[2 * i]!, w.pts[2 * i + 1]!);
      const isEnd = i === 0 || i === n - 1;
      p.branches += isEnd ? 1 : 2;
      p.wires += 1;
      p.wireIdx.add(wi);
      if (isEnd) p.poi = true;
    }
  });

  const allPins: WorldPin[] = [];
  for (const el of elements) {
    // A net label only names the wire it sits on: it connects but is not a branch.
    const weight = el.type === 'label' ? 0 : 1;
    for (const pin of elementPins(el, ctx)) {
      allPins.push(pin);
      const p = at(pin.x, pin.y);
      p.branches += weight;
      p.poi = true;
      p.pins.push(pin);
    }
  }

  const index = new SegmentIndex(wires);
  for (const p of points.values()) {
    if (!p.poi) continue;
    for (const s of index.through(p.x, p.y)) {
      p.branches += 2;
      p.wires += 1;
      p.wireIdx.add(s.wire);
    }
  }

  // Union-find over wires and pins.
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    let r = a;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = a;
    while (parent.get(c) !== r) {
      const next = parent.get(c)!;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  const add = (a: string) => {
    if (!parent.has(a)) parent.set(a, a);
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  wires.forEach((w) => add(`w:${w.id}`));
  for (const pin of allPins) add(`p:${pinKey(pin.elId, pin.pinId)}`);

  const junctions: Pt[] = [];
  const junctionWires: Id[][] = [];
  const connectedPins = new Set<string>();
  for (const p of points.values()) {
    if (!p.poi) continue;
    const nodes = [
      ...[...p.wireIdx].map((i) => `w:${wires[i]!.id}`),
      ...p.pins.map((pin) => `p:${pinKey(pin.elId, pin.pinId)}`),
    ];
    for (let i = 1; i < nodes.length; i++) union(nodes[0]!, nodes[i]!);
    if (nodes.length > 1) for (const pin of p.pins) connectedPins.add(pinKey(pin.elId, pin.pinId));
    if (p.branches >= 3 && p.wires >= 1) {
      junctions.push({ x: p.x, y: p.y });
      junctionWires.push([...p.wireIdx].map((i) => wires[i]!.id));
    }
  }

  // Net labels with the same text are connected.
  const labels = elements.filter((e): e is LabelElement => e.type === 'label');
  const byText = new Map<string, string>();
  for (const l of labels) {
    const node = `p:${pinKey(l.id, 'p')}`;
    const first = byText.get(l.text);
    if (first) union(first, node);
    else byText.set(l.text, node);
  }

  const netOf = new Map<string, number>();
  const netIds = new Map<string, number>();
  for (const k of parent.keys()) {
    const root = find(k);
    let n = netIds.get(root);
    if (n === undefined) {
      n = netIds.size;
      netIds.set(root, n);
    }
    netOf.set(k.slice(2), n);
  }

  return { junctions, junctionWires, netOf, connectedPins };
}

/** Convenience wrapper returning only the junction dots. */
export function findJunctions(elements: Element[], ctx: SheetContext): Pt[] {
  return analyzeConnectivity(elements, ctx).junctions;
}

/** Pin within `radius` px of a point (closest first). */
export function pinAt(
  elements: Element[],
  ctx: SheetContext,
  x: number,
  y: number,
  radius = 6,
): WorldPin | undefined {
  let best: WorldPin | undefined;
  let bestD = radius;
  for (const el of elements) {
    for (const p of elementPins(el, ctx)) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= bestD) {
        best = p;
        bestD = d;
      }
    }
  }
  return best;
}
