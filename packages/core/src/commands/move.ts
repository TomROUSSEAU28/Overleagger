import { elementPins, elementBBox, type SheetContext } from '../geometry/elements';
import { normalizeWire, ptKey, rectUnion, snap, samePt } from '../geometry/geom';
import type { Element, Id, Rot, Side, WireElement } from '../model/types';
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

/**
 * Compute the result of moving `ids` by (dx, dy): moved elements are translated, and wires that
 * are attached to them (by an end point) are stretched so they stay connected and orthogonal.
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
  const out: Element[] = [];
  const anchors = new Set<string>();
  for (const el of elements) {
    if (!ids.has(el.id)) continue;
    out.push(translated(el, dx, dy));
    for (const p of elementPins(el, ctx)) anchors.add(ptKey(p.x, p.y));
    if (el.type === 'wire')
      for (let i = 0; i < el.pts.length; i += 2) anchors.add(ptKey(el.pts[i]!, el.pts[i + 1]!));
  }
  for (const el of elements) {
    if (ids.has(el.id) || el.type !== 'wire' || el.pts.length < 4) continue;
    const n = el.pts.length;
    const startOn = anchors.has(ptKey(el.pts[0]!, el.pts[1]!));
    const endOn = anchors.has(ptKey(el.pts[n - 2]!, el.pts[n - 1]!));
    if (startOn && endOn) {
      out.push(translated(el, dx, dy));
    } else if (endOn) {
      out.push({ ...el, pts: moveWireEnd(el.pts, dx, dy) });
    } else if (startOn) {
      out.push({ ...el, pts: reversePts(moveWireEnd(reversePts(el.pts), dx, dy)) });
    }
  }
  return out;
}

/**
 * Drag segment `seg` (between vertex seg and seg+1) of a wire perpendicular to itself.
 * End points stay where they are: a new vertex is inserted when an end segment moves.
 */
export function dragSegment(w: WireElement, seg: number, dx: number, dy: number): number[] {
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
  const moved = [...pts];
  moved[2 * seg] = ax + mx;
  moved[2 * seg + 1] = ay + my;
  moved[2 * seg + 2] = bx + mx;
  moved[2 * seg + 3] = by + my;
  let out = moved;
  // Keep the wire's end points fixed.
  if (seg === n - 2) out = [...out, bx, by];
  if (seg === 0) out = [ax, ay, ...out];
  return normalizeWire(out);
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
  const moves = new Map<string, { x: number; y: number }>();
  for (const n of changed) {
    const o = byId.get(n.id);
    if (!o) continue;
    const after = new Map(elementPins(n, ctx).map((p) => [p.pinId, p]));
    for (const p of elementPins(o, ctx)) {
      const q = after.get(p.pinId);
      if (q && (q.x !== p.x || q.y !== p.y)) moves.set(ptKey(p.x, p.y), { x: q.x, y: q.y });
    }
  }
  if (!moves.size) return [];
  const out: Element[] = [];
  for (const w of all) {
    if (w.type !== 'wire' || changedIds.has(w.id) || w.pts.length < 4) continue;
    let pts = w.pts;
    const start = moves.get(ptKey(pts[0]!, pts[1]!));
    const n = pts.length;
    const end = moves.get(ptKey(pts[n - 2]!, pts[n - 1]!));
    if (end) pts = moveWireEnd(pts, end.x - pts[n - 2]!, end.y - pts[n - 1]!);
    if (start) {
      const r = reversePts(pts);
      const m = r.length;
      pts = reversePts(moveWireEnd(r, start.x - r[m - 2]!, start.y - r[m - 1]!));
    }
    if (pts !== w.pts) out.push({ ...w, pts });
  }
  return out;
}

/** True when the point is one of the end points of the wire. */
export function isWireEnd(w: WireElement, x: number, y: number): boolean {
  const n = w.pts.length;
  return samePt(w.pts[0]!, w.pts[1]!, x, y) || samePt(w.pts[n - 2]!, w.pts[n - 1]!, x, y);
}
