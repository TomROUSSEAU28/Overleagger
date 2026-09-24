import { newId } from '../ids';
import { elementBBox, type SheetContext } from '../geometry/elements';
import { rectUnion, snap } from '../geometry/geom';
import type { Project } from '../model/project';
import type { Element, Id, Rect } from '../model/types';
import { GRID } from '../model/types';
import { computeMove } from './move';
import { expandSelection } from './ops';

// ---------------------------------------------------------------------------
// Resizing
// ---------------------------------------------------------------------------

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** New rectangle after dragging `handle` by (dx, dy). Keeps a minimum size and optionally the ratio. */
export function resizeRect(
  r: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  min = GRID * 2,
  keepAspect = false,
): Rect {
  let x0 = r.x;
  let y0 = r.y;
  let x1 = r.x + r.w;
  let y1 = r.y + r.h;
  if (handle.includes('w')) x0 = Math.min(x0 + dx, x1 - min);
  if (handle.includes('e')) x1 = Math.max(x1 + dx, x0 + min);
  if (handle.includes('n')) y0 = Math.min(y0 + dy, y1 - min);
  if (handle.includes('s')) y1 = Math.max(y1 + dy, y0 + min);
  let out = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  if (keepAspect && r.w > 0 && r.h > 0 && handle.length === 2) {
    const ratio = r.w / r.h;
    const w = Math.max(out.w, out.h * ratio);
    const h = w / ratio;
    out = {
      x: handle.includes('w') ? x1 - w : x0,
      y: handle.includes('n') ? y1 - h : y0,
      w,
      h,
    };
  }
  return out;
}

/** Position of a handle on a rectangle. */
export function handlePos(r: Rect, h: Handle): { x: number; y: number } {
  const x = h.includes('w') ? r.x : h.includes('e') ? r.x + r.w : r.x + r.w / 2;
  const y = h.includes('n') ? r.y : h.includes('s') ? r.y + r.h : r.y + r.h / 2;
  return { x, y };
}

// ---------------------------------------------------------------------------
// Align & distribute
// ---------------------------------------------------------------------------

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** Apply several moves (each on a set of ids) and return the final state of every changed element. */
export function moveUnits(
  all: Element[],
  moves: { ids: Id[]; dx: number; dy: number }[],
  ctx: SheetContext,
): Element[] {
  let current = all;
  const changed = new Map<Id, Element>();
  for (const m of moves) {
    if (!m.dx && !m.dy) continue;
    const set = expandSelection(current, m.ids);
    const res = computeMove(current, set, m.dx, m.dy, ctx);
    const map = new Map(res.map((e) => [e.id, e]));
    current = current.map((e) => map.get(e.id) ?? e);
    for (const e of res) changed.set(e.id, e);
  }
  return [...changed.values()];
}

function unitBoxes(all: Element[], units: Id[], ctx: SheetContext): { id: Id; r: Rect }[] {
  return units
    .map((id) => {
      const members = all.filter((e) => expandSelection(all, [id]).has(e.id) && e.type !== 'group');
      const r = rectUnion(members.map((m) => elementBBox(m, ctx, all)));
      return r ? { id, r } : null;
    })
    .filter((x): x is { id: Id; r: Rect } => Boolean(x));
}

export function alignUnits(
  all: Element[],
  units: Id[],
  mode: AlignMode,
  ctx: SheetContext,
): Element[] {
  const boxes = unitBoxes(all, units, ctx);
  if (boxes.length < 2) return [];
  const u = rectUnion(boxes.map((b) => b.r))!;
  const moves = boxes.map(({ id, r }) => {
    let dx = 0;
    let dy = 0;
    if (mode === 'left') dx = u.x - r.x;
    if (mode === 'right') dx = u.x + u.w - (r.x + r.w);
    if (mode === 'hcenter') dx = u.x + u.w / 2 - (r.x + r.w / 2);
    if (mode === 'top') dy = u.y - r.y;
    if (mode === 'bottom') dy = u.y + u.h - (r.y + r.h);
    if (mode === 'vcenter') dy = u.y + u.h / 2 - (r.y + r.h / 2);
    return { ids: [id], dx: snap(dx, GRID), dy: snap(dy, GRID) };
  });
  return moveUnits(all, moves, ctx);
}

/** Equal gaps between the units, horizontally or vertically. */
export function distributeUnits(
  all: Element[],
  units: Id[],
  axis: 'h' | 'v',
  ctx: SheetContext,
): Element[] {
  const boxes = unitBoxes(all, units, ctx);
  if (boxes.length < 3) return [];
  const key = (r: Rect) => (axis === 'h' ? r.x : r.y);
  const size = (r: Rect) => (axis === 'h' ? r.w : r.h);
  boxes.sort((a, b) => key(a.r) - key(b.r));
  const first = boxes[0]!.r;
  const last = boxes[boxes.length - 1]!.r;
  const span = key(last) + size(last) - key(first);
  const total = boxes.reduce((s, b) => s + size(b.r), 0);
  const gap = (span - total) / (boxes.length - 1);
  let pos = key(first);
  const moves = boxes.map(({ id, r }) => {
    const d = snap(pos - key(r), GRID);
    pos += size(r) + gap;
    return { ids: [id], dx: axis === 'h' ? d : 0, dy: axis === 'v' ? d : 0 };
  });
  return moveUnits(all, moves, ctx);
}

// ---------------------------------------------------------------------------
// Selection → hierarchical block
// ---------------------------------------------------------------------------

/**
 * Move the selected elements into a new hierarchical block placed where they were.
 * Sub-sheets of moved blocks are re-parented. Returns the new block id.
 */
export function moveToNewBlock(
  project: Project,
  sheetId: Id,
  ids: Id[],
  title: string,
  ctx: SheetContext,
): Id | undefined {
  const all = project.getElements(sheetId);
  const set = expandSelection(all, ids);
  const moving = all.filter((e) => set.has(e.id));
  if (!moving.length) return undefined;
  const box = rectUnion(
    moving.filter((e) => e.type !== 'group').map((e) => elementBBox(e, ctx, all)),
  );
  if (!box) return undefined;
  return project.transact(() => {
    const blockId = newId();
    const childId = newId();
    project.createSheetRaw({ id: childId, name: title, parentSheetId: sheetId, blockId });
    for (const e of moving) {
      project.removeElement(sheetId, e.id);
      project.addElement(childId, e);
      // Sub-sheets of a moved block now hang below the new block's sheet.
      if (e.type === 'block') project.updateSheet(e.childSheetId, { parentSheetId: childId });
    }
    const w = Math.max(80, snap(Math.min(box.w, 200), GRID * 2));
    const h = Math.max(60, snap(Math.min(box.h, 140), GRID * 2));
    project.addElement(sheetId, {
      id: blockId,
      type: 'block',
      x: snap(box.x + box.w / 2 - w / 2, GRID),
      y: snap(box.y + box.h / 2 - h / 2, GRID),
      w,
      h,
      title,
      childSheetId: childId,
    });
    return blockId;
  });
}
