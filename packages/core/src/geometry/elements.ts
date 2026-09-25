import { linePoints } from './connectors';
import {
  getBuiltinSymbol,
  orient,
  resolveSymbol,
  type AnySymbol,
  type ResolvedSymbol,
  type Standard,
} from '@overleagger/symbols';
import type {
  BlockElement,
  ComponentElement,
  Element,
  Id,
  LabelElement,
  PortElement,
  Pt,
  Rect,
  Side,
  TextElement,
} from '../model/types';
import { GRID } from '../model/types';
import type { Project } from '../model/project';
import { ptsBBox, rectUnion, snap } from './geom';

/** Everything geometry helpers need to know about the surrounding project. */
export interface SheetContext {
  standard: Standard;
  symbol(id: string): AnySymbol | undefined;
  /** Port elements of a (child) sheet. */
  ports(sheetId: Id): PortElement[];
  /** False for a sheet hidden from the user (default: every sheet is visible). */
  canRead?(sheetId: Id): boolean;
}

/**
 * Context reading live project data: it stays valid (same identity) while the project changes,
 * which lets UI code memoize on it.
 */
export function makeContext(project: Project): SheetContext {
  return {
    get standard() {
      return project.getMeta().standard;
    },
    symbol: (id) => getBuiltinSymbol(id) ?? project.symbols.get(id),
    ports: (sheetId) => project.sheetPorts(sheetId),
    canRead: (sheetId) => project.canRead(sheetId),
  };
}

export interface WorldPin {
  elId: Id;
  pinId: string;
  name?: string;
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** Size factors that keep every pin of the symbol on the grid. */
export function allowedScales(r: ResolvedSymbol): number[] {
  const onGrid = (v: number) => Math.abs(v - Math.round(v)) < 1e-6;
  return [1, 1.5, 2, 3].filter((s) => r.pins.every((p) => onGrid(p.x * s) && onGrid(p.y * s)));
}

export function resolveComponent(
  el: ComponentElement,
  ctx: SheetContext,
): ResolvedSymbol | undefined {
  const sym = ctx.symbol(el.symbolId);
  if (!sym) return undefined;
  return resolveSymbol(sym, el.standard ?? ctx.standard, el.opts);
}

/** Symbol point (grid units) → world point (px) for a placed component. */
export function componentPoint(
  el: Pick<ComponentElement, 'x' | 'y' | 'rot' | 'mirror' | 'scale'>,
  gx: number,
  gy: number,
): Pt {
  const s = GRID * (el.scale ?? 1);
  const [x, y] = orient(gx * s, gy * s, el.rot, el.mirror);
  return { x: x + el.x, y: y + el.y };
}

export function componentBBox(el: ComponentElement, ctx: SheetContext): Rect {
  const r = resolveComponent(el, ctx);
  if (!r) return { x: el.x - 10, y: el.y - 10, w: 20, h: 20 };
  const b = r.bbox;
  const a = componentPoint(el, b.x, b.y);
  const c = componentPoint(el, b.x + b.w, b.y + b.h);
  return {
    x: Math.min(a.x, c.x),
    y: Math.min(a.y, c.y),
    w: Math.abs(a.x - c.x),
    h: Math.abs(a.y - c.y),
  };
}

export interface LabelLine {
  text: string;
  kind: 'ref' | 'value';
}

export interface LabelLayout {
  lines: LabelLine[];
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  lineHeight: number;
}

const SIDES_CW: Side[] = ['t', 'r', 'b', 'l'];
const turn = (s: Side, n: number) => SIDES_CW[(SIDES_CW.indexOf(s) + n + 8) % 4]!;
const OPPOSITE: Record<Side, Side> = { t: 'b', b: 't', l: 'r', r: 'l' };

/**
 * Side of the reference / value labels, attached to the symbol like in LTspice: turning a part
 * by 180° (or mirroring it) moves its label to the opposite side.
 *
 * Tall symbols (sources, MOSFETs…) have their label on the right; turned a quarter it goes on
 * top, then left, then below. Wide symbols (resistors…) have it on top; a quarter turn puts it on
 * the right, then below, then left. So the first rotation always gives the usual place.
 */
export function labelSide(
  el: Pick<ComponentElement, 'rot' | 'mirror'>,
  local: { w: number; h: number },
): Side {
  const tall = local.h > local.w * 1.15;
  if (tall) return turn(el.mirror ? 'l' : 'r', -el.rot);
  return turn('t', el.rot);
}

export const LABEL_SIZE = 12;

/** Automatic placement of the reference / value labels next to a component. */
export function componentLabels(el: ComponentElement, ctx: SheetContext): LabelLayout | undefined {
  const sym = ctx.symbol(el.symbolId);
  const lines: LabelLine[] = [];
  if (sym?.refPrefix && el.showRef !== false && el.ref) lines.push({ text: el.ref, kind: 'ref' });
  const value = el.params.value ?? '';
  if (!sym?.hideValueLabel && el.showValue !== false && value)
    lines.push({ text: value, kind: 'value' });
  if (lines.length === 0) return undefined;
  const b = componentBBox(el, ctx);
  const lineHeight = LABEL_SIZE * 1.25;
  const textW = Math.max(...lines.map((l) => textWidth(l.text, LABEL_SIZE))) + 4;
  const textH = lines.length * lineHeight;
  const pins = elementPins(el, ctx);
  // A pin on the side of the label means a wire leaves there: avoid covering it.
  const blocked = (side: 'r' | 'l' | 't' | 'b', y0: number, y1: number, x0: number, x1: number) =>
    pins.some((p) => {
      if (side === 'r') return p.x >= b.x + b.w - 0.5 && p.y > y0 - 4 && p.y < y1 + 4;
      if (side === 'l') return p.x <= b.x + 0.5 && p.y > y0 - 4 && p.y < y1 + 4;
      if (side === 't') return p.y <= b.y + 0.5 && p.x > x0 - 4 && p.x < x1 + 4;
      return p.y >= b.y + b.h - 0.5 && p.x > x0 - 4 && p.x < x1 + 4;
    });
  const side = (anchorX: number, yTop: number, anchor: LabelLayout['anchor']): LabelLayout => ({
    lines,
    x: anchorX,
    y: yTop + lineHeight / 2,
    anchor,
    lineHeight,
  });
  const cy = b.y + b.h / 2;
  type Candidate = {
    s: Side;
    layout: LabelLayout;
    y0: number;
    y1: number;
    x0: number;
    x1: number;
  };
  const right = (yTop: number): Candidate => ({
    s: 'r',
    layout: side(b.x + b.w + 6, yTop, 'start'),
    y0: yTop,
    y1: yTop + textH,
    x0: 0,
    x1: 0,
  });
  const left = (yTop: number): Candidate => ({
    s: 'l',
    layout: side(b.x - 6, yTop, 'end'),
    y0: yTop,
    y1: yTop + textH,
    x0: 0,
    x1: 0,
  });
  const top = (): Candidate => ({
    s: 't',
    layout: side(b.x + b.w / 2, b.y - 6 - textH, 'middle'),
    y0: 0,
    y1: 0,
    x0: b.x + b.w / 2 - textW / 2,
    x1: b.x + b.w / 2 + textW / 2,
  });
  const bottom = (): Candidate => ({
    s: 'b',
    layout: side(b.x + b.w / 2, b.y + b.h + 6, 'middle'),
    y0: 0,
    y1: 0,
    x0: b.x + b.w / 2 - textW / 2,
    x1: b.x + b.w / 2 + textW / 2,
  });
  const onSide = (s: Side): Candidate[] =>
    s === 't'
      ? [top()]
      : s === 'b'
        ? [bottom()]
        : [cy - textH / 2, b.y, b.y + b.h - textH].map((y) => (s === 'r' ? right(y) : left(y)));
  const r = resolveComponent(el, ctx);
  const pref = labelSide(el, r ? r.bbox : { w: b.w, h: b.h });
  // Preferred side, else the opposite one (keeps the 180° symmetry), else the other two.
  const others = SIDES_CW.filter((s) => s !== pref && s !== OPPOSITE[pref]);
  const candidates = [pref, OPPOSITE[pref], ...others].flatMap(onSide);
  const ok = candidates.find((c) => !blocked(c.s, c.y0, c.y1, c.x0, c.x1));
  return (ok ?? candidates[0]!).layout;
}

// ---------------------------------------------------------------------------
// Blocks & ports (hierarchy)
// ---------------------------------------------------------------------------

export const PIN_PITCH = 20;

export interface BlockPin {
  portId: Id;
  name: string;
  side: Side;
  x: number;
  y: number;
  dir: PortElement['dir'];
}

export interface BlockLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  pins: BlockPin[];
}

export function portSide(p: PortElement): Side {
  return p.side ?? (p.dir === 'in' ? 'l' : 'r');
}

/** Compute the size and pin positions of a hierarchical block from its child sheet's ports. */
export function blockLayout(b: BlockElement, ports: PortElement[]): BlockLayout {
  const bySide: Record<Side, PortElement[]> = { l: [], r: [], t: [], b: [] };
  for (const p of ports) bySide[portSide(p)].push(p);
  const vert = (a: PortElement, c: PortElement) =>
    a.y - c.y || a.x - c.x || a.name.localeCompare(c.name);
  const horiz = (a: PortElement, c: PortElement) =>
    a.x - c.x || a.y - c.y || a.name.localeCompare(c.name);
  bySide.l.sort(vert);
  bySide.r.sort(vert);
  bySide.t.sort(horiz);
  bySide.b.sort(horiz);
  const nLR = Math.max(bySide.l.length, bySide.r.length);
  const nTB = Math.max(bySide.t.length, bySide.b.length);
  const h = Math.max(b.h, (nLR + 1) * PIN_PITCH);
  const w = Math.max(b.w, (nTB + 1) * PIN_PITCH);
  const start = (len: number, n: number) => snap((len - (n - 1) * PIN_PITCH) / 2, GRID);
  const pins: BlockPin[] = [];
  const push = (list: PortElement[], side: Side) => {
    const len = side === 'l' || side === 'r' ? h : w;
    const s0 = start(len, list.length);
    list.forEach((p, i) => {
      const off = s0 + i * PIN_PITCH;
      const x = side === 'l' ? b.x : side === 'r' ? b.x + w : b.x + off;
      const y = side === 't' ? b.y : side === 'b' ? b.y + h : b.y + off;
      pins.push({ portId: p.id, name: p.name, side, x, y, dir: p.dir });
    });
  };
  push(bySide.l, 'l');
  push(bySide.r, 'r');
  push(bySide.t, 't');
  push(bySide.b, 'b');
  return { x: b.x, y: b.y, w, h, pins };
}

export const PORT_HALF_H = 7;

/** Approximate visible length of a string that may contain `$…$` LaTeX. */
export function visibleLength(text: string): number {
  return text.replace(/\\[a-zA-Z]+/g, 'x').replace(/[${}_^\\]/g, '').length;
}

export function textWidth(text: string, size: number): number {
  return visibleLength(text) * size * 0.56;
}

/** Outline polygon (flat points) of a port shape. */
export function portShape(p: PortElement): number[] {
  const L = Math.max(40, snap(textWidth(p.name, 12) + 22, GRID));
  const h = PORT_HALF_H;
  const left = (p.dir !== 'out') !== Boolean(p.flip); // shape extends to the left of the pin
  const { x, y } = p;
  if (p.dir === 'io') {
    return left
      ? [x, y, x - 7, y - h, x - L + 7, y - h, x - L, y, x - L + 7, y + h, x - 7, y + h]
      : [x, y, x + 7, y - h, x + L - 7, y - h, x + L, y, x + L - 7, y + h, x + 7, y + h];
  }
  // Arrow pointing right for inputs (into the sheet), right for outputs (out of the sheet).
  if (left) return [x - L, y - h, x - 8, y - h, x, y, x - 8, y + h, x - L, y + h];
  return [x, y - h, x + L - 8, y - h, x + L, y, x + L - 8, y + h, x, y + h];
}

export function portTextPos(p: PortElement): { x: number; y: number } {
  const b = ptsBBox(portShape(p));
  return { x: b.x + b.w / 2, y: p.y };
}

// ---------------------------------------------------------------------------
// Generic element helpers
// ---------------------------------------------------------------------------

export function elementPins(el: Element, ctx: SheetContext): WorldPin[] {
  switch (el.type) {
    case 'component': {
      const r = resolveComponent(el, ctx);
      if (!r) return [];
      return r.pins.map((p) => {
        const w = componentPoint(el, p.x, p.y);
        return p.name
          ? { elId: el.id, pinId: p.id, name: p.name, x: w.x, y: w.y }
          : { elId: el.id, pinId: p.id, x: w.x, y: w.y };
      });
    }
    case 'block':
      return blockLayout(el, ctx.ports(el.childSheetId)).pins.map((p) => ({
        elId: el.id,
        pinId: p.portId,
        name: p.name,
        x: p.x,
        y: p.y,
      }));
    case 'port':
    case 'label':
      return [{ elId: el.id, pinId: 'p', x: el.x, y: el.y }];
    default:
      return [];
  }
}

function labelBBox(el: LabelElement): Rect {
  const w = Math.max(20, textWidth(el.text, 12) + 6);
  return { x: el.flip ? el.x - w : el.x, y: el.y - 16, w, h: 16 };
}

export function textBBox(el: TextElement): Rect {
  const lines = el.text.split('\n');
  const w = Math.max(10, ...lines.map((l) => textWidth(l.replace(/\$/g, ''), el.size)));
  const h = lines.length * el.size * 1.3;
  const x = el.align === 'middle' ? el.x - w / 2 : el.align === 'end' ? el.x - w : el.x;
  return { x, y: el.y - el.size * 0.9, w, h };
}

/**
 * Bounding box in px. Groups need the other elements of the sheet (`all`) to compute their extent.
 */
export function elementBBox(el: Element, ctx: SheetContext, all?: Element[]): Rect {
  switch (el.type) {
    case 'component': {
      const b = componentBBox(el, ctx);
      const l = componentLabels(el, ctx);
      if (!l) return b;
      const w = Math.max(...l.lines.map((x) => textWidth(x.text, LABEL_SIZE))) + 4;
      const top = l.y - l.lineHeight / 2;
      const left = l.anchor === 'middle' ? l.x - w / 2 : l.anchor === 'end' ? l.x - w : l.x;
      return rectUnion([b, { x: left, y: top, w, h: l.lines.length * l.lineHeight }])!;
    }
    case 'wire':
      return ptsBBox(el.pts);
    case 'block': {
      const l = blockLayout(el, ctx.ports(el.childSheetId));
      return { x: l.x, y: l.y, w: l.w, h: l.h };
    }
    case 'port':
      return ptsBBox(portShape(el));
    case 'label':
      return labelBBox(el);
    case 'text': {
      const b = textBBox(el);
      return el.frame ? inflateRect(b, TEXT_FRAME_PAD) : b;
    }
    case 'shape':
    case 'image':
    case 'note':
    case 'button':
    case 'waveform':
    case 'frame':
      return { x: el.x, y: el.y, w: el.w, h: el.h };
    case 'line': {
      const pad = el.arrowStart || el.arrowEnd ? 6 : 2;
      if (el.route === 'elbow') return inflateRect(ptsBBox(linePoints(el).flat()), pad);
      const b = ptsBBox(el.pts);
      const c = lineControlPoint(el.pts, el.bend ?? 0);
      return inflateRect(rectUnion([b, { x: c.x, y: c.y, w: 0, h: 0 }])!, pad);
    }
    case 'flow':
      return inflateRect(ptsBBox(el.pts), (el.size ?? 12) / 2 + 3);
    case 'stroke': {
      const xy: number[] = [];
      for (let i = 0; i < el.pts.length; i += 3) xy.push(el.pts[i]!, el.pts[i + 1]!);
      return inflateRect(ptsBBox(xy), el.size / 2 + 1);
    }
    case 'group': {
      const members = (all ?? []).filter((e) => isInGroup(e, el.id, all ?? []));
      return (
        rectUnion(
          members.filter((m) => m.type !== 'group').map((m) => elementBBox(m, ctx, all)),
        ) ?? { x: 0, y: 0, w: 0, h: 0 }
      );
    }
  }
}

export const TEXT_FRAME_PAD = 6;

const inflateRect = (r: Rect, d: number): Rect => ({
  x: r.x - d,
  y: r.y - d,
  w: r.w + 2 * d,
  h: r.h + 2 * d,
});

/**
 * Control point of a curved line: the quadratic curve passes through the middle offset by
 * `bend` px perpendicular to the chord (so the control point is at twice that offset).
 */
export function lineControlPoint(pts: number[], bend: number): Pt {
  const [x1, y1, x2, y2] = pts as [number, number, number, number];
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const nx = -(y2 - y1) / len;
  const ny = (x2 - x1) / len;
  return { x: mx + nx * bend * 2, y: my + ny * bend * 2 };
}

/** True if `el` is (directly or indirectly) a member of group `groupId`. */
export function isInGroup(el: Element, groupId: Id, all: Element[]): boolean {
  let g = el.groupId;
  const seen = new Set<Id>();
  while (g && !seen.has(g)) {
    if (g === groupId) return true;
    seen.add(g);
    g = all.find((e) => e.id === g)?.groupId;
  }
  return false;
}
