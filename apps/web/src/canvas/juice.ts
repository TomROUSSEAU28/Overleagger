/**
 * Small feedback animations ("juice"): parts pop in when placed, settle when dropped, fade out
 * when deleted; ripples mark placements and new connections.
 *
 * Everything runs with the Web Animations API on the rendered SVG nodes (found by `data-id`)
 * or on throw-away nodes inside the canvas FX layer, so React's tree and the document are never
 * touched. Animations are short (≤ 450 ms), and off when the user disabled them or asked the
 * system for reduced motion.
 */
import { useUI } from '../store/ui';

const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
/** Slight overshoot, like a part snapping into place. */
const EASE_BACK = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const SVG_NS = 'http://www.w3.org/2000/svg';

export function motionEnabled(): boolean {
  if (!useUI.getState().animations) return false;
  if (typeof window === 'undefined' || typeof Element.prototype.animate !== 'function')
    return false;
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

const canvas = () => document.querySelector<SVGSVGElement>('svg.canvas');
const fxLayer = () => canvas()?.querySelector<SVGGElement>('g.fx-layer') ?? null;

function nodesOf(ids: Iterable<string>): SVGGElement[] {
  const svg = canvas();
  if (!svg) return [];
  const out: SVGGElement[] = [];
  for (const id of ids) {
    const n = svg.querySelector<SVGGElement>(`.sheet [data-id="${CSS.escape(id)}"]`);
    if (n) out.push(n);
  }
  return out;
}

/** Run after React has rendered the latest document change. */
const afterRender = (fn: () => void) => requestAnimationFrame(() => requestAnimationFrame(fn));

/** New elements grow in from their centre (wires and big frames only fade in). */
export function popIn(ids: string[], stagger = 0) {
  if (!motionEnabled() || !ids.length) return;
  afterRender(() => {
    const nodes = nodesOf(ids);
    const step = nodes.length > 1 ? Math.min(stagger, 260 / nodes.length) : 0;
    nodes.forEach((n, i) => {
      const flat = n.classList.contains('wire') || n.classList.contains('frame');
      n.animate(
        flat
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { opacity: 0, transform: 'scale(0.86)' },
              { opacity: 1, transform: 'scale(1.03)', offset: 0.65 },
              { opacity: 1, transform: 'scale(1)' },
            ],
        {
          duration: flat ? 200 : 280,
          delay: i * step,
          easing: flat ? EASE_OUT : 'ease-out',
          fill: 'backwards',
        },
      );
    });
  });
}

/** Dropped elements settle with a tiny bounce. */
export function settle(ids: string[]) {
  if (!motionEnabled() || !ids.length) return;
  afterRender(() => {
    for (const n of nodesOf(ids)) {
      if (n.classList.contains('wire')) continue;
      n.animate([{ transform: 'scale(1.035)' }, { transform: 'scale(1)' }], {
        duration: 220,
        easing: EASE_BACK,
      });
    }
  });
}

/** Deleted elements leave a fading ghost (a copy drawn in the FX layer). */
export function vanish(ids: string[]) {
  if (!motionEnabled() || !ids.length) return;
  const layer = fxLayer();
  if (!layer) return;
  for (const n of nodesOf(ids).slice(0, 60)) {
    const ghost = n.cloneNode(true) as SVGGElement;
    ghost.removeAttribute('data-id');
    ghost.querySelectorAll('[data-id]').forEach((c) => c.removeAttribute('data-id'));
    layer.appendChild(ghost);
    ghost
      .animate(
        [
          { opacity: 0.9, transform: 'scale(1)' },
          { opacity: 0, transform: 'scale(0.92)' },
        ],
        { duration: 200, easing: 'ease-in', fill: 'forwards' },
      )
      .finished.then(
        () => ghost.remove(),
        () => ghost.remove(),
      );
  }
}

/**
 * A ring spreading from a point: `place` in graphite when a part is put down, `connect` in the
 * selection blue when a wire lands on a pin.
 */
export function ripple(x: number, y: number, kind: 'place' | 'connect' = 'place', size = 1) {
  if (!motionEnabled()) return;
  const layer = fxLayer();
  if (!layer) return;
  const r = (kind === 'connect' ? 9 : 22) * size;
  const c = document.createElementNS(SVG_NS, 'circle');
  c.setAttribute('cx', String(x));
  c.setAttribute('cy', String(y));
  c.setAttribute('r', String(r));
  c.setAttribute('class', `fx-ripple ${kind}`);
  layer.appendChild(c);
  c.animate(
    [
      { transform: 'scale(0.05)', opacity: 0.8 },
      { transform: 'scale(1)', opacity: 0 },
    ],
    { duration: kind === 'connect' ? 320 : 450, easing: EASE_OUT, fill: 'forwards' },
  ).finished.then(
    () => c.remove(),
    () => c.remove(),
  );
}
