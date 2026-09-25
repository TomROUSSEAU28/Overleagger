/**
 * Presentation animations: what every element of a slide looks like at a given click and time.
 *
 * A slide plays its animations in steps: step 0 as the slide opens, then one step per click
 * (the animations of step n start together at the n-th click, each after its own delay). The
 * functions here are pure: the presentation calls `evaluate` on every frame while something
 * moves, and draws the result.
 */
import {
  elementBBox,
  rectsIntersect,
  type Anim,
  type Element,
  type Id,
  type Rect,
  type SheetContext,
} from '@overleagger/core';

/** How an element is drawn on top of its (possibly modified) data. */
export interface ElFx {
  opacity?: number;
  /** CSS transform, around the element's centre. */
  transform?: string;
  /** Wipe: the part shown, from the left (0…1). */
  reveal?: number;
  /** Glow around the element (0…1). */
  glow?: number;
}

/** An outline spreading out around an element (juice when something changes). */
export interface Ring {
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
}

export interface AnimFrame {
  /** The slide's elements, with the changes made by the animations (text, colour, options…). */
  elements: Element[];
  fx: Map<Id, ElFx>;
  rings: Ring[];
  /** Something is still moving: draw again on the next frame. */
  busy: boolean;
}

/** Default durations (ms). */
export const DUR: Record<Anim['kind'], number> = {
  appear: 500,
  disappear: 400,
  emphasis: 700,
  color: 500,
  move: 700,
  set: 300,
  wave: 1500,
  text: 1200,
};

export const APPEAR_EFFECTS = ['fade', 'pop', 'rise', 'zoom', 'wipe'] as const;
export const EMPHASIS_EFFECTS = ['pulse', 'shake', 'glow'] as const;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** Ease out with a small overshoot: the "pop". */
const backOut = (t: number) => {
  const c = 1.9;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};

/** Elements of a slide: those touching the frame (or the whole sheet), frames excepted. */
export function slideElements(all: Element[], rect: Rect | null, ctx: SheetContext): Element[] {
  return all.filter(
    (e) =>
      e.type !== 'frame' &&
      e.type !== 'group' &&
      (!rect || rectsIntersect(rect, elementBBox(e, ctx, all))),
  );
}

/** Click steps of a slide (1, 2… in order; step 0 plays as the slide opens). */
export function slideSteps(elements: Element[]): number[] {
  const set = new Set<number>();
  for (const e of elements) for (const a of e.anims ?? []) if (a.step > 0) set.add(a.step);
  return [...set].sort((a, b) => a - b);
}

/** Field holding the text of an element (for the text animations). */
export function textField(el: Element): 'text' | 'label' | null {
  switch (el.type) {
    case 'text':
    case 'note':
    case 'shape':
    case 'line':
    case 'label':
      return 'text';
    case 'button':
      return 'label';
    default:
      return null;
  }
}

function parseColor(c: string): [number, number, number] | null {
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (h) {
    const v = h[1]!;
    const full = v.length === 3 ? v.replace(/./g, (x) => x + x) : v;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
  }
  const m = /^rgba?\(([^)]+)\)$/i.exec(c.trim());
  if (m) {
    const [r, g, b] = m[1]!.split(',').map((x) => parseFloat(x));
    if ([r, g, b].every((x) => Number.isFinite(x))) return [r!, g!, b!];
  }
  return null;
}

/** Colour between `a` and `b` (CSS colours; others switch half-way). */
export function mixColor(a: string, b: string, k: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return k < 0.5 ? a : b;
  const c = ca.map((v, i) => Math.round(v + (cb[i]! - v) * k));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** Appearance at progress p (0 = hidden, 1 = fully there) for an entrance effect. */
function entrance(effect: string | undefined, p: number, fx: ElFx, t: Transform) {
  if (p >= 1) return;
  const e = easeOut(p);
  switch (effect) {
    case 'pop':
      fx.opacity = clamp01(p * 4);
      t.scale *= 0.3 + 0.7 * backOut(p);
      return;
    case 'rise':
      fx.opacity = e;
      t.y += (1 - e) * 26;
      return;
    case 'zoom':
      fx.opacity = e;
      t.scale *= 0.55 + 0.45 * e;
      return;
    case 'wipe':
      fx.opacity = p > 0 ? 1 : 0;
      fx.reveal = easeInOut(p);
      return;
    default:
      fx.opacity = e;
  }
}

interface Transform {
  x: number;
  y: number;
  scale: number;
  rot: number;
}

export interface Clock {
  /** Steps reached on the slide (0 always, then the clicked ones). */
  reached: number;
  /** When each step started (ms, same clock as `now`); missing = long ago (no animation). */
  started: Map<number, number>;
  now: number;
}

/**
 * The slide at a given moment. `resolve` turns a stored colour ('@red', '#123456', none) into a
 * CSS colour for the current theme; `box` gives the bounding box of an element (for the rings).
 */
export function evaluate(
  elements: Element[],
  clock: Clock,
  resolve: (c: string | undefined) => string,
  box: (el: Element) => Rect,
): AnimFrame {
  const fx = new Map<Id, ElFx>();
  const rings: Ring[] = [];
  let busy = false;
  const out = elements.map((orig) => {
    const anims = orig.anims;
    if (!anims?.length) return orig;
    let el: Element = orig;
    const f: ElFx = {};
    const tr: Transform = { x: 0, y: 0, scale: 1, rot: 0 };
    const sorted = anims
      .map((a, i) => ({ a, i }))
      .sort((x, y) => x.a.step - y.a.step || x.i - y.i)
      .map((x) => x.a);
    // Shown from the start unless its first coming / going is an entrance.
    const firstVis = sorted.find((a) => a.kind === 'appear' || a.kind === 'disappear');
    let shown = firstVis?.kind === 'appear' ? 0 : 1;
    let color: string | undefined;
    const tf = textField(el);
    for (const a of sorted) {
      const reached = a.step <= clock.reached;
      const dur = Math.max(1, a.dur ?? DUR[a.kind]);
      const start = clock.started.get(a.step);
      const t = start === undefined ? Infinity : clock.now - start - (a.delay ?? 0);
      const p = reached ? clamp01(t / dur) : 0;
      if (reached && t < dur) busy = true;
      if (!reached) {
        // Before its turn, a typed text is not there yet.
        const typing = a.kind === 'text' && (a.effect === 'typewriter' || !a.text);
        if (typing && tf && a === sorted.find((x) => x.kind === 'text'))
          el = { ...el, [tf]: '' } as Element;
        continue;
      }
      if (t < 0 && a.kind !== 'wave') {
        // Waiting (its delay, or the slide still arriving): an entrance keeps it hidden, a text
        // to type is not there yet, the rest has not happened yet.
        if (a.kind === 'appear') shown = 0;
        if (a.kind === 'text' && tf && (a.effect === 'typewriter' || !a.text))
          el = { ...el, [tf]: '' } as Element;
        continue;
      }
      switch (a.kind) {
        case 'appear': {
          shown = 1;
          const g: ElFx = {};
          entrance(a.effect, p, g, tr);
          if (g.opacity !== undefined) f.opacity = g.opacity;
          if (g.reveal !== undefined) f.reveal = g.reveal;
          if (a.effect === 'pop' && p < 1) ring(el, p, box, rings);
          break;
        }
        case 'disappear': {
          const g: ElFx = {};
          entrance(a.effect, 1 - p, g, tr);
          shown = p >= 1 ? 0 : 1;
          if (g.opacity !== undefined) f.opacity = g.opacity;
          if (g.reveal !== undefined) f.reveal = g.reveal;
          break;
        }
        case 'emphasis':
          if (p < 1) {
            const s = Math.sin(Math.PI * p);
            if (a.effect === 'shake') tr.x += Math.sin(p * Math.PI * 8) * 5 * (1 - p);
            else if (a.effect === 'glow') f.glow = s;
            else {
              tr.scale *= 1 + 0.14 * s;
              if (p < 0.6) ring(el, p / 0.6, box, rings);
            }
          }
          break;
        case 'color': {
          const from = color ?? resolve(el.style?.color);
          color = mixColor(from, resolve(a.color), easeInOut(p));
          break;
        }
        case 'move':
          tr.x += (a.dx ?? 0) * easeInOut(p);
          tr.y += (a.dy ?? 0) * easeInOut(p);
          break;
        case 'set':
          if (el.type === 'component' && a.opts) {
            el = { ...el, opts: { ...el.opts, ...a.opts } };
            if (p < 1) {
              tr.scale *= 1 + 0.1 * Math.sin(Math.PI * p);
              ring(el, p, box, rings);
            }
          }
          break;
        case 'wave':
          if (el.type === 'waveform' && a.key) {
            const from = a.from ?? 0;
            const to = a.to ?? 1;
            let v: number;
            if (a.loop) {
              busy = true;
              // (Played long ago: keep going on the presentation's clock.)
              const tl = t === Infinity ? clock.now : t;
              const k = tl < 0 ? 0 : 0.5 - 0.5 * Math.cos((Math.PI * tl) / dur);
              v = from + (to - from) * k;
            } else v = from + (to - from) * easeInOut(t < 0 ? 0 : p);
            const key = a.key;
            const id = a.trace ?? el.traces[0]?.id;
            el = {
              ...el,
              traces: el.traces.map((tr) => (tr.id === id ? { ...tr, [key]: v } : tr)),
            };
          }
          break;
        case 'text':
          if (tf) {
            const cur = String((el as unknown as Record<string, unknown>)[tf] ?? '');
            if (a.text !== undefined && a.text !== '' && a.effect !== 'typewriter') {
              // Replaced: a quick dip in and out while it changes.
              el = { ...el, [tf]: p < 0.5 && t < dur ? cur : a.text } as Element;
              if (p < 1) f.opacity = Math.min(f.opacity ?? 1, Math.abs(1 - 2 * p) * 0.8 + 0.2);
            } else {
              const full = a.text || cur;
              el = { ...el, [tf]: typed(full, p) } as Element;
            }
          }
          break;
      }
    }
    if (color) el = { ...el, style: { ...el.style, color } } as Element;
    if (!shown) f.opacity = 0;
    if (tr.x || tr.y || tr.scale !== 1 || tr.rot)
      f.transform = `translate(${tr.x}px, ${tr.y}px) scale(${tr.scale}) rotate(${tr.rot}deg)`;
    if (Object.keys(f).length) fx.set(el.id, f);
    return el;
  });
  if (rings.length) busy = true;
  return { elements: out, fx, rings, busy };
}

/** The first part of a text, typed at progress p (LaTeX `$…$` groups appear whole). */
export function typed(full: string, p: number): string {
  if (p >= 1) return full;
  // Split into characters, keeping each $…$ formula as one piece (half a formula cannot render).
  const parts = full.match(/\$[^$]*\$|[\s\S]/g) ?? [];
  const n = Math.round(parts.length * p);
  return parts.slice(0, n).join('');
}

function ring(el: Element, p: number, box: (el: Element) => Rect, rings: Ring[]) {
  const b = box(el);
  const k = easeOut(clamp01(p));
  const pad = 3 + 16 * k;
  rings.push({
    x: b.x - pad,
    y: b.y - pad,
    w: b.w + 2 * pad,
    h: b.h + 2 * pad,
    opacity: 0.85 * (1 - k),
  });
}
