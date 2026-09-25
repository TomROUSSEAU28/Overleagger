import { followConnectors } from '../geometry/connectors';
import { elementPins, elementBBox, type SheetContext } from '../geometry/elements';
import {
  EPS,
  normalizeWire,
  onSegmentInterior,
  ptKey,
  rectUnion,
  snap,
  samePt,
} from '../geometry/geom';
import type { Element, Id, Pt, Rot, Side, WireElement } from '../model/types';
import { GRID } from '../model/types';

/** Shift a flat point list whose points have `stride` numbers (x, y, …). */
function shiftPts(pts: number[], dx: number, dy: number, stride = 2): number[] {
  return pts.map((v, i) => (i % stride === 0 ? v + dx : i % stride === 1 ? v + dy : v));
}

/** Translate one element (wires, lines and strokes move all their vertices). */
export function translated(el: Element, dx: number, dy: number): Element {
  switch (el.type) {
    case 'wire':
    case 'line':
      return { ...el, pts: shiftPts(el.pts, dx, dy) };
    case 'stroke':
      return { ...el, pts: shiftPts(el.pts, dx, dy, 3) };
    case 'group':
      return el;
    default:
      return { ...el, x: el.x + dx, y: el.y + dy };
  }
}

/** Move the last vertex of a wire by (dx, dy) keeping every segment orthogonal. */
function moveWireEnd(pts: number[], dx: number, dy: number): number[] {
  const p = [...pts];
  const n = p.length / 2;
  const ex = p[2 * n - 2]!;
  const ey = p[2 * n - 1]!;
  const px = p[2 * n - 4]!;
  const py = p[2 * n - 3]!;
  const nx = ex + dx;
  const ny = ey + dy;
  const horizontal = Math.abs(py - ey) < 1e-6 && Math.abs(px - ex) > 1e-6;
  const vertical = Math.abs(px - ex) < 1e-6 && Math.abs(py - ey) > 1e-6;
  if (n === 2) {
    if (horizontal && dy !== 0) {
      const mx = snap((px + nx) / 2, GRID);
      return normalizeWire([px, py, mx, py, mx, ny, nx, ny]);
    }
    if (vertical && dx !== 0) {
      const my = snap((py + ny) / 2, GRID);
      return normalizeWire([px, py, px, my, nx, my, nx, ny]);
    }
    return normalizeWire([px, py, nx, ny]);
  }
  if (horizontal) p[2 * n - 3] = py + dy;
  else if (vertical) p[2 * n - 4] = px + dx;
  p[2 * n - 2] = nx;
  p[2 * n - 1] = ny;
  return normalizeWire(p);
}

function reversePts(pts: number[]): number[] {
  const out: number[] = [];
  for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i]!, pts[i + 1]!);
  return out;
}

/** True when (x, y) is on the wire: one of its vertices or a point of one of its segments. */
export function onWire(pts: number[], x: number, y: number): boolean {
  for (let i = 0; i < pts.length; i += 2) if (samePt(pts[i]!, pts[i + 1]!, x, y)) return true;
  for (let i = 2; i < pts.length; i += 2)
    if (onSegmentInterior(x, y, pts[i - 2]!, pts[i - 1]!, pts[i]!, pts[i + 1]!)) return true;
  return false;
}

/** On the wire, but not at one of its two end points (a bend, or the middle of a segment). */
function throughWire(pts: number[], x: number, y: number): boolean {
  const n = pts.length;
  return (
    onWire(pts, x, y) && !samePt(pts[0]!, pts[1]!, x, y) && !samePt(pts[n - 2]!, pts[n - 1]!, x, y)
  );
}

/**
 * Bring the start of a (translated) wire back to (x, y): its first segment stretches, and a short
 * leg joins it to (x, y) when the move went across it.
 */
function holdStart(pts: number[], x: number, y: number): number[] {
  const sx = pts[0]!;
  const sy = pts[1]!;
  const ax = pts[2]!;
  const ay = pts[3]!;
  if (samePt(sx, sy, x, y)) return pts;
  const horizontal = Math.abs(sy - ay) < EPS && Math.abs(sx - ax) > EPS;
  const vertical = Math.abs(sx - ax) < EPS && Math.abs(sy - ay) > EPS;
  let head = [x, y];
  if (horizontal && Math.abs(sy - y) > EPS) head = [x, y, x, sy];
  else if (vertical && Math.abs(sx - x) > EPS) head = [x, y, sx, y];
  return normalizeWire([...head, ...pts.slice(2)]);
}

const holdEnd = (pts: number[], x: number, y: number) =>
  reversePts(holdStart(reversePts(pts), x, y));

/**
 * A wire that changed shape: where a point that was on it (a wire end, a net label) goes. Points
 * on the part that moved (`moving`) go with it by `d`; the others stay, as long as they are still
 * on the wire.
 */
interface WireEdit {
  old: number[];
  pts: number[];
  d: Pt;
  moving: (x: number, y: number) => boolean;
}

function relocate(e: WireEdit, x: number, y: number): Pt {
  const moved = { x: x + e.d.x, y: y + e.d.y };
  const here = { x, y };
  const [a, b] = e.moving(x, y) ? [moved, here] : [here, moved];
  if (onWire(e.pts, a.x, a.y)) return a;
  if (onWire(e.pts, b.x, b.y)) return b;
  // The wire got shorter past it: hold on to the nearest point of the wire.
  return nearestOnWire(e.pts, a.x, a.y);
}

/** Point of the wire closest to (x, y) (on the grid when the wire is). */
function nearestOnWire(pts: number[], x: number, y: number): Pt {
  let best = { x: pts[0]!, y: pts[1]! };
  let bestD = Infinity;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const [ax, ay, bx, by] = [pts[i]!, pts[i + 1]!, pts[i + 2]!, pts[i + 3]!];
    const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / l2)) : 0;
    let px = ax + t * (bx - ax);
    let py = ay + t * (by - ay);
    // Orthogonal segments: snap along them to the grid, so the junction stays on the grid.
    if (ay === by) px = Math.min(Math.max(snap(px, GRID), Math.min(ax, bx)), Math.max(ax, bx));
    if (ax === bx) py = Math.min(Math.max(snap(py, GRID), Math.min(ay, by)), Math.max(ay, by));
    const d = Math.hypot(px - x, py - y);
    if (d < bestD) {
      bestD = d;
      best = { x: px, y: py };
    }
  }
  return best;
}

/**
 * First connection point along a wire, from its start: a pin or a wire end in the middle of a
 * segment, or on one of its bends. Splits the wire there: `head` from the start to that point,
 * `tail` from that point to the end.
 */
function firstBreak(p: number[], conns: Pt[]): { head: number[]; tail: number[] } | null {
  for (let i = 0; i + 3 < p.length; i += 2) {
    const [ax, ay, bx, by] = [p[i]!, p[i + 1]!, p[i + 2]!, p[i + 3]!];
    let best: Pt | null = null;
    let bestD = Infinity;
    for (const c of conns) {
      if (!onSegmentInterior(c.x, c.y, ax, ay, bx, by)) continue;
      const d = Math.hypot(c.x - ax, c.y - ay);
      if (d < bestD) {
        best = c;
        bestD = d;
      }
    }
    if (best)
      return {
        head: [...p.slice(0, i + 2), best.x, best.y],
        tail: [best.x, best.y, ...p.slice(i + 2)],
      };
    const lastSeg = i + 4 >= p.length;
    if (!lastSeg && conns.some((c) => samePt(c.x, c.y, bx, by)))
      return { head: p.slice(0, i + 4), tail: p.slice(i + 2) };
  }
  return null;
}

/**
 * Move the start of a wire by (dx, dy), keeping it orthogonal. Only the stretch before its first
 * connection point bends: what is connected further along (T junctions, pins) stays on it.
 */
function stretchStart(pts: number[], dx: number, dy: number, conns: Pt[]): number[] {
  const cut = firstBreak(pts, conns);
  if (!cut) return reversePts(moveWireEnd(reversePts(pts), dx, dy));
  const head = reversePts(moveWireEnd(reversePts(cut.head), dx, dy));
  return normalizeWire([...head, ...cut.tail.slice(2)]);
}

const stretchEnd = (pts: number[], dx: number, dy: number, conns: Pt[]) =>
  reversePts(stretchStart(reversePts(pts), dx, dy, conns));

/** Points where things connect: every pin (net labels too) and every wire end. */
function connectionPoints(elements: Element[], ctx: SheetContext): Pt[] {
  const out: Pt[] = [];
  const seen = new Set<string>();
  const add = (x: number, y: number) => {
    const k = ptKey(x, y);
    if (!seen.has(k)) {
      seen.add(k);
      out.push({ x, y });
    }
  };
  for (const el of elements) {
    if (el.type === 'wire') {
      const n = el.pts.length;
      if (n >= 4) {
        add(el.pts[0]!, el.pts[1]!);
        add(el.pts[n - 2]!, el.pts[n - 1]!);
      }
    } else if (el.type !== 'group') for (const p of elementPins(el, ctx)) add(p.x, p.y);
  }
  return out;
}

/**
 * The wires and net labels (not in `skip`) that are attached to what moved follow it: a wire end
 * or a label on a moved pin (`pinTarget`) or anywhere on a changed wire (`edits`), including the
 * middle of its segments (T junctions).
 */
function attachedFollow(
  elements: Element[],
  skip: Set<Id>,
  pinTarget: (x: number, y: number) => Pt | null,
  edits: WireEdit[],
  ctx: SheetContext,
): Element[] {
  const conns = connectionPoints(elements, ctx);
  const target = (x: number, y: number): Pt | null => {
    let t = pinTarget(x, y);
    if (!t) {
      const e = edits.find((e) => onWire(e.old, x, y));
      if (e) t = relocate(e, x, y);
    }
    return t && !samePt(t.x, t.y, x, y) ? t : null;
  };
  const out: Element[] = [];
  for (const el of elements) {
    if (skip.has(el.id)) continue;
    if (el.type === 'wire' && el.pts.length >= 4) {
      const n = el.pts.length;
      const s = target(el.pts[0]!, el.pts[1]!);
      const e = target(el.pts[n - 2]!, el.pts[n - 1]!);
      if (!s && !e) continue;
      if (s && e) {
        const [sdx, sdy] = [s.x - el.pts[0]!, s.y - el.pts[1]!];
        if (samePt(sdx, sdy, e.x - el.pts[n - 2]!, e.y - el.pts[n - 1]!)) {
          out.push(translated(el, sdx, sdy));
          continue;
        }
      }
      // The wire's own ends are not in the way.
      const own = conns.filter(
        (c) =>
          !samePt(c.x, c.y, el.pts[0]!, el.pts[1]!) &&
          !samePt(c.x, c.y, el.pts[n - 2]!, el.pts[n - 1]!),
      );
      let pts = el.pts;
      if (e) pts = stretchEnd(pts, e.x - pts[n - 2]!, e.y - pts[n - 1]!, own);
      if (s) pts = stretchStart(pts, s.x - pts[0]!, s.y - pts[1]!, own);
      out.push({ ...el, pts });
    } else if (el.type === 'label') {
      const t = target(el.x, el.y);
      if (t) out.push({ ...el, x: t.x, y: t.y });
    }
  }
  return out;
}

/**
 * A point in the middle of a straight run of one of `hosts` (a T junction), pushed by
 * (dx, dy): it slides along that run as far as the run goes. Null when the point is not in
 * the middle of a run.
 */
function slideOnHost(
  hosts: WireElement[],
  x: number,
  y: number,
  dx: number,
  dy: number,
): Pt | null {
  const clamp = (v: number, a: number, b: number) =>
    Math.min(Math.max(v, Math.min(a, b)), Math.max(a, b));
  for (const w of hosts)
    for (let i = 2; i < w.pts.length; i += 2) {
      const [ax, ay, bx, by] = [w.pts[i - 2]!, w.pts[i - 1]!, w.pts[i]!, w.pts[i + 1]!];
      if (!onSegmentInterior(x, y, ax, ay, bx, by)) continue;
      if (Math.abs(ay - by) < EPS) return { x: clamp(x + dx, ax, bx), y };
      if (Math.abs(ax - bx) < EPS) return { x, y: clamp(y + dy, ay, by) };
      return { x, y };
    }
  return null;
}

/** Keys of the pins of `els`. */
function pinKeys(els: Element[], ctx: SheetContext): Set<string> {
  const out = new Set<string>();
  for (const el of els)
    if (el.type !== 'wire' && el.type !== 'group')
      for (const p of elementPins(el, ctx)) out.add(ptKey(p.x, p.y));
  return out;
}

/**
 * The pieces of a wire a click picks: its segments, cut where something connects in their
 * middle (a T junction, a pin, a net label). Returns the wire's points with those cuts added.
 */
export function wirePieces(elements: Element[], w: WireElement, ctx: SheetContext): number[] {
  const n = w.pts.length;
  const conns = connectionPoints(elements, ctx).filter(
    (c) =>
      !samePt(c.x, c.y, w.pts[0]!, w.pts[1]!) && !samePt(c.x, c.y, w.pts[n - 2]!, w.pts[n - 1]!),
  );
  const out = [w.pts[0]!, w.pts[1]!];
  for (let i = 2; i < n; i += 2) {
    const [ax, ay, bx, by] = [w.pts[i - 2]!, w.pts[i - 1]!, w.pts[i]!, w.pts[i + 1]!];
    const cuts = conns
      .filter((c) => onSegmentInterior(c.x, c.y, ax, ay, bx, by))
      .sort((c, d) => Math.hypot(c.x - ax, c.y - ay) - Math.hypot(d.x - ax, d.y - ay));
    for (const c of cuts) out.push(c.x, c.y);
    out.push(bx, by);
  }
  return out;
}

/**
 * Compute the result of moving `ids` by (dx, dy). Moved elements are translated, and what is
 * attached to them follows:
 *  - wires ending on a moved pin, or anywhere on a moved wire (T junctions too), are stretched
 *    so they stay connected and orthogonal; net labels on them go along;
 *  - a moved wire whose end is on something that stays (the pin of a part that stays, the
 *    middle of a wire that stays) keeps that end in place and stretches instead.
 * Returns only the changed elements.
 */
export function computeMove(
  elements: Element[],
  ids: Set<Id>,
  dx: number,
  dy: number,
  ctx: SheetContext,
): Element[] {
  if (dx === 0 && dy === 0) return [];
  const out = new Map<Id, Element>();
  const movedPins = pinKeys(
    elements.filter((e) => ids.has(e.id)),
    ctx,
  );
  // Net labels only name a wire: they go with it rather than hold it.
  const stayingPins = pinKeys(
    elements.filter((e) => !ids.has(e.id) && e.type !== 'label'),
    ctx,
  );
  const stayingWires = elements.filter(
    (e): e is WireElement => e.type === 'wire' && !ids.has(e.id) && e.pts.length >= 4,
  );
  // Where an end of a moved wire goes when what it touches stays: on the pin of a part that
  // stays it stays; in the middle of a wire that stays it slides along it (the junction dot
  // follows); on a bend of a wire that stays it stays. Null: it moves freely.
  const endTarget = (x: number, y: number): Pt | null => {
    const k = ptKey(x, y);
    if (movedPins.has(k)) return null;
    if (stayingPins.has(k)) return { x, y };
    const slid = slideOnHost(stayingWires, x, y, dx, dy);
    if (slid) return slid;
    return stayingWires.some((w) => throughWire(w.pts, x, y)) ? { x, y } : null;
  };
  const d = { x: dx, y: dy };
  const edits: WireEdit[] = [];
  for (const el of elements) {
    if (!ids.has(el.id)) continue;
    if (el.type === 'wire' && el.pts.length >= 4) {
      const n = el.pts.length;
      const [sx, sy, ex, ey] = [el.pts[0]!, el.pts[1]!, el.pts[n - 2]!, el.pts[n - 1]!];
      const hs = endTarget(sx, sy);
      const he = endTarget(ex, ey);
      let pts = shiftPts(el.pts, dx, dy);
      if (hs) pts = holdStart(pts, hs.x, hs.y);
      if (he) pts = holdEnd(pts, he.x, he.y);
      // Ends that did not move at all.
      const fixedS = hs && samePt(hs.x, hs.y, sx, sy);
      const fixedE = he && samePt(he.x, he.y, ex, ey);
      out.set(el.id, { ...el, pts });
      edits.push({
        old: el.pts,
        pts,
        d,
        moving: (x, y) => !((fixedS && samePt(x, y, sx, sy)) || (fixedE && samePt(x, y, ex, ey))),
      });
      continue;
    }
    let moved = translated(el, dx, dy);
    // A connector moved without its shape lets go of it.
    if (moved.type === 'line') {
      const { from, to, ...rest } = moved;
      moved = {
        ...rest,
        ...(from && ids.has(from.id) ? { from } : {}),
        ...(to && ids.has(to.id) ? { to } : {}),
      } as Element;
    }
    out.set(el.id, moved);
  }
  const pinTarget = (x: number, y: number) =>
    movedPins.has(ptKey(x, y)) ? { x: x + dx, y: y + dy } : null;
  for (const f of attachedFollow(elements, ids, pinTarget, edits, ctx)) out.set(f.id, f);
  // Connectors attached to moved shapes follow them.
  for (const l of followConnectors(elements, [...out.values()])) out.set(l.id, l);
  return [...out.values()];
}

/**
 * Drag segment `seg` (between vertex seg and seg+1) of a wire perpendicular to itself.
 * End points stay where they are (a new vertex is inserted when an end segment moves), unless
 * `keepStart` / `keepEnd` say they may go with the segment.
 */
export function dragSegment(
  w: WireElement,
  seg: number,
  dx: number,
  dy: number,
  keepStart = true,
  keepEnd = true,
): number[] {
  const pts = [...w.pts];
  const n = pts.length / 2;
  if (seg < 0 || seg >= n - 1) return pts;
  const ax = pts[2 * seg]!;
  const ay = pts[2 * seg + 1]!;
  const bx = pts[2 * seg + 2]!;
  const by = pts[2 * seg + 3]!;
  const horizontal = Math.abs(ay - by) < 1e-6;
  const vertical = Math.abs(ax - bx) < 1e-6;
  const mx = horizontal ? 0 : dx;
  const my = vertical ? 0 : dy;
  if (horizontal && vertical) return pts;
  const { keepA, keepB } = segmentKeeps(pts, seg, keepStart, keepEnd);
  let out = [...pts];
  out[2 * seg] = ax + mx;
  out[2 * seg + 1] = ay + my;
  out[2 * seg + 2] = bx + mx;
  out[2 * seg + 3] = by + my;
  // Ends that stay (wire ends, junctions in a straight run) get a leg to the moved piece.
  if (keepB) out = [...out.slice(0, 2 * seg + 4), bx, by, ...out.slice(2 * seg + 4)];
  if (keepA) out = [...out.slice(0, 2 * seg), ax, ay, ...out.slice(2 * seg)];
  return normalizeWire(out);
}

/**
 * Which ends of segment `seg` stay when it is dragged: the wire's own ends as asked, and the
 * points where the wire goes on straight (a cut made at a junction); real bends move with it.
 */
function segmentKeeps(pts: number[], seg: number, keepStart: boolean, keepEnd: boolean) {
  const n = pts.length / 2;
  const straight = (i: number, j: number, k: number) => {
    const [px, py, qx, qy, rx, ry] = [
      pts[2 * i]!,
      pts[2 * i + 1]!,
      pts[2 * j]!,
      pts[2 * j + 1]!,
      pts[2 * k]!,
      pts[2 * k + 1]!,
    ];
    return Math.abs((qx - px) * (ry - qy) - (qy - py) * (rx - qx)) < EPS;
  };
  return {
    keepA: seg === 0 ? keepStart : straight(seg - 1, seg, seg + 1),
    keepB: seg === n - 2 ? keepEnd : straight(seg, seg + 1, seg + 2),
  };
}

/**
 * Drag one segment of a wire across itself, with what is attached to it: wires ending on the
 * segment (or on its bends) and net labels on it go along. An end of the wire that touches
 * nothing goes with the segment; one that is connected stays and a leg is added.
 * Returns the changed elements (the wire first).
 */
export function computeSegmentDrag(
  elements: Element[],
  wireId: Id,
  seg: number,
  dx: number,
  dy: number,
  ctx: SheetContext,
): Element[] {
  const orig = elements.find((e): e is WireElement => e.id === wireId && e.type === 'wire');
  if (!orig || (!dx && !dy)) return [];
  // `seg` counts the pieces of the wire (segments cut at junctions).
  const w = { ...orig, pts: wirePieces(elements, orig, ctx) };
  const n = w.pts.length / 2;
  if (seg < 0 || seg >= n - 1) return [];
  const [ax, ay, bx, by] = w.pts.slice(2 * seg, 2 * seg + 4) as [number, number, number, number];
  const horizontal = Math.abs(ay - by) < EPS;
  const vertical = Math.abs(ax - bx) < EPS;
  const d = { x: horizontal ? 0 : dx, y: vertical ? 0 : dy };
  if (!d.x && !d.y) return [];
  const pins = pinKeys(
    elements.filter((e) => e.type !== 'label'),
    ctx,
  );
  const others = elements.filter(
    (e): e is WireElement => e.type === 'wire' && e.id !== w.id && e.pts.length >= 4,
  );
  // An end of the wire stays (with a leg) on a pin, or on a wire it cannot slide along; in the
  // middle of a wire running the way it is pushed it slides along it (the junction follows);
  // on the end of another wire, or on nothing, it goes (and the other wire follows).
  const stays = (x: number, y: number) => {
    if (pins.has(ptKey(x, y))) return true;
    const slid = slideOnHost(others, x, y, d.x, d.y);
    if (slid) return !samePt(slid.x, slid.y, x + d.x, y + d.y);
    return others.some((o) => throughWire(o.pts, x, y));
  };
  const keepStart = seg === 0 && stays(ax, ay);
  const keepEnd = seg === n - 2 && stays(bx, by);
  const pts = dragSegment(w, seg, dx, dy, keepStart, keepEnd);
  const { keepA, keepB } = segmentKeeps(w.pts, seg, keepStart, keepEnd);
  const edit: WireEdit = {
    old: w.pts,
    pts,
    d,
    moving: (x, y) =>
      (samePt(x, y, ax, ay) && !keepA) ||
      (samePt(x, y, bx, by) && !keepB) ||
      onSegmentInterior(x, y, ax, ay, bx, by),
  };
  return [{ ...orig, pts }, ...attachedFollow(elements, new Set([w.id]), () => null, [edit], ctx)];
}

/** What remains of a wire once its segment `seg` is removed: 0, 1 or 2 pieces. */
export function removeSegment(pts: number[], seg: number): number[][] {
  return [pts.slice(0, 2 * seg + 2), pts.slice(2 * seg + 2)].filter((p) => p.length >= 4);
}

/** Index of the segment of `w` closest to (x, y). */
export function nearestSegment(w: WireElement, x: number, y: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i + 3 < w.pts.length; i += 2) {
    const ax = w.pts[i]!;
    const ay = w.pts[i + 1]!;
    const bx = w.pts[i + 2]!;
    const by = w.pts[i + 3]!;
    const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
    let t = l2 ? ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay)));
    if (d < bestD) {
      bestD = d;
      best = i / 2;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Rotation & mirroring
// ---------------------------------------------------------------------------

type PtFn = (x: number, y: number) => [number, number];

/** Quarter turn (cw / ccw) or mirror about a vertical ('x') / horizontal ('y') axis. */
type Op = { rot: 'cw' | 'ccw' } | { mirror: 'x' | 'y' };

const SIDE_CW: Record<Side, Side> = { t: 'r', r: 'b', b: 'l', l: 't' };
const SIDE_CCW: Record<Side, Side> = { t: 'l', l: 'b', b: 'r', r: 't' };

function turnSide(s: Side, op: Op): Side {
  if ('rot' in op) return (op.rot === 'cw' ? SIDE_CW : SIDE_CCW)[s];
  if (op.mirror === 'x') return s === 'l' ? 'r' : s === 'r' ? 'l' : s;
  return s === 't' ? 'b' : s === 'b' ? 't' : s;
}

/** Left ↔ right mirror (the only flip that changes ports, labels and text alignment). */
const flipsX = (op: Op) => 'mirror' in op && op.mirror === 'x';

const MIRROR_ALIGN = { start: 'end', end: 'start', middle: 'middle' } as const;

function transformElement(
  el: Element,
  f: PtFn,
  comp: (rot: Rot, mirror: boolean) => [Rot, boolean],
  op: Op,
): Element {
  switch (el.type) {
    case 'wire':
    case 'line': {
      const pts: number[] = [];
      for (let i = 0; i < el.pts.length; i += 2) pts.push(...f(el.pts[i]!, el.pts[i + 1]!));
      return { ...el, pts };
    }
    case 'stroke': {
      const pts: number[] = [];
      for (let i = 0; i < el.pts.length; i += 3)
        pts.push(...f(el.pts[i]!, el.pts[i + 1]!), el.pts[i + 2]!);
      return { ...el, pts };
    }
    case 'shape': {
      // Shapes turn with the selection: a quarter turn swaps width and height.
      const [cx, cy] = f(el.x + el.w / 2, el.y + el.h / 2);
      const [ax, ay] = f(el.x, el.y);
      const [bx, by] = f(el.x + el.w, el.y + el.h);
      const w = Math.abs(bx - ax);
      const h = Math.abs(by - ay);
      const out = { ...el, x: snap(cx - w / 2, GRID / 2), y: snap(cy - h / 2, GRID / 2), w, h };
      // Triangles point somewhere: turn / flip their apex too.
      if (el.kind === 'triangle') out.dir = turnSide(el.dir ?? 't', op);
      return out;
    }
    case 'image': {
      const [cx, cy] = f(el.x + el.w / 2, el.y + el.h / 2);
      const out = { ...el, x: snap(cx - el.w / 2, GRID), y: snap(cy - el.h / 2, GRID) };
      if ('mirror' in op) {
        if (op.mirror === 'x') out.flipX = !el.flipX;
        else out.flipY = !el.flipY;
      }
      return out;
    }
    case 'note':
    case 'button':
    case 'waveform':
    case 'frame': {
      const [cx, cy] = f(el.x + el.w / 2, el.y + el.h / 2);
      return { ...el, x: snap(cx - el.w / 2, GRID), y: snap(cy - el.h / 2, GRID) };
    }
    case 'component': {
      const [x, y] = f(el.x, el.y);
      const [rot, mirror] = comp(el.rot, el.mirror);
      return { ...el, x, y, rot, mirror };
    }
    case 'block': {
      // Blocks keep their orientation: move their centre.
      const [cx, cy] = f(el.x + el.w / 2, el.y + el.h / 2);
      return { ...el, x: snap(cx - el.w / 2, GRID), y: snap(cy - el.h / 2, GRID) };
    }
    case 'group':
      return el;
    case 'port':
    case 'label': {
      // The shape / flag goes to the other side of its connection point.
      const [x, y] = f(el.x, el.y);
      return flipsX(op) ? { ...el, x, y, flip: !el.flip } : { ...el, x, y };
    }
    case 'text': {
      const [x, y] = f(el.x, el.y);
      // Text stays readable: mirroring only swaps its alignment.
      const align = flipsX(op) ? MIRROR_ALIGN[el.align] : el.align;
      return { ...el, x, y, align };
    }
    default:
      return el;
  }
}

/** Elements whose anchor point is also their connection point. */
const ANCHORED: Element['type'][] = ['component', 'port', 'label', 'text'];

function selectionCenter(elements: Element[], ctx: SheetContext): [number, number] {
  // A single part turns / flips around its own anchor, so the wires attached to it stay put.
  const one = elements.length === 1 ? elements[0]! : undefined;
  if (one && ANCHORED.includes(one.type) && 'x' in one) return [one.x, one.y];
  const r = rectUnion(elements.map((e) => elementBBox(e, ctx, elements)));
  if (!r) return [0, 0];
  return [snap(r.x + r.w / 2, GRID), snap(r.y + r.h / 2, GRID)];
}

/** Rotate elements by a quarter turn clockwise (or counter-clockwise) around their common centre. */
export function rotateElements(elements: Element[], ctx: SheetContext, ccw = false): Element[] {
  const [cx, cy] = selectionCenter(elements, ctx);
  const f: PtFn = ccw
    ? (x, y) => [cx + (y - cy), cy - (x - cx)]
    : (x, y) => [cx - (y - cy), cy + (x - cx)];
  return elements.map((el) =>
    transformElement(el, f, (rot, mirror) => [((rot + (ccw ? 3 : 1)) % 4) as Rot, mirror], {
      rot: ccw ? 'ccw' : 'cw',
    }),
  );
}

/** Mirror elements horizontally (axis = 'x', left↔right) or vertically (axis = 'y'). */
export function mirrorElements(
  elements: Element[],
  ctx: SheetContext,
  axis: 'x' | 'y' = 'x',
): Element[] {
  const [cx, cy] = selectionCenter(elements, ctx);
  const f: PtFn = axis === 'x' ? (x, y) => [2 * cx - x, y] : (x, y) => [x, 2 * cy - y];
  return elements.map((el) =>
    transformElement(
      el,
      f,
      (rot, mirror) => [(axis === 'x' ? (4 - rot) % 4 : (6 - rot) % 4) as Rot, !mirror],
      { mirror: axis },
    ),
  );
}

/**
 * After elements changed shape or orientation (rotation, options, size…), move the attached
 * ends of the other wires to the new positions of their pins. Returns the changed wires.
 */
export function followPins(all: Element[], changed: Element[], ctx: SheetContext): Element[] {
  const byId = new Map(all.map((e) => [e.id, e]));
  const changedIds = new Set(changed.map((e) => e.id));
  const moves = new Map<string, Pt>();
  // Wires that turned with the selection: a point on one goes to the same place on the new one.
  const turned: { old: number[]; pts: number[] }[] = [];
  for (const n of changed) {
    const o = byId.get(n.id);
    if (!o) continue;
    if (o.type === 'wire' && n.type === 'wire') {
      if (o.pts.length === n.pts.length && o.pts.some((v, i) => v !== n.pts[i]))
        turned.push({ old: o.pts, pts: n.pts });
      continue;
    }
    const after = new Map(elementPins(n, ctx).map((p) => [p.pinId, p]));
    for (const p of elementPins(o, ctx)) {
      const q = after.get(p.pinId);
      if (q && (q.x !== p.x || q.y !== p.y)) moves.set(ptKey(p.x, p.y), { x: q.x, y: q.y });
    }
  }
  if (!moves.size && !turned.length) return [];
  const target = (x: number, y: number): Pt | null => {
    const m = moves.get(ptKey(x, y));
    if (m) return m;
    for (const w of turned) {
      for (let i = 0; i < w.old.length; i += 2) {
        if (samePt(w.old[i]!, w.old[i + 1]!, x, y)) return { x: w.pts[i]!, y: w.pts[i + 1]! };
        if (i + 3 < w.old.length) {
          const [ax, ay, bx, by] = w.old.slice(i, i + 4) as [number, number, number, number];
          if (!onSegmentInterior(x, y, ax, ay, bx, by)) continue;
          const t = Math.hypot(x - ax, y - ay) / Math.hypot(bx - ax, by - ay);
          const [cx, cy, dx, dy] = w.pts.slice(i, i + 4) as [number, number, number, number];
          const r = (v: number) => Math.round(v * 1e6) / 1e6;
          return { x: r(cx + (dx - cx) * t), y: r(cy + (dy - cy) * t) };
        }
      }
    }
    return null;
  };
  return attachedFollow(all, changedIds, target, [], ctx);
}

/** True when the point is one of the end points of the wire. */
export function isWireEnd(w: WireElement, x: number, y: number): boolean {
  const n = w.pts.length;
  return samePt(w.pts[0]!, w.pts[1]!, x, y) || samePt(w.pts[n - 2]!, w.pts[n - 1]!, x, y);
}
