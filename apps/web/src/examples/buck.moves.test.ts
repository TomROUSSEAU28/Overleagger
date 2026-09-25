/**
 * Moving anything in the example (a part, a wire, a group, one segment) must not disconnect
 * what was connected: wires stretch, junctions follow.
 */
import {
  Project,
  analyzeConnectivity,
  computeMove,
  computeSegmentDrag,
  elementBBox,
  expandSelection,
  makeContext,
  rectContains,
  type Element,
} from '@overleagger/core';
import { expect, it } from 'vitest';
import { seedBuckExample } from './buck';

/** Pairs of pins connected together. */
function pairs(els: Element[], ctx: ReturnType<typeof makeContext>): Set<string> {
  const c = analyzeConnectivity(els, ctx);
  const groups = new Map<number, string[]>();
  for (const [k, n] of c.netOf) {
    if (!k.includes(':')) continue;
    const g = groups.get(n) ?? [];
    g.push(k);
    groups.set(n, g);
  }
  const out = new Set<string>();
  for (const g of groups.values())
    for (const a of g) for (const b of g) if (a < b) out.add(`${a}~${b}`);
  return out;
}
/** Connections lost (new ones are fine: things can land on each other). */
function lost(before: Set<string>, els: Element[], ctx: ReturnType<typeof makeContext>): string[] {
  const after = pairs(els, ctx);
  return [...before].filter((x) => !after.has(x));
}

const apply = (els: Element[], changed: Element[]) => {
  const m = new Map(changed.map((e) => [e.id, e]));
  return els.map((e) => m.get(e.id) ?? e);
};

for (const sub of [false, true])
  it(`moves keep the connections of the example (${sub ? 'controller' : 'power stage'})`, () => {
    const p = Project.create('t');
    seedBuckExample(p);
    const ctx = makeContext(p);
    const sheet = sub ? p.listSheets()[1]!.id : p.rootSheetId;
    const els = p.getElements(sheet);
    const before = pairs(els, ctx);
    const names = new Map(els.map((e) => [e.id, 'ref' in e && e.ref ? e.ref : e.type]));
    const show = (l: string[]) =>
      l
        .slice(0, 2)
        .map((x) => x.replace(/[a-z0-9]{12}/g, (id) => names.get(id) ?? id))
        .join(' ; ');
    const problems: string[] = [];
    const moves: [number, number][] = [
      [20, 0],
      [0, 20],
      [40, -30],
      [-30, 50],
      [100, 0],
      [0, -60],
      [-70, -40],
      [10, 10],
    ];
    // Every element alone.
    for (const e of els) {
      if (e.type === 'group' || e.type === 'frame' || e.type === 'label') continue;
      for (const [dx, dy] of moves) {
        const l = lost(before, apply(els, computeMove(els, new Set([e.id]), dx, dy, ctx)), ctx);
        if (l.length)
          problems.push(`${e.type} ${'ref' in e ? e.ref : e.id} by ${dx},${dy}: ${show(l)}`);
      }
    }
    // Marquee-like groups: everything inside a box.
    const boxes = [
      { x: 100, y: 0, w: 200, h: 220 },
      { x: 200, y: 50, w: 260, h: 160 },
      { x: -20, y: 0, w: 200, h: 200 },
      { x: 280, y: 80, w: 200, h: 120 },
    ];
    for (const r of boxes) {
      const ids = els
        .filter(
          (e) =>
            e.type !== 'group' && e.type !== 'frame' && rectContains(r, elementBBox(e, ctx, els)),
        )
        .map((e) => e.id);
      const set = expandSelection(els, ids);
      for (const [dx, dy] of moves) {
        const l = lost(before, apply(els, computeMove(els, set, dx, dy, ctx)), ctx);
        if (l.length)
          problems.push(`box ${JSON.stringify(r)} (${ids.length}) by ${dx},${dy}: ${show(l)}`);
      }
    }
    // Every segment of every wire.
    for (const w of els) {
      if (w.type !== 'wire') continue;
      for (let i = 0; i + 3 < w.pts.length; i += 2)
        for (const [dx, dy] of moves) {
          const l = lost(
            before,
            apply(els, computeSegmentDrag(els, w.id, i / 2, dx, dy, ctx)),
            ctx,
          );
          if (l.length)
            problems.push(`segment ${i / 2} of wire ${w.pts.join(',')} by ${dx},${dy}: ${show(l)}`);
        }
    }
    expect(problems).toEqual([]);
  });
