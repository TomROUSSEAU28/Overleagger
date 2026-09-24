import { defaultOptions, defaultParams, type OptionValue } from '@overleagger/symbols';
import { descendantSheets } from '../hierarchy';
import { newId } from '../ids';
import type { SheetContext } from '../geometry/elements';
import type { Project } from '../model/project';
import type {
  BlockElement,
  ComponentElement,
  Element,
  GroupElement,
  Id,
  Rect,
} from '../model/types';
import { collectRefs, nextRef } from '../refdes';

// ---------------------------------------------------------------------------
// Selection helpers (groups)
// ---------------------------------------------------------------------------

/** The outermost group containing `id` (or `id` itself when it is not grouped). */
export function topLevelUnit(all: Element[], id: Id): Id {
  const byId = new Map(all.map((e) => [e.id, e]));
  let cur = byId.get(id);
  const seen = new Set<Id>();
  while (cur?.groupId && byId.has(cur.groupId) && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = byId.get(cur.groupId);
  }
  return cur?.id ?? id;
}

/** Selected ids plus every (nested) member of selected groups. */
export function expandSelection(all: Element[], ids: Iterable<Id>): Set<Id> {
  const out = new Set<Id>(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of all) {
      if (e.groupId && out.has(e.groupId) && !out.has(e.id)) {
        out.add(e.id);
        grew = true;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export interface PlaceOptions {
  rot?: ComponentElement['rot'];
  mirror?: boolean;
  opts?: Record<string, OptionValue>;
  params?: Record<string, string>;
}

export function addComponent(
  project: Project,
  sheetId: Id,
  symbolId: string,
  x: number,
  y: number,
  ctx: SheetContext,
  o: PlaceOptions = {},
): ComponentElement {
  const sym = ctx.symbol(symbolId);
  const ref = sym?.refPrefix ? nextRef(sym.refPrefix, collectRefs(project)) : '';
  return project.addElement(sheetId, {
    type: 'component',
    symbolId,
    x,
    y,
    rot: o.rot ?? 0,
    mirror: o.mirror ?? false,
    opts: { ...(sym ? defaultOptions(sym) : {}), ...o.opts },
    params: { ...(sym ? defaultParams(sym) : { value: '' }), ...o.params },
    ref,
  }) as ComponentElement;
}

/** Create a hierarchical block and its (empty) child sheet. */
export function createBlock(
  project: Project,
  sheetId: Id,
  rect: Rect,
  title: string,
): BlockElement {
  return project.transact(() => {
    const blockId = newId();
    const childId = newId();
    project.createSheetRaw({ id: childId, name: title, parentSheetId: sheetId, blockId });
    return project.addElement(sheetId, {
      id: blockId,
      type: 'block',
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      title,
      childSheetId: childId,
    }) as BlockElement;
  });
}

// ---------------------------------------------------------------------------
// Deletion
// ---------------------------------------------------------------------------

/**
 * Delete elements (and group members, and the sub-sheets of deleted blocks). A block is kept
 * when the user may not edit all its sub-sheets.
 */
export function deleteElements(project: Project, sheetId: Id, ids: Iterable<Id>): void {
  const all = project.getElements(sheetId);
  const doomed = expandSelection(all, ids);
  project.transact(() => {
    for (const id of doomed) {
      const el = all.find((e) => e.id === id);
      if (el?.type === 'block') {
        const sheets = [el.childSheetId, ...descendantSheets(project, el.childSheetId)];
        if (sheets.some((s) => project.hasSheet(s) && !project.canWrite(s))) continue;
        for (const s of sheets) project.deleteSheetRaw(s);
      }
      project.removeElement(sheetId, id);
    }
    pruneEmptyGroups(project, sheetId);
  });
}

/** Remove groups that have fewer than one member left. */
export function pruneEmptyGroups(project: Project, sheetId: Id): void {
  const all = project.getElements(sheetId);
  for (const g of all) {
    if (g.type !== 'group') continue;
    if (!all.some((e) => e.groupId === g.id)) project.removeElement(sheetId, g.id);
  }
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

/** Group top-level units together. Returns the new group id. */
export function groupElements(project: Project, sheetId: Id, ids: Id[]): Id | undefined {
  const all = project.getElements(sheetId);
  const units = [...new Set(ids.map((id) => topLevelUnit(all, id)))];
  if (units.length < 2) return undefined;
  return project.transact(() => {
    const g = project.addElement(sheetId, { type: 'group' }) as GroupElement;
    for (const id of units) project.updateElement(sheetId, id, { groupId: g.id });
    return g.id;
  });
}

/** Dissolve groups: their members move up one level. Returns the freed member ids. */
export function ungroupElements(project: Project, sheetId: Id, groupIds: Id[]): Id[] {
  const all = project.getElements(sheetId);
  const freed: Id[] = [];
  project.transact(() => {
    for (const gid of groupIds) {
      const g = all.find((e) => e.id === gid);
      if (!g || g.type !== 'group') continue;
      for (const m of all) {
        if (m.groupId !== gid) continue;
        project.updateElement(sheetId, m.id, { groupId: g.groupId });
        freed.push(m.id);
      }
      project.removeElement(sheetId, gid);
    }
  });
  return freed;
}

// ---------------------------------------------------------------------------
// Z-order
// ---------------------------------------------------------------------------

export function reorder(project: Project, sheetId: Id, ids: Id[], where: 'front' | 'back'): void {
  const all = project.getElements(sheetId);
  const set = expandSelection(all, ids);
  const moving = all.filter((e) => set.has(e.id));
  const zs = all.map((e) => e.z);
  const base = where === 'front' ? Math.max(0, ...zs) + 1 : Math.min(0, ...zs) - moving.length - 1;
  project.transact(() => {
    moving.forEach((e, i) => project.updateElement(sheetId, e.id, { z: base + i }));
  });
}
