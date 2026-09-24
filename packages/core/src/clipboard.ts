import { translated } from './commands/move';
import { expandSelection } from './commands/ops';
import { descendantSheets } from './hierarchy';
import { newId } from './ids';
import type { Project } from './model/project';
import type { Element, Id, SheetInfo } from './model/types';
import { collectRefs, nextRef, splitRef } from './refdes';

export const CLIP_FORMAT = 'overleagger/clip';

export interface ClipSheet {
  info: SheetInfo;
  elements: Element[];
}

export interface ClipData {
  format: typeof CLIP_FORMAT;
  version: 1;
  /** Elements of the sheet the copy was made from. */
  elements: Element[];
  /** Sub-sheets of the copied blocks (deep). */
  sheets: ClipSheet[];
}

/** Serialize a selection (including group members and the sub-sheets of blocks). */
export function copyElements(project: Project, sheetId: Id, ids: Iterable<Id>): ClipData {
  const all = project.getElements(sheetId);
  const set = expandSelection(all, ids);
  const elements = all.filter((e) => set.has(e.id));
  const sheets: ClipSheet[] = [];
  for (const el of elements) {
    if (el.type !== 'block') continue;
    for (const sid of [el.childSheetId, ...descendantSheets(project, el.childSheetId)]) {
      const info = project.getSheet(sid);
      if (info) sheets.push({ info, elements: project.getElements(sid) });
    }
  }
  return JSON.parse(
    JSON.stringify({ format: CLIP_FORMAT, version: 1, elements, sheets }),
  ) as ClipData;
}

export function parseClip(text: string): ClipData | undefined {
  try {
    const data = JSON.parse(text) as Partial<ClipData>;
    if (data.format === CLIP_FORMAT && Array.isArray(data.elements)) {
      return {
        format: CLIP_FORMAT,
        version: 1,
        elements: data.elements,
        sheets: data.sheets ?? [],
      };
    }
  } catch {
    // not ours
  }
  return undefined;
}

/**
 * Paste clipboard data into a sheet with an offset. Every element and sheet gets a fresh id,
 * blocks get deep-copied sub-sheets and clashing references are renumbered.
 * Returns the ids of the pasted top-level (sheet) elements.
 */
export function pasteClip(
  project: Project,
  sheetId: Id,
  clip: ClipData,
  dx: number,
  dy: number,
): Id[] {
  const idMap = new Map<Id, Id>();
  const sheetMap = new Map<Id, Id>();
  const allEls = [...clip.elements, ...clip.sheets.flatMap((s) => s.elements)];
  for (const e of allEls) idMap.set(e.id, newId());
  for (const s of clip.sheets) sheetMap.set(s.info.id, newId());
  const used = collectRefs(project);

  const remap = (e: Element): Element => {
    const out = { ...e, id: idMap.get(e.id)! } as Element;
    if (e.groupId) {
      const g = idMap.get(e.groupId);
      if (g) out.groupId = g;
      else delete out.groupId;
    }
    if (out.type === 'block' && e.type === 'block')
      out.childSheetId = sheetMap.get(e.childSheetId) ?? newId();
    // Connectors stay attached to the copies of their shapes, or become free lines.
    if (out.type === 'line') {
      for (const end of ['from', 'to'] as const) {
        const b = out[end];
        if (!b) continue;
        const id = idMap.get(b.id);
        if (id) out[end] = { ...b, id };
        else delete out[end];
      }
    }
    // A link to a sheet that was copied too points to the copy.
    if (e.link?.kind === 'sheet' && sheetMap.has(e.link.sheetId))
      out.link = { kind: 'sheet', sheetId: sheetMap.get(e.link.sheetId)! };
    if (out.type === 'component' && out.ref) {
      if (used.has(out.ref)) {
        const prefix = splitRef(out.ref)?.[0] ?? out.ref;
        out.ref = nextRef(prefix, used);
      }
      used.add(out.ref);
    }
    return out;
  };

  const top: Id[] = [];
  project.transact(() => {
    // Sheets first so blocks can reference them.
    for (const s of clip.sheets) {
      const newSheet = sheetMap.get(s.info.id)!;
      const parent = s.info.parentSheetId && sheetMap.get(s.info.parentSheetId);
      const info: SheetInfo = {
        id: newSheet,
        name: s.info.name,
        parentSheetId: parent || sheetId,
      };
      const block = s.info.blockId && idMap.get(s.info.blockId);
      if (block) info.blockId = block;
      if (s.info.noPresent) info.noPresent = true;
      if (s.info.noExport) info.noExport = true;
      project.createSheetRaw(info);
    }
    let z = project.maxZ(sheetId) + 1;
    for (const e of clip.elements) {
      const el = remap(translated(e, dx, dy));
      project.addElement(sheetId, { ...el, z: z++ });
      top.push(el.id);
    }
    for (const s of clip.sheets) {
      const target = sheetMap.get(s.info.id)!;
      for (const e of s.elements) project.addElement(target, remap(e));
    }
  });
  return top;
}

/** Duplicate elements in place with an offset. */
export function duplicateElements(
  project: Project,
  sheetId: Id,
  ids: Iterable<Id>,
  dx = 20,
  dy = 20,
): Id[] {
  return pasteClip(project, sheetId, copyElements(project, sheetId, ids), dx, dy);
}
