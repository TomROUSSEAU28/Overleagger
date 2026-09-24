import {
  GRID,
  addComponent,
  copyElements,
  createUndoManager,
  deleteElements,
  duplicateElements,
  elementBBox,
  expandSelection,
  groupElements,
  makeContext,
  mirrorElements,
  parseClip,
  pasteClip,
  rectUnion,
  reorder,
  rotateElements,
  snap,
  topLevelUnit,
  ungroupElements,
  computeMove,
  alignUnits,
  distributeUnits,
  followPins,
  moveToNewBlock,
  type AlignMode,
  type ClipData,
  type Element,
  type Id,
  type Project,
  type Pt,
  type Rect,
  type SheetContext,
} from '@overleagger/core';
import type * as Y from 'yjs';
import { useUI, type ToolId, type Viewport } from '../store/ui';

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

/**
 * Editor actions for one open project. React components and the canvas tools call into this
 * object; transient UI state lives in the `useUI` store, persistent state in the Yjs project.
 */
export class EditorController {
  readonly project: Project;
  readonly undo: Y.UndoManager;
  readonly ctx: SheetContext;
  canvasSize = { w: 1200, h: 800 };
  private clipboard: ClipData | null = null;

  constructor(project: Project) {
    this.project = project;
    this.undo = createUndoManager(project);
    this.ctx = makeContext(project);
  }

  destroy() {
    this.undo.destroy();
  }

  get ui() {
    return useUI.getState();
  }

  get sheetId(): Id {
    const id = this.ui.sheetId;
    return id && this.project.hasSheet(id) ? id : this.project.rootSheetId;
  }

  elements(): Element[] {
    return this.project.getElements(this.sheetId);
  }

  /** Run edits as one undo step. */
  commit<T>(fn: () => T): T {
    this.undo.stopCapturing();
    const out = this.project.transact(fn);
    this.undo.stopCapturing();
    return out;
  }

  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------

  /** Selected ids that still exist in the current sheet. */
  selection(): Id[] {
    const all = new Set(this.elements().map((e) => e.id));
    return this.ui.selection.filter((id) => all.has(id));
  }

  selectedElements(): Element[] {
    const set = expandSelection(this.elements(), this.selection());
    return this.elements().filter((e) => set.has(e.id));
  }

  select(ids: Id[]) {
    this.ui.setSelection([...new Set(ids)]);
  }

  selectUnit(id: Id, additive: boolean, bypassGroups = false) {
    const unit = bypassGroups ? id : topLevelUnit(this.elements(), id);
    const cur = this.selection();
    if (additive) this.select(cur.includes(unit) ? cur.filter((x) => x !== unit) : [...cur, unit]);
    else this.select([unit]);
  }

  selectAll() {
    const all = this.elements();
    this.select([...new Set(all.map((e) => topLevelUnit(all, e.id)))]);
  }

  // -------------------------------------------------------------------------
  // Editing
  // -------------------------------------------------------------------------

  deleteSelection() {
    const ids = this.selection();
    if (!ids.length) return;
    this.commit(() => deleteElements(this.project, this.sheetId, ids));
    this.select([]);
  }

  copy(): ClipData | null {
    const ids = this.selection();
    if (!ids.length) return null;
    this.clipboard = copyElements(this.project, this.sheetId, ids);
    return this.clipboard;
  }

  cut(): ClipData | null {
    const c = this.copy();
    if (c) this.deleteSelection();
    return c;
  }

  /** Paste clipboard data (from the system clipboard text, or the internal one). */
  paste(text?: string) {
    const clip = (text ? parseClip(text) : null) ?? this.clipboard;
    if (!clip || !clip.elements.length) return false;
    const box = rectUnion(
      clip.elements
        .filter((e) => e.type !== 'group')
        .map((e) => elementBBox(e, this.ctx, clip.elements)),
    );
    const cursor = this.ui.cursor;
    let dx = 20;
    let dy = 20;
    if (cursor && box) {
      dx = snap(cursor.x - box.x, GRID);
      dy = snap(cursor.y - box.y, GRID);
    }
    const ids = this.commit(() => pasteClip(this.project, this.sheetId, clip, dx, dy));
    const all = this.elements();
    this.select([...new Set(ids.map((id) => topLevelUnit(all, id)))]);
    return true;
  }

  duplicate() {
    const ids = this.selection();
    if (!ids.length) return;
    const out = this.commit(() => duplicateElements(this.project, this.sheetId, ids));
    const all = this.elements();
    this.select([...new Set(out.map((id) => topLevelUnit(all, id)))]);
  }

  /** Replace elements by modified copies (same ids). */
  applyElements(changed: Element[]) {
    if (!changed.length) return;
    this.commit(() => {
      for (const el of changed) {
        const { id, type: _t, ...rest } = el;
        this.project.updateElement(this.sheetId, id, rest as Partial<Element>);
      }
    });
  }

  /** Apply changed elements and drag the ends of attached wires to the new pin positions. */
  applyWithFollow(changed: Element[]) {
    this.applyElements([...changed, ...followPins(this.elements(), changed, this.ctx)]);
  }

  /** Patch one element; attached wires follow when its pins move (options, size…). */
  patchWithFollow(id: Id, patch: Partial<Element>) {
    const el = this.project.getElement(this.sheetId, id);
    if (!el) return;
    this.applyWithFollow([{ ...el, ...patch } as Element]);
  }

  align(mode: AlignMode) {
    this.applyElements(alignUnits(this.elements(), this.selection(), mode, this.ctx));
  }

  distribute(axis: 'h' | 'v') {
    this.applyElements(distributeUnits(this.elements(), this.selection(), axis, this.ctx));
  }

  /** Move the selection into a new hierarchical block. */
  selectionToBlock() {
    const ids = this.selection();
    if (!ids.length) return;
    const n = this.elements().filter((e) => e.type === 'block').length + 1;
    const id = this.commit(() =>
      moveToNewBlock(this.project, this.sheetId, ids, `Block ${n}`, this.ctx),
    );
    if (id) this.select([id]);
  }

  /** Follow the link of a button (URL in a new tab, or a sheet of the project). */
  followLink(id: Id) {
    const el = this.project.getElement(this.sheetId, id);
    if (el?.type !== 'button') return false;
    if (el.link.kind === 'url') {
      if (/^(https?:|mailto:)/i.test(el.link.url)) window.open(el.link.url, '_blank', 'noopener');
    } else this.openSheet(el.link.sheetId);
    return true;
  }

  /** Insert an image file (downscaled) centred on a point. */
  async insertImage(file: File, at: Pt) {
    const { loadImageFile } = await import('./images');
    const img = await loadImageFile(file);
    const w = snap(img.w, GRID);
    const h = snap(img.h, GRID);
    const el = this.addElement({
      type: 'image',
      x: snap(at.x - w / 2, GRID),
      y: snap(at.y - h / 2, GRID),
      w,
      h,
      src: img.src,
      name: file.name,
    });
    this.select([el.id]);
  }

  /** Paste clipboard-like data (templates) at a point. */
  insertClip(clip: ClipData, at?: Pt) {
    const box = rectUnion(
      clip.elements
        .filter((e) => e.type !== 'group')
        .map((e) => elementBBox(e, this.ctx, clip.elements)),
    );
    const target = at ?? this.viewCenter();
    const dx = box ? snap(target.x - (box.x + box.w / 2), GRID) : 0;
    const dy = box ? snap(target.y - (box.y + box.h / 2), GRID) : 0;
    const ids = this.commit(() => pasteClip(this.project, this.sheetId, clip, dx, dy));
    const all = this.elements();
    this.select([...new Set(ids.map((id) => topLevelUnit(all, id)))]);
  }

  /** World point at the centre of the visible canvas. */
  viewCenter(): Pt {
    const vp = this.viewport();
    return {
      x: (this.canvasSize.w / 2 - vp.x) / vp.zoom,
      y: (this.canvasSize.h / 2 - vp.y) / vp.zoom,
    };
  }

  rotate(ccw = false) {
    const ui = this.ui;
    if (ui.tool === 'place' && ui.placing) {
      ui.set({
        placing: { ...ui.placing, rot: ((ui.placing.rot + (ccw ? 3 : 1)) % 4) as 0 | 1 | 2 | 3 },
      });
      return;
    }
    const els = this.selectedElements().filter((e) => !e.locked);
    if (els.length) this.applyWithFollow(rotateElements(els, this.ctx, ccw));
  }

  mirror(axis: 'x' | 'y') {
    const ui = this.ui;
    if (ui.tool === 'place' && ui.placing) {
      const p = ui.placing;
      ui.set({
        placing: {
          ...p,
          mirror: !p.mirror,
          rot: (axis === 'x' ? (4 - p.rot) % 4 : (6 - p.rot) % 4) as 0 | 1 | 2 | 3,
        },
      });
      return;
    }
    const els = this.selectedElements().filter((e) => !e.locked);
    if (els.length) this.applyWithFollow(mirrorElements(els, this.ctx, axis));
  }

  nudge(dx: number, dy: number) {
    const els = this.selectedElements().filter((e) => !e.locked);
    if (!els.length) return;
    const moved = computeMove(
      this.elements(),
      new Set(els.map((e) => e.id)),
      dx * GRID,
      dy * GRID,
      this.ctx,
    );
    this.applyElements(moved);
  }

  moveBy(ids: Id[], dx: number, dy: number) {
    const set = expandSelection(this.elements(), ids);
    this.applyElements(computeMove(this.elements(), set, dx, dy, this.ctx));
  }

  group() {
    const ids = this.selection();
    if (ids.length < 2) return;
    const g = this.commit(() => groupElements(this.project, this.sheetId, ids));
    if (g) this.select([g]);
  }

  ungroup() {
    const groups = this.selection().filter(
      (id) => this.project.getElement(this.sheetId, id)?.type === 'group',
    );
    if (!groups.length) return;
    const freed = this.commit(() => ungroupElements(this.project, this.sheetId, groups));
    this.select(freed);
  }

  reorder(where: 'front' | 'back') {
    const ids = this.selection();
    if (ids.length) this.commit(() => reorder(this.project, this.sheetId, ids, where));
  }

  updateElement(id: Id, patch: Partial<Element>) {
    this.project.updateElement(this.sheetId, id, patch);
  }

  /** A block and its sub-sheet share the same name. */
  setBlockTitle(blockId: Id, title: string) {
    const el = this.project.getElement(this.sheetId, blockId);
    if (el?.type !== 'block') return;
    this.project.transact(() => {
      this.project.updateElement(this.sheetId, blockId, { title });
      this.project.updateSheet(el.childSheetId, { name: title });
    });
  }

  placeComponent(symbolId: string, at: Pt, rot: 0 | 1 | 2 | 3 = 0, mirror = false) {
    const el = this.commit(() =>
      addComponent(this.project, this.sheetId, symbolId, at.x, at.y, this.ctx, { rot, mirror }),
    );
    return el;
  }

  addElement(el: Parameters<Project['addElement']>[1]): Element {
    return this.commit(() => this.project.addElement(this.sheetId, el));
  }

  doUndo() {
    this.undo.undo();
    this.cleanSelection();
  }

  doRedo() {
    this.undo.redo();
    this.cleanSelection();
  }

  private cleanSelection() {
    const sel = this.selection();
    if (sel.length !== this.ui.selection.length) this.select(sel);
  }

  // -------------------------------------------------------------------------
  // Tools
  // -------------------------------------------------------------------------

  setTool(tool: ToolId) {
    this.ui.setTool(tool);
  }

  startPlacing(symbolId: string) {
    this.ui.set({
      tool: 'place',
      placing: { symbolId, rot: 0, mirror: false },
      wireDraft: null,
      selection: [],
    });
  }

  // -------------------------------------------------------------------------
  // Hierarchy navigation
  // -------------------------------------------------------------------------

  openSheet(sheetId: Id) {
    if (!this.project.hasSheet(sheetId)) return;
    this.ui.set({
      sheetId,
      selection: [],
      wireDraft: null,
      drag: null,
      marquee: null,
      inlineEdit: null,
    });
  }

  enterBlock(blockId: Id) {
    const el = this.project.getElement(this.sheetId, blockId);
    if (el?.type === 'block') this.openSheet(el.childSheetId);
  }

  enterSelectedBlock() {
    const sel = this.selection();
    if (sel.length !== 1) return false;
    const el = this.project.getElement(this.sheetId, sel[0]!);
    if (el?.type !== 'block') return false;
    this.openSheet(el.childSheetId);
    return true;
  }

  goUp() {
    const s = this.project.getSheet(this.sheetId);
    if (!s?.parentSheetId) return false;
    this.openSheet(s.parentSheetId);
    if (s.blockId) this.select([s.blockId]);
    return true;
  }

  // -------------------------------------------------------------------------
  // Viewport
  // -------------------------------------------------------------------------

  viewport(sheetId = this.sheetId): Viewport {
    return (
      this.ui.viewports[sheetId] ?? { x: this.canvasSize.w / 2, y: this.canvasSize.h / 2, zoom: 1 }
    );
  }

  setViewport(vp: Viewport, sheetId = this.sheetId) {
    this.ui.setViewport(sheetId, vp);
  }

  contentBounds(sheetId = this.sheetId): Rect | undefined {
    const els = this.project.getElements(sheetId);
    return rectUnion(
      els.filter((e) => e.type !== 'group').map((e) => elementBBox(e, this.ctx, els)),
    );
  }

  fit(sheetId = this.sheetId) {
    const b = this.contentBounds(sheetId);
    const { w, h } = this.canvasSize;
    if (!b || b.w + b.h === 0) {
      this.setViewport({ x: w / 2, y: h / 2, zoom: 1 }, sheetId);
      return;
    }
    const margin = 60;
    const zoom = Math.min(
      MAX_ZOOM,
      Math.max(
        MIN_ZOOM,
        Math.min((w - margin * 2) / Math.max(b.w, 1), (h - margin * 2) / Math.max(b.h, 1), 2),
      ),
    );
    this.setViewport(
      { x: w / 2 - (b.x + b.w / 2) * zoom, y: h / 2 - (b.y + b.h / 2) * zoom, zoom },
      sheetId,
    );
  }

  zoomAt(factor: number, screen?: Pt) {
    const vp = this.viewport();
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, vp.zoom * factor));
    const s = screen ?? { x: this.canvasSize.w / 2, y: this.canvasSize.h / 2 };
    const wx = (s.x - vp.x) / vp.zoom;
    const wy = (s.y - vp.y) / vp.zoom;
    this.setViewport({ x: s.x - wx * zoom, y: s.y - wy * zoom, zoom });
  }

  zoomReset() {
    const vp = this.viewport();
    this.zoomAt(1 / vp.zoom);
  }
}
