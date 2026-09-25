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
  type ReorderWhere,
  rotateElements,
  snap,
  topLevelUnit,
  ungroupElements,
  computeMove,
  removeSegment,
  alignUnits,
  distributeUnits,
  followPins,
  followConnectors,
  anchorPoints,
  moveToNewBlock,
  ReadOnlyError,
  newId,
  type AlignMode,
  type ClipData,
  type Element,
  type Id,
  type Project,
  type ProjectUndo,
  type Pt,
  type Rect,
  type SheetContext,
  type UndoStep,
} from '@overleagger/core';
import type { StaticSymbolDef } from '@overleagger/symbols';
import { motionEnabled, popIn, ripple, vanish } from '../canvas/juice';
import { toast } from '../store/toast';
import { useUI, type ToolId, type Viewport } from '../store/ui';
import type { CloudSession } from '../cloud/session';
import { useUserLib, type UserTemplate } from '../storage/userLibrary';

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

/**
 * Editor actions for one open project. React components and the canvas tools call into this
 * object; transient UI state lives in the `useUI` store, persistent state in the Yjs project.
 */
export class EditorController {
  readonly project: Project;
  readonly undo: ProjectUndo;
  readonly ctx: SheetContext;
  canvasSize = { w: 1200, h: 800 };
  private clipboard: ClipData | null = null;

  /** Collaboration session (cloud projects only). */
  readonly session: CloudSession | null;

  constructor(project: Project, session: CloudSession | null = null) {
    this.project = project;
    this.session = session;
    this.undo = createUndoManager(project);
    // Remember on which sheet each change was made, so undo / redo can show it there.
    this.undo.onStep((step) => {
      if (!step.meta.has('sheet')) step.meta.set('sheet', this.sheetId);
    });
    const base = makeContext(project);
    // Symbols of the personal library are usable in every project (they are copied into the
    // project when placed, so the project file stays self-contained).
    this.ctx = {
      get standard() {
        return base.standard;
      },
      symbol: (id) => base.symbol(id) ?? useUserLib.getState().symbols.find((s) => s.id === id),
      ports: base.ports,
      canRead: base.canRead,
    };
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

  /** Connection points of an element (flowchart connectors). */
  anchorsOf(el: Element) {
    return anchorPoints(el);
  }

  /** May the local user edit this sheet (role, locks)? Always true for local projects. */
  canEdit(sheetId: Id = this.sheetId): boolean {
    return this.project.canWrite(sheetId);
  }

  /** Run edits as one undo step. */
  commit<T>(fn: () => T): T {
    this.undo.stopCapturing();
    try {
      return this.project.transact(fn);
    } catch (e) {
      if (e instanceof ReadOnlyError) return undefined as T;
      throw e;
    } finally {
      this.undo.stopCapturing();
    }
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
    if (this.deletePickedSegment(ids)) return;
    vanish([...expandSelection(this.elements(), ids)]);
    this.commit(() => deleteElements(this.project, this.sheetId, ids));
    this.select([]);
  }

  /** A segment of the selected wire is picked: delete only it (the wire may split in two). */
  private deletePickedSegment(ids: Id[]): boolean {
    const seg = this.ui.wireSegment;
    if (!seg || ids.length !== 1 || ids[0] !== seg.wireId) return false;
    const w = this.project.getElement(this.sheetId, seg.wireId);
    if (w?.type !== 'wire' || 2 * seg.index + 3 >= w.pts.length) return false;
    const [first, second] = removeSegment(w.pts, seg.index);
    this.commit(() => {
      if (!first) {
        deleteElements(this.project, this.sheetId, [w.id]);
        return;
      }
      this.project.updateElement(this.sheetId, w.id, { pts: first });
      if (second) {
        const { id: _id, z: _z, pts: _pts, ...rest } = w;
        this.project.addElement(this.sheetId, { ...rest, pts: second });
      }
    });
    this.select(first ? [w.id] : []);
    return true;
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
    popIn(ids, 8);
    return true;
  }

  duplicate() {
    const ids = this.selection();
    if (!ids.length) return;
    const out = this.commit(() => duplicateElements(this.project, this.sheetId, ids));
    const all = this.elements();
    this.select([...new Set(out.map((id) => topLevelUnit(all, id)))]);
    popIn(out, 8);
  }

  /** Replace elements by modified copies (same ids). Attached connectors follow. */
  applyElements(changed: Element[]) {
    if (!changed.length) return;
    const merged = new Map(changed.map((e) => [e.id, e]));
    for (const l of followConnectors(this.elements(), changed)) merged.set(l.id, l);
    changed = [...merged.values()];
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

  /** Follow the link of an element (URL in a new tab, or a sheet of the project). */
  followLink(id: Id) {
    const el = this.project.getElement(this.sheetId, id);
    // A sheet port leads to its pin on the block, one level up.
    if (el?.type === 'port') {
      const sheet = this.project.getSheet(this.sheetId);
      if (!sheet?.parentSheetId) return false;
      this.openSheet(sheet.parentSheetId);
      if (sheet.blockId) this.select([sheet.blockId]);
      return true;
    }
    const link = el?.link;
    if (!link) return false;
    if (link.kind === 'url') {
      if (/^(https?:|mailto:)/i.test(link.url)) window.open(link.url, '_blank', 'noopener');
    } else this.openSheet(link.sheetId);
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

  /** Copy personal-library symbols into the project (if missing), so its file stays complete. */
  private adoptSymbols(defs: StaticSymbolDef[]) {
    for (const d of defs) if (!this.project.symbols.has(d.id)) this.project.symbols.set(d.id, d);
  }

  /** Insert one of the user's templates (centred on a point, or on the view). */
  insertTemplate(t: UserTemplate, at?: Pt) {
    this.insertClip(t.clip, at, t.symbols);
  }

  /** Save the selection in the personal library as a reusable template. */
  saveSelectionAsTemplate(info: { name: string; category: string; description?: string }) {
    const ids = this.selection();
    if (!ids.length) return null;
    const clip = copyElements(this.project, this.sheetId, ids);
    const used = new Set<string>();
    const collect = (els: Element[]) => {
      for (const e of els) if (e.type === 'component') used.add(e.symbolId);
    };
    collect(clip.elements);
    for (const s of clip.sheets) collect(s.elements);
    const symbols = [...used]
      .map(
        (id) =>
          this.project.symbols.get(id) ?? useUserLib.getState().symbols.find((s) => s.id === id),
      )
      .filter((s): s is StaticSymbolDef => Boolean(s));
    const t: UserTemplate = {
      id: newId(10),
      name: info.name.trim() || 'Untitled template',
      category: info.category.trim() || 'My templates',
      ...(info.description?.trim() ? { description: info.description.trim() } : {}),
      createdAt: Date.now(),
      clip,
      symbols,
    };
    useUserLib.getState().saveTemplate(t);
    return t;
  }

  /** Paste clipboard-like data (templates) at a point. */
  insertClip(clip: ClipData, at?: Pt, symbols: StaticSymbolDef[] = []) {
    const box = rectUnion(
      clip.elements
        .filter((e) => e.type !== 'group')
        .map((e) => elementBBox(e, this.ctx, clip.elements)),
    );
    const target = at ?? this.viewCenter();
    const dx = box ? snap(target.x - (box.x + box.w / 2), GRID) : 0;
    const dy = box ? snap(target.y - (box.y + box.h / 2), GRID) : 0;
    const ids = this.commit(() => {
      this.adoptSymbols(symbols);
      return pasteClip(this.project, this.sheetId, clip, dx, dy);
    });
    const all = this.elements();
    this.select([...new Set(ids.map((id) => topLevelUnit(all, id)))]);
    // Unfold from the centre outwards.
    const byDistance = (id: string) => {
      const e = all.find((x) => x.id === id);
      if (!e || e.type === 'group') return Infinity;
      const b = elementBBox(e, this.ctx, all);
      return Math.hypot(b.x + b.w / 2 - target.x, b.y + b.h / 2 - target.y);
    };
    popIn(
      [...ids].sort((a, b) => byDistance(a) - byDistance(b)),
      14,
    );
    ripple(target.x, target.y, 'place', 1.8);
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

  reorder(where: ReorderWhere) {
    const ids = this.selection();
    if (ids.length) this.commit(() => reorder(this.project, this.sheetId, ids, where, this.ctx));
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
    const el = this.commit(() => {
      const mine = useUserLib.getState().symbols.find((s) => s.id === symbolId);
      if (mine) this.adoptSymbols([mine]);
      return addComponent(this.project, this.sheetId, symbolId, at.x, at.y, this.ctx, {
        rot,
        mirror,
      });
    });
    popIn([el.id]);
    ripple(at.x, at.y);
    return el;
  }

  addElement(el: Parameters<Project['addElement']>[1]): Element {
    const out = this.commit(() => this.project.addElement(this.sheetId, el));
    popIn([out.id]);
    return out;
  }

  doUndo() {
    this.showSheetOf(this.undo.peek('undo'));
    this.undo.undo();
    this.cleanSelection();
  }

  doRedo() {
    this.showSheetOf(this.undo.peek('redo'));
    this.undo.redo();
    this.cleanSelection();
  }

  /** Undoing a change made on another sheet goes there first, so the change is not invisible. */
  private showSheetOf(step: UndoStep | undefined) {
    const sheet = step?.meta.get('sheet');
    if (typeof sheet === 'string' && sheet !== this.sheetId && this.project.hasSheet(sheet))
      this.openSheet(sheet);
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
    if (!this.project.canRead(sheetId)) {
      toast('This sheet is hidden from you by the owner of the project.');
      return;
    }
    const changed = sheetId !== this.sheetId;
    this.ui.set({
      sheetId,
      selection: [],
      wireDraft: null,
      drag: null,
      marquee: null,
      inlineEdit: null,
      // A comment being written or opened belongs to the sheet we leave.
      ...(changed ? { commentDraft: null, openThread: null } : {}),
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
    this.stopViewportAnimation();
    this.ui.setViewport(sheetId, vp);
  }

  private vpAnim = 0;

  private stopViewportAnimation() {
    if (this.vpAnim) cancelAnimationFrame(this.vpAnim);
    this.vpAnim = 0;
  }

  /** Glide to a viewport (fit, zoom buttons); instant when animations are off. */
  animateViewport(to: Viewport, sheetId = this.sheetId) {
    const from = this.ui.viewports[sheetId];
    if (!from || !motionEnabled()) {
      this.setViewport(to, sheetId);
      return;
    }
    this.stopViewportAnimation();
    const t0 = performance.now();
    const dur = 240;
    // Interpolate the zoom geometrically so the motion feels even at every scale.
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      const k = 1 - (1 - t) ** 3;
      const zoom = from.zoom * (to.zoom / from.zoom) ** k;
      // Keep the world point under the screen centre moving linearly.
      const c = { x: this.canvasSize.w / 2, y: this.canvasSize.h / 2 };
      const wa = { x: (c.x - from.x) / from.zoom, y: (c.y - from.y) / from.zoom };
      const wb = { x: (c.x - to.x) / to.zoom, y: (c.y - to.y) / to.zoom };
      const w = { x: wa.x + (wb.x - wa.x) * k, y: wa.y + (wb.y - wa.y) * k };
      this.ui.setViewport(sheetId, { x: c.x - w.x * zoom, y: c.y - w.y * zoom, zoom });
      this.vpAnim = t < 1 ? requestAnimationFrame(step) : 0;
    };
    this.vpAnim = requestAnimationFrame(step);
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
    this.animateViewport(
      { x: w / 2 - (b.x + b.w / 2) * zoom, y: h / 2 - (b.y + b.h / 2) * zoom, zoom },
      sheetId,
    );
  }

  /** Zoom around a screen point (wheel: instant) or the view centre (buttons, keys: animated). */
  zoomAt(factor: number, screen?: Pt) {
    const vp = this.viewport();
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, vp.zoom * factor));
    const s = screen ?? { x: this.canvasSize.w / 2, y: this.canvasSize.h / 2 };
    const wx = (s.x - vp.x) / vp.zoom;
    const wy = (s.y - vp.y) / vp.zoom;
    const next = { x: s.x - wx * zoom, y: s.y - wy * zoom, zoom };
    if (screen) this.setViewport(next);
    else this.animateViewport(next);
  }

  zoomReset() {
    const vp = this.viewport();
    this.zoomAt(1 / vp.zoom);
  }
}
