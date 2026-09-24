import {
  Project,
  elementPins,
  makeContext,
  onSegmentInterior,
  samePt,
  validateHierarchy,
  type WireElement,
} from '@overleagger/core';
import { describe, expect, it } from 'vitest';
import { seedBuckExample } from './buck';
import { TEMPLATES, buildTemplate, templateClip } from './templates';

/** Wire ends that touch nothing (no pin, label or other wire). */
function danglingEnds(p: Project, sheet: string): string[] {
  const ctx = makeContext(p);
  const els = p.getElements(sheet);
  const wires = els.filter((e): e is WireElement => e.type === 'wire');
  const pins = els.flatMap((e) => elementPins(e, ctx));
  const out: string[] = [];
  for (const w of wires) {
    // Signal outputs may end in free space (the arrow points at nothing).
    if (w.kind === 'signal') continue;
    const n = w.pts.length;
    for (const [x, y] of [
      [w.pts[0]!, w.pts[1]!],
      [w.pts[n - 2]!, w.pts[n - 1]!],
    ] as [number, number][]) {
      const onPin = pins.some((q) => samePt(q.x, q.y, x, y));
      const onWire = wires.some((o) => {
        if (o.id === w.id) return false;
        for (let i = 0; i < o.pts.length; i += 2)
          if (samePt(o.pts[i]!, o.pts[i + 1]!, x, y)) return true;
        for (let i = 2; i < o.pts.length; i += 2)
          if (onSegmentInterior(x, y, o.pts[i - 2]!, o.pts[i - 1]!, o.pts[i]!, o.pts[i + 1]!))
            return true;
        return false;
      });
      if (!onPin && !onWire) out.push(`${x},${y}`);
    }
  }
  return out;
}

describe('templates', () => {
  for (const t of TEMPLATES) {
    it(`${t.id} has every wire end connected`, () => {
      const p = Project.create('t');
      buildTemplate(t, p, p.rootSheetId);
      expect(danglingEnds(p, p.rootSheetId)).toEqual([]);
      expect(templateClip(t).elements.length).toBeGreaterThan(3);
    });
  }

  it('the example project is fully connected', () => {
    const p = Project.create('example');
    seedBuckExample(p);
    for (const s of p.listSheets()) expect(danglingEnds(p, s.id), s.name).toEqual([]);
    expect(validateHierarchy(p)).toEqual([]);
  });
});
