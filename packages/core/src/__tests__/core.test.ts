import { describe, expect, it } from 'vitest';
import {
  Project,
  alignUnits,
  distributeUnits,
  followPins,
  moveToNewBlock,
  resizeRect,
  translated,
  addComponent,
  analyzeConnectivity,
  blockLayout,
  computeMove,
  copyElements,
  createBlock,
  createUndoManager,
  deleteElements,
  dragSegment,
  duplicateElements,
  elementPins,
  expandSelection,
  findJunctions,
  groupElements,
  makeContext,
  mirrorElements,
  normalizeWire,
  pasteClip,
  rotateElements,
  sheetPath,
  sheetTree,
  topLevelUnit,
  ungroupElements,
  validateHierarchy,
  type ComponentElement,
  type Element,
  type LabelElement,
  type PortElement,
  type ShapeElement,
  type TextElement,
  type WireElement,
} from '../index';

function setup() {
  const p = Project.create('Test');
  const sheet = p.rootSheetId;
  const ctx = () => makeContext(p);
  const wire = (...pts: number[]) =>
    p.addElement(sheet, { type: 'wire', pts, kind: 'power' }) as WireElement;
  return { p, sheet, ctx, wire };
}

describe('junction dots', () => {
  it('draws a dot on a T junction', () => {
    const { p, sheet, ctx, wire } = setup();
    wire(0, 0, 100, 0);
    wire(50, 0, 50, 50);
    expect(findJunctions(p.getElements(sheet), ctx())).toEqual([{ x: 50, y: 0 }]);
  });

  it('draws no dot when two wires simply cross', () => {
    const { p, sheet, ctx, wire } = setup();
    wire(0, 0, 100, 0);
    wire(50, -50, 50, 50);
    expect(findJunctions(p.getElements(sheet), ctx())).toEqual([]);
  });

  it('draws a dot on a 4-way junction made of wire ends', () => {
    const { p, sheet, ctx, wire } = setup();
    wire(0, 0, 50, 0);
    wire(50, 0, 100, 0);
    wire(50, -50, 50, 0);
    wire(50, 0, 50, 50);
    expect(findJunctions(p.getElements(sheet), ctx())).toEqual([{ x: 50, y: 0 }]);
  });

  it('draws no dot where a single wire meets a pin, but one where two wires meet it', () => {
    const { p, sheet, ctx, wire } = setup();
    const r = addComponent(p, sheet, 'resistor', 0, 0, ctx());
    const pin = elementPins(r, ctx()).find((x) => x.pinId === '2')!;
    wire(pin.x, pin.y, pin.x + 40, pin.y);
    expect(findJunctions(p.getElements(sheet), ctx())).toEqual([]);
    wire(pin.x, pin.y, pin.x, pin.y + 40);
    expect(findJunctions(p.getElements(sheet), ctx())).toEqual([{ x: pin.x, y: pin.y }]);
  });

  it('draws a dot when a wire ends on the corner of another wire', () => {
    const { p, sheet, ctx, wire } = setup();
    wire(0, 0, 50, 0, 50, 50);
    wire(50, 0, 100, 0);
    expect(findJunctions(p.getElements(sheet), ctx())).toEqual([{ x: 50, y: 0 }]);
  });
});

describe('nets', () => {
  it('connects pins through wires, T junctions and net labels', () => {
    const { p, sheet, ctx, wire } = setup();
    const r1 = addComponent(p, sheet, 'resistor', 0, 0, ctx());
    const r2 = addComponent(p, sheet, 'resistor', 200, 0, ctx());
    const r3 = addComponent(p, sheet, 'resistor', 400, 0, ctx());
    wire(30, 0, 170, 0); // r1.2 → r2.1
    const l1 = p.addElement(sheet, { type: 'label', x: 230, y: 0, text: 'VOUT' });
    const l2 = p.addElement(sheet, { type: 'label', x: 370, y: 0, text: 'VOUT' });
    const c = analyzeConnectivity(p.getElements(sheet), ctx());
    expect(c.netOf.get(`${r1.id}:2`)).toBe(c.netOf.get(`${r2.id}:1`));
    expect(c.netOf.get(`${r2.id}:2`)).toBe(c.netOf.get(`${l1.id}:p`));
    expect(c.netOf.get(`${l2.id}:p`)).toBe(c.netOf.get(`${r3.id}:1`));
    expect(c.netOf.get(`${r1.id}:1`)).not.toBe(c.netOf.get(`${r1.id}:2`));
    expect(c.connectedPins.has(`${r1.id}:2`)).toBe(true);
    expect(c.connectedPins.has(`${r1.id}:1`)).toBe(false);
  });
});

describe('hierarchy', () => {
  it('creates a block with a child sheet whose ports become block pins', () => {
    const { p, sheet, ctx } = setup();
    const b = createBlock(p, sheet, { x: 100, y: 100, w: 120, h: 80 }, 'Buck');
    expect(p.getSheet(b.childSheetId)?.parentSheetId).toBe(sheet);
    expect(elementPins(b, ctx())).toEqual([]);
    p.addElement(b.childSheetId, { type: 'port', x: 0, y: 0, name: 'Vin', dir: 'in' });
    p.addElement(b.childSheetId, { type: 'port', x: 300, y: 0, name: 'Vout', dir: 'out' });
    const pins = elementPins(p.getElement(sheet, b.id)!, ctx());
    expect(pins.map((x) => x.name).sort()).toEqual(['Vin', 'Vout']);
    const vin = pins.find((x) => x.name === 'Vin')!;
    expect(vin.x).toBe(100);
    expect(vin.y % 10).toBe(0);
    expect(pins.find((x) => x.name === 'Vout')!.x).toBe(220);
    expect(sheetPath(p, b.childSheetId).map((s) => s.id)).toEqual([sheet, b.childSheetId]);
    expect(validateHierarchy(p)).toEqual([]);
  });

  it('grows the block when there are many ports', () => {
    const ports = Array.from(
      { length: 6 },
      (_, i) =>
        ({
          id: `p${i}`,
          type: 'port',
          x: 0,
          y: i * 20,
          name: `in${i}`,
          dir: 'in',
          z: 0,
        }) as PortElement,
    );
    const l = blockLayout(
      { id: 'b', type: 'block', x: 0, y: 0, w: 80, h: 40, title: '', childSheetId: 'c', z: 0 },
      ports,
    );
    expect(l.h).toBe(140);
    expect(new Set(l.pins.map((p) => p.y)).size).toBe(6);
  });

  it('deletes sub-sheets recursively with their block', () => {
    const { p, sheet } = setup();
    const b = createBlock(p, sheet, { x: 0, y: 0, w: 80, h: 60 }, 'A');
    const inner = createBlock(p, b.childSheetId, { x: 0, y: 0, w: 80, h: 60 }, 'B');
    expect(p.listSheets()).toHaveLength(3);
    expect(sheetTree(p)?.children[0]?.children[0]?.sheet.id).toBe(inner.childSheetId);
    deleteElements(p, sheet, [b.id]);
    expect(p.listSheets()).toHaveLength(1);
  });

  it('detects a corrupted hierarchy (cycle)', () => {
    const { p, sheet } = setup();
    const a = createBlock(p, sheet, { x: 0, y: 0, w: 80, h: 60 }, 'A');
    const b = createBlock(p, a.childSheetId, { x: 0, y: 0, w: 80, h: 60 }, 'B');
    p.updateSheet(a.childSheetId, { parentSheetId: b.childSheetId });
    expect(validateHierarchy(p).some((x) => x.problem === 'cycle')).toBe(true);
  });
});

describe('clipboard', () => {
  it('pastes with fresh ids, renumbered refs and deep-copied sub-sheets', () => {
    const { p, sheet, ctx } = setup();
    const r = addComponent(p, sheet, 'resistor', 0, 0, ctx());
    const b = createBlock(p, sheet, { x: 100, y: 0, w: 80, h: 60 }, 'Sub');
    addComponent(p, b.childSheetId, 'capacitor', 0, 0, ctx());
    const clip = copyElements(p, sheet, [r.id, b.id]);
    const ids = pasteClip(p, sheet, clip, 20, 20);
    expect(ids).toHaveLength(2);
    expect(ids).not.toContain(r.id);
    const pasted = ids.map((id) => p.getElement(sheet, id)!);
    const pr = pasted.find((e) => e.type === 'component') as ComponentElement;
    expect(pr.ref).toBe('R2');
    expect(pr.x).toBe(20);
    const pb = pasted.find((e) => e.type === 'block')!;
    expect(pb.type === 'block' && pb.childSheetId).not.toBe(b.childSheetId);
    if (pb.type !== 'block') throw new Error('expected block');
    const sub = p.getElements(pb.childSheetId);
    expect(sub).toHaveLength(1);
    expect((sub[0] as ComponentElement).ref).toBe('C2');
    expect(p.getSheet(pb.childSheetId)?.blockId).toBe(pb.id);
    expect(validateHierarchy(p)).toEqual([]);
  });

  it('duplicates groups with their members', () => {
    const { p, sheet, ctx } = setup();
    const a = addComponent(p, sheet, 'resistor', 0, 0, ctx());
    const b = addComponent(p, sheet, 'capacitor', 100, 0, ctx());
    const g = groupElements(p, sheet, [a.id, b.id])!;
    const ids = duplicateElements(p, sheet, [g]);
    expect(ids).toHaveLength(3);
    const all = p.getElements(sheet);
    const newGroup = ids.find((id) => p.getElement(sheet, id)?.type === 'group')!;
    expect(all.filter((e) => e.groupId === newGroup)).toHaveLength(2);
  });
});

describe('groups', () => {
  it('groups, nests and ungroups', () => {
    const { p, sheet, ctx } = setup();
    const a = addComponent(p, sheet, 'resistor', 0, 0, ctx());
    const b = addComponent(p, sheet, 'resistor', 100, 0, ctx());
    const c = addComponent(p, sheet, 'resistor', 200, 0, ctx());
    const g1 = groupElements(p, sheet, [a.id, b.id])!;
    const g2 = groupElements(p, sheet, [a.id, c.id])!; // a resolves to g1
    const all = p.getElements(sheet);
    expect(topLevelUnit(all, a.id)).toBe(g2);
    expect(expandSelection(all, [g2]).size).toBe(5);
    ungroupElements(p, sheet, [g2]);
    expect(topLevelUnit(p.getElements(sheet), a.id)).toBe(g1);
    expect(p.getElement(sheet, g2)).toBeUndefined();
  });
});

describe('moving', () => {
  it('stretches attached wires and keeps them orthogonal', () => {
    const { p, sheet, ctx, wire } = setup();
    const r = addComponent(p, sheet, 'resistor', 0, 0, ctx());
    const w = wire(30, 0, 100, 0);
    const changed = computeMove(p.getElements(sheet), new Set([r.id]), 0, 20, ctx());
    const nw = changed.find((e) => e.id === w.id) as WireElement;
    expect(nw.pts[0]).toBe(30);
    expect(nw.pts[1]).toBe(20);
    expect(nw.pts.at(-2)).toBe(100);
    expect(nw.pts.at(-1)).toBe(0);
    for (let i = 2; i < nw.pts.length; i += 2) {
      const horizontal = nw.pts[i + 1] === nw.pts[i - 1];
      const vertical = nw.pts[i] === nw.pts[i - 2];
      expect(horizontal || vertical).toBe(true);
    }
  });

  it('drags a wire segment while keeping its end points', () => {
    const w = { id: 'w', type: 'wire', z: 0, kind: 'power', pts: [0, 0, 100, 0] } as WireElement;
    expect(dragSegment(w, 0, 0, 30)).toEqual([0, 0, 0, 30, 100, 30, 100, 0]);
  });

  it('normalizes wires', () => {
    expect(normalizeWire([0, 0, 10, 0, 20, 0, 20, 0, 20, 10])).toEqual([0, 0, 20, 0, 20, 10]);
  });

  it('rotates and mirrors components', () => {
    const { p, sheet, ctx } = setup();
    const r = addComponent(p, sheet, 'resistor', 50, 50, ctx());
    const [rot] = rotateElements([r], ctx()) as ComponentElement[];
    expect(rot!.rot).toBe(1);
    expect([rot!.x, rot!.y]).toEqual([50, 50]);
    const pins = elementPins(rot as Element, ctx());
    expect(pins.map((x) => [x.x, x.y])).toEqual([
      [50, 20],
      [50, 80],
    ]);
    const [m] = mirrorElements([rot as Element], ctx(), 'x') as ComponentElement[];
    expect(m!.mirror).toBe(true);
    expect(m!.rot).toBe(3);
  });

  it('mirrors ports, labels, text and triangles in place', () => {
    const { p, sheet, ctx } = setup();
    const port = p.addElement(sheet, { type: 'port', x: 100, y: 40, name: 'in', dir: 'in' });
    const [mp] = mirrorElements([port], ctx(), 'x') as PortElement[];
    expect([mp!.x, mp!.y, mp!.flip]).toEqual([100, 40, true]);
    const label = p.addElement(sheet, { type: 'label', x: 20, y: 20, text: 'a' });
    expect((mirrorElements([label], ctx(), 'x')[0] as LabelElement).flip).toBe(true);
    const text = p.addElement(sheet, {
      type: 'text',
      x: 0,
      y: 0,
      text: 'hi',
      size: 14,
      align: 'start',
    });
    expect((mirrorElements([text], ctx(), 'x')[0] as TextElement).align).toBe('end');
    const tri = p.addElement(sheet, { type: 'shape', kind: 'triangle', x: 0, y: 0, w: 40, h: 40 });
    expect((mirrorElements([tri], ctx(), 'y')[0] as ShapeElement).dir).toBe('b');
    expect((rotateElements([tri], ctx())[0] as ShapeElement).dir).toBe('r');
  });
});

describe('undo', () => {
  it('undoes and redoes local edits', () => {
    const { p, sheet, ctx } = setup();
    const um = createUndoManager(p);
    const r = addComponent(p, sheet, 'resistor', 0, 0, ctx());
    um.stopCapturing();
    p.updateElement(sheet, r.id, { x: 100 });
    um.stopCapturing();
    um.undo();
    expect(
      p.getElement(sheet, r.id)?.type === 'component' &&
        (p.getElement(sheet, r.id) as ComponentElement).x,
    ).toBe(0);
    um.undo();
    expect(p.getElement(sheet, r.id)).toBeUndefined();
    um.redo();
    expect(p.getElement(sheet, r.id)).toBeDefined();
  });

  it('keeps snapshots stable until an element changes', () => {
    const { p, sheet, ctx } = setup();
    const a = addComponent(p, sheet, 'resistor', 0, 0, ctx());
    const b = addComponent(p, sheet, 'resistor', 100, 0, ctx());
    const before = p.getElements(sheet);
    p.updateElement(sheet, b.id, { x: 200 });
    const after = p.getElements(sheet);
    expect(after.find((e) => e.id === a.id)).toBe(before.find((e) => e.id === a.id));
    expect(after.find((e) => e.id === b.id)).not.toBe(before.find((e) => e.id === b.id));
  });

  it('round-trips through a Yjs update', () => {
    const { p, sheet, ctx } = setup();
    addComponent(p, sheet, 'mosfet', 0, 0, ctx(), { opts: { circle: true } });
    const copy = Project.fromUpdate(p.encodeState());
    expect(copy.toJSON()).toEqual(p.toJSON());
  });
});

describe('net labels', () => {
  it('do not create junction dots on the wire they name', () => {
    const { p, sheet, ctx, wire } = setup();
    wire(0, 0, 100, 0);
    p.addElement(sheet, { type: 'label', x: 50, y: 0, text: 'VOUT' });
    expect(findJunctions(p.getElements(sheet), ctx())).toEqual([]);
  });
});

describe('phase 2 helpers', () => {
  it('moves wire ends with the pins when a component rotates', () => {
    const { p, sheet, ctx, wire } = setup();
    const r = addComponent(p, sheet, 'resistor', 0, 0, ctx());
    const w = wire(30, 0, 100, 0);
    const [rotated] = rotateElements([r], ctx());
    const follow = followPins(p.getElements(sheet), [rotated!], ctx());
    const nw = follow.find((e) => e.id === w.id) as WireElement;
    // Pin 2 moved from (30, 0) to (0, 30).
    expect([nw.pts[0], nw.pts[1]]).toEqual([0, 30]);
    expect(nw.pts.slice(-2)).toEqual([100, 0]);
  });

  it('resizes rectangles from any handle', () => {
    const r = { x: 0, y: 0, w: 100, h: 50 };
    expect(resizeRect(r, 'se', 20, 10)).toEqual({ x: 0, y: 0, w: 120, h: 60 });
    expect(resizeRect(r, 'nw', 10, 10)).toEqual({ x: 10, y: 10, w: 90, h: 40 });
    expect(resizeRect(r, 'w', 200, 0).w).toBe(20);
  });

  it('aligns and distributes', () => {
    const { p, sheet, ctx } = setup();
    const a = p.addElement(sheet, { type: 'shape', kind: 'rect', x: 0, y: 0, w: 40, h: 40 });
    const b = p.addElement(sheet, { type: 'shape', kind: 'rect', x: 100, y: 30, w: 40, h: 40 });
    const c = p.addElement(sheet, { type: 'shape', kind: 'rect', x: 300, y: 60, w: 40, h: 40 });
    const aligned = alignUnits(p.getElements(sheet), [a.id, b.id, c.id], 'top', ctx());
    expect(aligned.every((e) => e.type === 'shape' && e.y === 0)).toBe(true);
    const spread = distributeUnits(p.getElements(sheet), [a.id, b.id, c.id], 'h', ctx());
    const bx = spread.find((e) => e.id === b.id);
    expect(bx && 'x' in bx && bx.x).toBe(150);
  });

  it('moves a selection into a new hierarchical block', () => {
    const { p, sheet, ctx } = setup();
    const r = addComponent(p, sheet, 'resistor', 0, 0, ctx());
    const inner = createBlock(p, sheet, { x: 100, y: 0, w: 80, h: 60 }, 'Inner');
    const id = moveToNewBlock(p, sheet, [r.id, inner.id], 'Outer', ctx())!;
    const block = p.getElement(sheet, id);
    expect(block?.type).toBe('block');
    if (block?.type !== 'block') return;
    expect(
      p
        .getElements(block.childSheetId)
        .map((e) => e.type)
        .sort(),
    ).toEqual(['block', 'component']);
    expect(p.getSheet(inner.childSheetId)?.parentSheetId).toBe(block.childSheetId);
    expect(validateHierarchy(p)).toEqual([]);
  });

  it('translates strokes and lines', () => {
    const s = { id: 's', type: 'stroke', z: 0, size: 2, pts: [0, 0, 0.5, 10, 10, 0.5] } as Element;
    expect((translated(s, 5, 5) as { pts: number[] }).pts).toEqual([5, 5, 0.5, 15, 15, 0.5]);
  });
});
