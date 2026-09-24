import type { Project } from './model/project';
import type { BlockElement, Id, SheetInfo } from './model/types';

export interface SheetNode {
  sheet: SheetInfo;
  children: SheetNode[];
}

/** Sheets from the root down to `sheetId` (inclusive). */
export function sheetPath(project: Project, sheetId: Id): SheetInfo[] {
  const out: SheetInfo[] = [];
  const seen = new Set<Id>();
  let cur = project.getSheet(sheetId);
  while (cur && !seen.has(cur.id)) {
    out.unshift(cur);
    seen.add(cur.id);
    cur = cur.parentSheetId ? project.getSheet(cur.parentSheetId) : undefined;
  }
  return out;
}

/** Tree of sheets starting at the root. Children are ordered by block position (top-left first). */
export function sheetTree(project: Project): SheetNode | undefined {
  const sheets = project.listSheets();
  const root = project.getSheet(project.rootSheetId);
  if (!root) return undefined;
  const byParent = new Map<Id, SheetInfo[]>();
  for (const s of sheets) {
    if (!s.parentSheetId) continue;
    const list = byParent.get(s.parentSheetId) ?? [];
    list.push(s);
    byParent.set(s.parentSheetId, list);
  }
  const blockPos = (s: SheetInfo) => {
    const b =
      s.parentSheetId && s.blockId ? project.getElement(s.parentSheetId, s.blockId) : undefined;
    return b && b.type === 'block' ? [b.y, b.x] : [Infinity, Infinity];
  };
  const seen = new Set<Id>();
  const build = (s: SheetInfo): SheetNode => {
    seen.add(s.id);
    const kids = (byParent.get(s.id) ?? []).filter((k) => !seen.has(k.id));
    kids.sort((a, b) => {
      const [ay, ax] = blockPos(a);
      const [by, bx] = blockPos(b);
      return ay! - by! || ax! - bx! || a.name.localeCompare(b.name);
    });
    return { sheet: s, children: kids.map(build) };
  };
  return build(root);
}

/** All sheets below `sheetId` (children, grandchildren…), not including itself. */
export function descendantSheets(project: Project, sheetId: Id): Id[] {
  const out: Id[] = [];
  const sheets = project.listSheets();
  const stack = [sheetId];
  const seen = new Set<Id>([sheetId]);
  while (stack.length) {
    const cur = stack.pop()!;
    for (const s of sheets) {
      if (s.parentSheetId === cur && !seen.has(s.id)) {
        seen.add(s.id);
        out.push(s.id);
        stack.push(s.id);
      }
    }
  }
  return out;
}

export function isAncestorSheet(project: Project, ancestor: Id, sheetId: Id): boolean {
  return sheetPath(project, sheetId).some((s) => s.id === ancestor);
}

export interface HierarchyProblem {
  sheetId: Id;
  problem: 'orphan' | 'missing-block' | 'cycle' | 'missing-child';
}

/** Consistency check of the sheet hierarchy (used by tests and on project load). */
export function validateHierarchy(project: Project): HierarchyProblem[] {
  const problems: HierarchyProblem[] = [];
  const root = project.rootSheetId;
  for (const s of project.listSheets()) {
    if (s.id === root) continue;
    const path = sheetPath(project, s.id);
    if (path[0]?.id !== root) {
      const parent = path[0]?.parentSheetId;
      problems.push({
        sheetId: s.id,
        problem: parent && project.hasSheet(parent) ? 'cycle' : 'orphan',
      });
      continue;
    }
    const block =
      s.parentSheetId && s.blockId ? project.getElement(s.parentSheetId, s.blockId) : undefined;
    if (!block || block.type !== 'block' || block.childSheetId !== s.id)
      problems.push({ sheetId: s.id, problem: 'missing-block' });
  }
  for (const s of project.listSheets()) {
    for (const el of project.getElements(s.id)) {
      if (el.type === 'block' && !project.hasSheet((el as BlockElement).childSheetId)) {
        problems.push({ sheetId: s.id, problem: 'missing-child' });
      }
    }
  }
  return problems;
}
