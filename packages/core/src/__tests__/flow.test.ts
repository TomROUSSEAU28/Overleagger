import { describe, expect, it } from 'vitest';
import {
  Project,
  addComponent,
  flowCurrent,
  flowPathFromSelection,
  flowPositions,
  flowSignal,
  flowVelocity,
  makeContext,
  pathSampler,
  reversePath,
  translated,
  elementBBox,
  type FlowElement,
  type WireElement,
} from '../index';

const flow = (patch: Partial<FlowElement> = {}): FlowElement => ({
  id: 'f',
  z: 0,
  type: 'flow',
  pts: [0, 0, 100, 0],
  current: 1,
  signal: 'dc',
  symbol: 'dot',
  ...patch,
});

describe('current flow', () => {
  it('computes the classic signals', () => {
    expect(flowSignal('dc', 3, 2)).toBe(1);
    expect(flowSignal('sine', 0.5, 2)).toBeCloseTo(1);
    expect(flowSignal('square', 0.5, 2)).toBe(1);
    expect(flowSignal('square', 1.5, 2)).toBe(-1);
    expect(flowSignal('triangle', 0.5, 2)).toBeCloseTo(1);
    expect(flowSignal('triangle', 1.5, 2)).toBeCloseTo(-1);
    expect(flowSignal('sawtooth', 1, 2)).toBeCloseTo(0.5);
    expect(flowSignal('pwm', 0.4, 2, 0.25)).toBe(1);
    expect(flowSignal('pwm', 0.6, 2, 0.25)).toBe(0);
    // Ramps and exponentials start once and settle.
    expect(flowSignal('ramp', 1, 2)).toBeCloseTo(0.5);
    expect(flowSignal('ramp', 10, 2)).toBe(1);
    expect(flowSignal('rise', 2, 2)).toBeCloseTo(1 - Math.exp(-1));
    expect(flowSignal('decay', 2, 2)).toBeCloseTo(Math.exp(-1));
  });

  it('a negative current, or electrons, flow backwards', () => {
    expect(flowCurrent(flow({ current: -2 }), 0)).toBe(-2);
    expect(flowVelocity(flow({ current: 1, speed: 50 }), 0)).toBe(50);
    expect(flowVelocity(flow({ current: -1, speed: 50 }), 0)).toBe(-50);
    expect(flowVelocity(flow({ current: 1, speed: 50, electrons: true }), 0)).toBe(-50);
    // A ripple around a DC value: offset + current × signal.
    expect(
      flowCurrent(flow({ signal: 'triangle', current: 0.3, offset: 2, period: 1 }), 0.25),
    ).toBeCloseTo(2.3);
  });

  it('walks the path by distance', () => {
    const s = pathSampler([0, 0, 100, 0, 100, 50]);
    expect(s.length).toBe(150);
    expect(s.at(50)).toMatchObject({ x: 50, y: 0, angle: 0 });
    const p = s.at(125);
    expect(p.x).toBe(100);
    expect(p.y).toBe(25);
    expect(p.angle).toBeCloseTo(Math.PI / 2);
  });

  it('spaces the symbols evenly on a loop, and fades them at the ends of an open path', () => {
    const loop = flowPositions(400, true, 30, 0);
    expect(loop).toHaveLength(13);
    expect(loop[1]!.s - loop[0]!.s).toBeCloseTo(400 / 13);
    // Moving by one spacing gives the same picture.
    const a = flowPositions(400, true, 30, 5).map((p) => p.s);
    const b = flowPositions(400, true, 30, 5 + 400 / 13).map((p) => p.s);
    expect(a).toEqual(b.map((v) => expect.closeTo(v, 6)));
    const open = flowPositions(100, false, 20, 0);
    expect(open[0]!.alpha).toBe(0);
    expect(open.every((p) => p.s >= 0 && p.s <= 100)).toBe(true);
  });

  it('moves and bounds like a path', () => {
    const f = flow({ pts: [0, 0, 100, 0], size: 4 });
    expect((translated(f, 10, 20) as FlowElement).pts).toEqual([10, 20, 110, 20]);
    const p = Project.create('T');
    expect(elementBBox(f, makeContext(p))).toEqual({ x: -5, y: -5, w: 110, h: 10 });
    expect(reversePath([0, 0, 10, 0, 10, 10])).toEqual([10, 10, 10, 0, 0, 0]);
  });

  it('builds a clockwise loop through the selected wires and parts', () => {
    const p = Project.create('T');
    const sheet = p.rootSheetId;
    const ctx = makeContext(p);
    const wire = (...pts: number[]) =>
      p.addElement(sheet, { type: 'wire', pts, kind: 'power' }) as WireElement;
    // A source on the left (vertical), a resistor on the right, wires around.
    const v = addComponent(p, sheet, 'vsource-dc', 0, 100, ctx);
    const r = addComponent(p, sheet, 'resistor', 200, 100, ctx, { rot: 1 });
    const top = wire(0, 70, 0, 20, 200, 20, 200, 70);
    const bottom = wire(0, 130, 0, 180, 200, 180, 200, 130);
    const els = p.getElements(sheet);
    const path = flowPathFromSelection(els, [v.id, r.id, top.id, bottom.id], makeContext(p));
    expect(path?.closed).toBe(true);
    const pts = path!.pts;
    // Every corner of the loop is on it.
    const has = (x: number, y: number) =>
      pts.some((_, i) => i % 2 === 0 && pts[i] === x && pts[i + 1] === y);
    expect(has(0, 20) && has(200, 20) && has(200, 180) && has(0, 180)).toBe(true);
    // Clockwise on the screen: from the top-left corner, it goes right along the top.
    const i = pts.findIndex((_, k) => k % 2 === 0 && pts[k] === 0 && pts[k + 1] === 20);
    const n = pts.length;
    expect(pts[(i + 2) % n]).toBe(200);
    expect(pts[(i + 3) % n]).toBe(20);
  });

  it('goes straight on through a T, and starts at an end of an open path', () => {
    const p = Project.create('T');
    const sheet = p.rootSheetId;
    const w1 = p.addElement(sheet, { type: 'wire', pts: [0, 0, 200, 0], kind: 'power' });
    const w2 = p.addElement(sheet, { type: 'wire', pts: [100, 0, 100, 80], kind: 'power' });
    const path = flowPathFromSelection(p.getElements(sheet), [w1.id, w2.id], makeContext(p));
    expect(path?.closed).toBe(false);
    // Starts at the top-left end, and goes straight through the T to the other end first.
    expect(path!.pts.slice(0, 4)).toEqual([0, 0, 200, 0]);
    expect(flowPathFromSelection(p.getElements(sheet), [], makeContext(p))).toBeNull();
  });

  it('leaves a dead end aside and follows the loop', () => {
    const p = Project.create('T');
    const sheet = p.rootSheetId;
    const w = (...pts: number[]) => p.addElement(sheet, { type: 'wire', pts, kind: 'power' }).id;
    // A square loop, with a stub going on to the right from its top-right corner's T.
    const ids = [
      w(0, 0, 100, 0),
      w(100, 0, 160, 0),
      w(100, 0, 100, 100),
      w(100, 100, 0, 100),
      w(0, 100, 0, 0),
    ];
    const path = flowPathFromSelection(p.getElements(sheet), ids, makeContext(p));
    const pts = path!.pts;
    const has = (x: number, y: number) =>
      pts.some((_, i) => i % 2 === 0 && pts[i] === x && pts[i + 1] === y);
    // The walk goes round the loop (the stub is only a short dead end).
    expect(has(0, 100) && has(100, 100)).toBe(true);
  });
});
