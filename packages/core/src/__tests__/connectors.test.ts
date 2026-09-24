import { describe, expect, it } from 'vitest';
import {
  Project,
  anchorPoints,
  computeMove,
  elbowRoute,
  followConnectors,
  makeContext,
  nearestAnchor,
  shapeGeometry,
  type LineElement,
  type ShapeElement,
  type ShapeKind,
} from '../index';

const box = (kind: ShapeKind, x: number, y: number): ShapeElement =>
  ({ id: kind + x, type: 'shape', z: 1, kind, x, y, w: 120, h: 60 }) as ShapeElement;

describe('flowchart connectors', () => {
  it('has connection points on the outline of every shape kind', () => {
    const kinds: ShapeKind[] = [
      'rect',
      'ellipse',
      'diamond',
      'triangle',
      'terminator',
      'data',
      'document',
      'predefined',
      'database',
      'manual-input',
      'preparation',
      'delay',
      'offpage',
      'manual-op',
    ];
    for (const k of kinds) {
      const g = shapeGeometry(box(k, 0, 0));
      expect(g.outline.length, k).toBeGreaterThan(2);
      const a = anchorPoints(box(k, 0, 0))!;
      // Top and bottom points on the vertical axis, left/right on the horizontal one.
      expect(a.n.x, k).toBeCloseTo(60);
      expect(a.s.x, k).toBeCloseTo(60);
      // (the wavy bottom of a document moves its middle up a little)
      expect(Math.abs(a.w.y - 30), k).toBeLessThan(k === 'document' ? 3 : 0.01);
    }
    // A diamond's side points are its corners; a parallelogram's are inside the box.
    expect(anchorPoints(box('diamond', 0, 0))!.e).toEqual({ x: 120, y: 30 });
    expect(anchorPoints(box('data', 0, 0))!.w.x).toBeGreaterThan(0);
    expect(nearestAnchor(box('rect', 0, 0), { x: 118, y: 35 })!.anchor).toBe('e');
  });

  it('routes elbows with right angles only', () => {
    const r = elbowRoute({ x: 0, y: 0 }, 's', { x: 100, y: 120 }, 'n');
    for (let i = 1; i < r.length; i++)
      expect(r[i]![0] === r[i - 1]![0] || r[i]![1] === r[i - 1]![1]).toBe(true);
    expect(r[0]).toEqual([0, 0]);
    expect(r[r.length - 1]).toEqual([100, 120]);
    // Aligned shapes: one straight segment.
    expect(elbowRoute({ x: 0, y: 0 }, 's', { x: 0, y: 100 }, 'n')).toHaveLength(2);
  });

  it('keeps attached connectors on their shapes when the shapes move', () => {
    const p = Project.create('flow');
    const s = p.rootSheetId;
    const a = p.addElement(s, { type: 'shape', kind: 'terminator', x: 0, y: 0, w: 120, h: 60 });
    const b = p.addElement(s, { type: 'shape', kind: 'rect', x: 0, y: 200, w: 120, h: 60 });
    const pa = anchorPoints(a)!.s;
    const pb = anchorPoints(b)!.n;
    const line = p.addElement(s, {
      type: 'line',
      pts: [pa.x, pa.y, pb.x, pb.y],
      route: 'elbow',
      from: { id: a.id, anchor: 's' },
      to: { id: b.id, anchor: 'n' },
    }) as LineElement;
    const els = p.getElements(s);
    const moved = computeMove(els, new Set([b.id]), 100, 40, makeContext(p));
    const l = moved.find((e) => e.id === line.id) as LineElement;
    expect(l.pts).toEqual([pa.x, pa.y, pb.x + 100, pb.y + 40]);
    // Resizing (any change) works the same way.
    const bigger = { ...b, w: 200 } as ShapeElement;
    const [f] = followConnectors(els, [bigger]);
    expect(f!.pts[2]).toBe(100);
    // Moving the connector alone detaches it.
    const alone = computeMove(els, new Set([line.id]), 10, 0, makeContext(p))[0] as LineElement;
    expect(alone.from).toBeUndefined();
    expect(alone.to).toBeUndefined();
  });
});
