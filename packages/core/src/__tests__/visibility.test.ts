import { describe, expect, it } from 'vitest';
import {
  Project,
  addComponent,
  buildSlides,
  createBlock,
  groupElements,
  makeContext,
  visibleFor,
  type FrameElement,
} from '../index';

describe('hidden from the presentation / the export', () => {
  it('hides flagged elements and the members of hidden groups', () => {
    const p = Project.create('t');
    const s = p.rootSheetId;
    const ctx = makeContext(p);
    const r1 = addComponent(p, s, 'resistor', 0, 0, ctx);
    const r2 = addComponent(p, s, 'resistor', 100, 0, ctx);
    const r3 = addComponent(p, s, 'resistor', 200, 0, ctx);
    p.updateElement(s, r1.id, { noExport: true });
    const g = groupElements(p, s, [r2.id, r3.id])!;
    p.updateElement(s, g, { noPresent: true });
    const ids = (a: 'present' | 'export') => visibleFor(p.getElements(s), a).map((e) => e.id);
    expect(ids('export')).not.toContain(r1.id);
    expect(ids('export')).toContain(r2.id);
    expect(ids('present')).toContain(r1.id);
    expect(ids('present')).not.toContain(r2.id);
    expect(ids('present')).not.toContain(r3.id);
  });

  it('skips hidden frames and hidden sheets in the slides', () => {
    const p = Project.create('t');
    const s = p.rootSheetId;
    const frame = (name: string, x: number, noPresent?: boolean) =>
      p.addElement(s, {
        type: 'frame',
        x,
        y: 0,
        w: 100,
        h: 80,
        name,
        ...(noPresent ? { noPresent } : {}),
      }) as FrameElement;
    frame('a', 0);
    frame('draft', 200, true);
    frame('c', 400);
    const child = createBlock(p, s, { x: 0, y: 200, w: 80, h: 60 }, 'Sub');
    addComponent(p, child.childSheetId, 'resistor', 0, 0, makeContext(p));
    expect(buildSlides(p, makeContext(p)).map((x) => x.title)).toEqual(['a', 'c', 'Sub']);
    p.updateSheet(child.childSheetId, { noPresent: true });
    expect(p.getSheet(child.childSheetId)?.noPresent).toBe(true);
    expect(buildSlides(p, makeContext(p)).map((x) => x.title)).toEqual(['a', 'c']);
    p.updateSheet(child.childSheetId, { noPresent: false });
    expect(p.getSheet(child.childSheetId)?.noPresent).toBeUndefined();
  });
});
