import { elementBBox, type SheetContext } from './geometry/elements';
import { rectUnion } from './geometry/geom';
import { sheetTree, type SheetNode } from './hierarchy';
import type { Project } from './model/project';
import type { FrameElement, Id, Rect } from './model/types';
import { visibleFor } from './visibility';

/** One slide of the presentation mode: a frame, or a whole sheet that has no frame. */
export interface Slide {
  sheetId: Id;
  /** Area to show (world px). */
  rect: Rect;
  title: string;
  frameId?: Id;
  /** Depth of the sheet in the hierarchy (0 = root sheet). */
  depth: number;
}

/** Sheets in hierarchy order (depth first, like the pages of the PDF). */
export function flattenSheetTree(node: SheetNode, out: SheetNode[] = []): SheetNode[] {
  out.push(node);
  for (const c of node.children) flattenSheetTree(c, out);
  return out;
}

/** Frames in reading order: rows from top to bottom, left to right inside a row. */
export function framesInReadingOrder(frames: FrameElement[]): FrameElement[] {
  const byY = [...frames].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: FrameElement[][] = [];
  for (const f of byY) {
    const row = rows[rows.length - 1];
    // Same row when it starts above the middle of the row's first frame.
    if (row && f.y < row[0]!.y + row[0]!.h / 2) row.push(f);
    else rows.push([f]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.x - b.x));
}

/**
 * Slides of the whole project: for each sheet (hierarchy order), its frames in reading order,
 * or the whole drawing when the sheet has no frame. Empty sheets, sheets and frames hidden from
 * the presentation are skipped (a sheet whose frames are all hidden gives no slide), and so
 * are the sheets the user may not see.
 */
export function buildSlides(project: Project, ctx: SheetContext): Slide[] {
  const tree = sheetTree(project);
  if (!tree) return [];
  const out: Slide[] = [];
  const depthOf = new Map<Id, number>();
  for (const node of flattenSheetTree(tree)) {
    const s = node.sheet;
    const depth = s.parentSheetId ? (depthOf.get(s.parentSheetId) ?? 0) + 1 : 0;
    depthOf.set(s.id, depth);
    if (s.noPresent || !project.canRead(s.id)) continue;
    const all = project.getElements(s.id);
    const els = visibleFor(all, 'present');
    const frames = els.filter((e): e is FrameElement => e.type === 'frame');
    if (all.some((e) => e.type === 'frame')) {
      for (const f of framesInReadingOrder(frames))
        out.push({
          sheetId: s.id,
          rect: { x: f.x, y: f.y, w: f.w, h: f.h },
          title: f.name || s.name,
          frameId: f.id,
          depth,
        });
      continue;
    }
    const box = rectUnion(
      els.filter((e) => e.type !== 'group').map((e) => elementBBox(e, ctx, els)),
    );
    if (box) out.push({ sheetId: s.id, rect: box, title: s.name || 'Untitled', depth });
  }
  return out;
}
