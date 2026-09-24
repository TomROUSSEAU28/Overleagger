import type { BBox, PinDef, Primitive, StrokeOpts, TextPrimitive } from './types';

// ---------------------------------------------------------------------------
// Primitive constructors (short names keep the symbol library readable)
// ---------------------------------------------------------------------------

export const L = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  o: StrokeOpts = {},
): Primitive => ({
  k: 'line',
  x1,
  y1,
  x2,
  y2,
  ...o,
});

/** Open polyline. */
export const P = (pts: number[], o: StrokeOpts = {}): Primitive => ({ k: 'poly', pts, ...o });

/** Closed polygon. */
export const PC = (pts: number[], o: StrokeOpts = {}): Primitive => ({
  k: 'poly',
  pts,
  closed: true,
  ...o,
});

export const C = (cx: number, cy: number, r: number, o: StrokeOpts = {}): Primitive => ({
  k: 'circle',
  cx,
  cy,
  r,
  ...o,
});

export const A = (
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
  o: StrokeOpts = {},
): Primitive => ({ k: 'arc', cx, cy, r, a0, a1, ...o });

export const R = (
  x: number,
  y: number,
  w: number,
  h: number,
  o: StrokeOpts & { rx?: number } = {},
): Primitive => ({
  k: 'rect',
  x,
  y,
  w,
  h,
  ...o,
});

export const T = (
  x: number,
  y: number,
  t: string,
  o: Omit<TextPrimitive, 'k' | 'x' | 'y' | 't'> = {},
): Primitive => ({ k: 'text', x, y, t, ...o });

/** Math text (LaTeX). */
export const M = (x: number, y: number, t: string, size?: number): Primitive => ({
  k: 'text',
  x,
  y,
  t,
  math: true,
  ...(size ? { size } : {}),
});

/** Drawn "+" sign centred on (x, y) (crisper than a font glyph, identical in PDF exports). */
export const plus = (x: number, y: number, s = 0.3): Primitive[] => [
  L(x - s, y, x + s, y, { sw: 0.9 }),
  L(x, y - s, x, y + s, { sw: 0.9 }),
];

/** Drawn "−" sign centred on (x, y). */
export const minus = (x: number, y: number, s = 0.3): Primitive[] => [
  L(x - s, y, x + s, y, { sw: 0.9 }),
];

/** "+" or "−" from a character. */
export const sign = (c: string, x: number, y: number, s = 0.3): Primitive[] =>
  c === '-' || c === '−' ? minus(x, y, s) : plus(x, y, s);

/** Small filled connection dot. */
export const dot = (x: number, y: number, r = 0.2): Primitive => C(x, y, r, { fill: 'ink', sw: 0 });

export const pin = (id: string, x: number, y: number, name?: string): PinDef =>
  name ? { id, x, y, name } : { id, x, y };

/** Filled arrow head with its tip at (x, y), pointing towards `angle` (degrees). */
export function arrowHead(
  x: number,
  y: number,
  angle: number,
  size = 0.55,
  filled = true,
): Primitive {
  const a = (angle * Math.PI) / 180;
  const back = size;
  const half = size * 0.42;
  const bx = x - Math.cos(a) * back;
  const by = y - Math.sin(a) * back;
  const nx = -Math.sin(a) * half;
  const ny = Math.cos(a) * half;
  return filled
    ? PC([x, y, bx + nx, by + ny, bx - nx, by - ny], { fill: 'ink', sw: 0.6 })
    : P([bx + nx, by + ny, x, y, bx - nx, by - ny]);
}

/** Line from (x1,y1) to (x2,y2) with an arrow head at the end. */
export function arrow(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  size = 0.55,
  o: StrokeOpts = {},
): Primitive[] {
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  const a = (angle * Math.PI) / 180;
  // Stop the shaft a little before the tip so the line does not poke through the head.
  const sx = x2 - Math.cos(a) * size * 0.6;
  const sy = y2 - Math.sin(a) * size * 0.6;
  return [L(x1, y1, sx, sy, o), arrowHead(x2, y2, angle, size)];
}

/** Sampled sine wave centred on (cx, cy). */
export function sine(cx: number, cy: number, w: number, h: number, periods = 1, n = 32): Primitive {
  const pts: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(cx - w / 2 + t * w, cy - (h / 2) * Math.sin(t * periods * 2 * Math.PI));
  }
  return P(pts);
}

/** Quadratic Bézier sampled into points (without the first point when `skipFirst`). */
export function bez2(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  n = 12,
  skipFirst = false,
): number[] {
  const out: number[] = [];
  for (let i = skipFirst ? 1 : 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push(u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

export interface Xform {
  dx?: number;
  dy?: number;
  /** Rotation in degrees, clockwise on screen. */
  rot?: number;
  /** Mirror along the x axis (x → -x) before rotating. */
  mx?: boolean;
  /** Mirror along the y axis (y → -y) before rotating. */
  my?: boolean;
  scale?: number;
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;

export function xformPoint(x: number, y: number, t: Xform): [number, number] {
  const s = t.scale ?? 1;
  let px = (t.mx ? -x : x) * s;
  let py = (t.my ? -y : y) * s;
  const rot = t.rot ?? 0;
  if (rot) {
    const r = (rot * Math.PI) / 180;
    const c = Math.cos(r);
    const si = Math.sin(r);
    const nx = px * c - py * si;
    const ny = px * si + py * c;
    px = nx;
    py = ny;
  }
  return [round(px + (t.dx ?? 0)), round(py + (t.dy ?? 0))];
}

function xformAngle(a: number, t: Xform): number {
  let out = a;
  if (t.mx) out = 180 - out;
  if (t.my) out = -out;
  return out + (t.rot ?? 0);
}

/** Transform a list of primitives. `path` primitives are only translated/scaled when rot is 0. */
export function tf(prims: Primitive[], t: Xform): Primitive[] {
  const s = t.scale ?? 1;
  const flips = (t.mx ? 1 : 0) + (t.my ? 1 : 0);
  return prims.map((p): Primitive => {
    switch (p.k) {
      case 'line': {
        const [x1, y1] = xformPoint(p.x1, p.y1, t);
        const [x2, y2] = xformPoint(p.x2, p.y2, t);
        return { ...p, x1, y1, x2, y2 };
      }
      case 'poly': {
        const pts: number[] = [];
        for (let i = 0; i < p.pts.length; i += 2) {
          const [x, y] = xformPoint(p.pts[i]!, p.pts[i + 1]!, t);
          pts.push(x, y);
        }
        return { ...p, pts };
      }
      case 'circle': {
        const [cx, cy] = xformPoint(p.cx, p.cy, t);
        return { ...p, cx, cy, r: p.r * s };
      }
      case 'arc': {
        const [cx, cy] = xformPoint(p.cx, p.cy, t);
        let a0 = xformAngle(p.a0, t);
        let a1 = xformAngle(p.a1, t);
        if (flips % 2 === 1) [a0, a1] = [a1, a0];
        return { ...p, cx, cy, r: p.r * s, a0, a1 };
      }
      case 'rect': {
        const rot = (((t.rot ?? 0) % 360) + 360) % 360;
        if (rot % 90 === 0) {
          const [x1, y1] = xformPoint(p.x, p.y, t);
          const [x2, y2] = xformPoint(p.x + p.w, p.y + p.h, t);
          return {
            ...p,
            x: Math.min(x1, x2),
            y: Math.min(y1, y2),
            w: Math.abs(x2 - x1),
            h: Math.abs(y2 - y1),
          };
        }
        const pts = [p.x, p.y, p.x + p.w, p.y, p.x + p.w, p.y + p.h, p.x, p.y + p.h];
        const { k: _k, x: _x, y: _y, w: _w, h: _h, rx: _rx, ...style } = p;
        return tf([PC(pts, style)], t)[0]!;
      }
      case 'text': {
        const [x, y] = xformPoint(p.x, p.y, t);
        let anchor = p.anchor;
        if (t.mx && anchor && anchor !== 'middle') anchor = anchor === 'start' ? 'end' : 'start';
        return {
          ...p,
          x,
          y,
          ...(anchor ? { anchor } : {}),
          ...(p.size ? { size: p.size * s } : {}),
        };
      }
      case 'path':
        return p;
    }
  });
}

export function tfPins(pins: PinDef[], t: Xform): PinDef[] {
  return pins.map((p) => {
    const [x, y] = xformPoint(p.x, p.y, t);
    return { ...p, x, y };
  });
}

// ---------------------------------------------------------------------------
// Element transform (rotation in quarter turns + mirror), shared with the core package
// ---------------------------------------------------------------------------

export type QuarterTurns = 0 | 1 | 2 | 3;

/**
 * Transform a point of a symbol placed with `rot` quarter turns (clockwise) and an optional
 * horizontal mirror. The mirror is applied first, like the SVG transform
 * `rotate(rot*90) scale(-1, 1)`.
 */
export function orient(x: number, y: number, rot: QuarterTurns, mirror: boolean): [number, number] {
  let px = mirror ? -x : x;
  let py = y;
  for (let i = 0; i < rot; i++) {
    const nx = -py;
    py = px;
    px = nx;
  }
  return [px + 0, py + 0];
}

// ---------------------------------------------------------------------------
// Bounding boxes
// ---------------------------------------------------------------------------

export function primsBBox(prims: Primitive[], pins: PinDef[] = []): BBox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  };
  for (const p of prims) {
    switch (p.k) {
      case 'line':
        add(p.x1, p.y1);
        add(p.x2, p.y2);
        break;
      case 'poly':
        for (let i = 0; i < p.pts.length; i += 2) add(p.pts[i]!, p.pts[i + 1]!);
        break;
      case 'circle':
        add(p.cx - p.r, p.cy - p.r);
        add(p.cx + p.r, p.cy + p.r);
        break;
      case 'arc': {
        const steps = Math.max(2, Math.ceil((p.a1 - p.a0) / 15));
        for (let i = 0; i <= steps; i++) {
          const a = ((p.a0 + ((p.a1 - p.a0) * i) / steps) * Math.PI) / 180;
          add(p.cx + p.r * Math.cos(a), p.cy + p.r * Math.sin(a));
        }
        break;
      }
      case 'rect':
        add(p.x, p.y);
        add(p.x + p.w, p.y + p.h);
        break;
      case 'text': {
        const size = p.size ?? 1.2;
        const half = Math.max(0.5, p.t.length * size * 0.25);
        const cx = p.anchor === 'start' ? p.x + half : p.anchor === 'end' ? p.x - half : p.x;
        add(cx - half, p.y - size * 0.6);
        add(cx + half, p.y + size * 0.6);
        break;
      }
      case 'path': {
        const nums = p.d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi)?.map(Number) ?? [];
        // Rough: treat every pair as a point (good enough for arcs/curves bounding estimates).
        for (let i = 0; i + 1 < nums.length; i += 2) add(nums[i]!, nums[i + 1]!);
        break;
      }
    }
  }
  for (const p of pins) add(p.x, p.y);
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
