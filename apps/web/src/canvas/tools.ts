import {
  GRID,
  computeMove,
  createBlock,
  dragSegment,
  elbow,
  elementBBox,
  expandSelection,
  nearestSegment,
  normalizeWire,
  onSegmentInterior,
  pinAt,
  rectContains,
  rectFromPoints,
  rectsIntersect,
  samePt,
  snap,
  topLevelUnit,
  resizeRect,
  isBox,
  type Element,
  type Handle,
  type Id,
  type Pt,
} from '@overleagger/core';
import type { EditorController } from '../editor/controller';
import { useUI } from '../store/ui';

/** The tool controller of the mounted canvas (used by keyboard shortcuts). */
export const activeTools: { current: ToolController | null } = { current: null };

type Mode =
  | 'idle'
  | 'pan'
  | 'maybe-drag'
  | 'drag'
  | 'segment'
  | 'marquee'
  | 'block-draw'
  | 'resize'
  | 'line-edit'
  | 'rect-draw'
  | 'line-draw'
  | 'stroke'
  | 'erase';

export interface PointerInfo {
  screen: Pt;
  world: Pt;
  button: number;
  shift: boolean;
  alt: boolean;
  mod: boolean;
  /** Element id under the pointer (from the DOM hit areas). */
  targetId: Id | null;
  /** Resize handle under the pointer (`nw`…`sw`, or `p0` / `p1` / `bend` for lines). */
  handle: string | null;
  /** Pen pressure (0.5 for mice). */
  pressure: number;
  /** Element under the pointer, looked up even while the pointer is captured. */
  hitTest: () => Id | null;
}

/** Ask the canvas to open the image file picker; the image goes to `at`. */
export const PICK_IMAGE_EVENT = 'overleagger:pick-image';

/**
 * Pointer state machine for the canvas tools. Transient previews (drag offset, wire draft,
 * marquee…) are written to the UI store; the document is only changed on commit.
 */
export class ToolController {
  private mode: Mode = 'idle';
  private startScreen: Pt = { x: 0, y: 0 };
  private startWorld: Pt = { x: 0, y: 0 };
  private startVp = { x: 0, y: 0, zoom: 1 };
  private dragIds: Id[] = [];
  private segment: { wireId: Id; index: number } | null = null;
  private downTarget: Id | null = null;
  private wasSelected = false;
  private lastClick = { t: 0, x: 0, y: 0, target: null as Id | null, tool: '' };
  /** Wire drawing started from a pin with the select tool: go back to select afterwards. */
  private wireFromSelect = false;
  private resizeTarget: { id: Id; handle: string } | null = null;
  private erased = new Set<Id>();

  constructor(private ed: EditorController) {}

  private get ui() {
    return useUI.getState();
  }

  private snapPt(p: Pt): Pt {
    return { x: snap(p.x, GRID), y: snap(p.y, GRID) };
  }

  private zoom() {
    return this.ed.viewport().zoom;
  }

  // -------------------------------------------------------------------------

  down(p: PointerInfo) {
    const ui = this.ui;
    this.startScreen = p.screen;
    this.startWorld = p.world;
    this.startVp = this.ed.viewport();

    // Double click detection (pointer capture breaks native dblclick targets).
    const now = performance.now();
    // Both clicks must use the same tool (a click right after placing a part is not a double click).
    const isDouble =
      now - this.lastClick.t < 350 &&
      Math.hypot(p.screen.x - this.lastClick.x, p.screen.y - this.lastClick.y) < 6 &&
      p.button === 0 &&
      this.lastClick.tool === ui.tool;
    this.lastClick = {
      t: isDouble ? 0 : now,
      x: p.screen.x,
      y: p.screen.y,
      target: p.targetId,
      tool: ui.tool,
    };
    if (isDouble) {
      this.doubleClick(p);
      return;
    }

    if (p.button === 1 || ui.spaceDown || ui.tool === 'pan') {
      this.mode = 'pan';
      return;
    }
    if (p.button === 2) {
      if (ui.wireDraft) this.finishWire();
      return;
    }

    if (ui.tool === 'select' && p.handle && this.ed.selection().length === 1) {
      const id = this.ed.selection()[0]!;
      const el = this.ed.project.getElement(this.ed.sheetId, id);
      if (el && !el.locked) {
        this.resizeTarget = { id, handle: p.handle };
        this.mode = el.type === 'line' ? 'line-edit' : 'resize';
        return;
      }
    }

    switch (ui.tool) {
      case 'select':
        return this.selectDown(p);
      case 'draw':
        this.mode = 'stroke';
        ui.set({ strokeDraft: [p.world.x, p.world.y, p.pressure] });
        return;
      case 'eraser':
        this.mode = 'erase';
        this.erased = new Set();
        this.eraseAt(p);
        return;
      case 'shape':
      case 'waveform':
      case 'frame':
        this.mode = 'rect-draw';
        return;
      case 'line':
        this.mode = 'line-draw';
        return;
      case 'note':
      case 'button':
        return this.createBoxAnnotation(ui.tool, this.snapPt(p.world));
      case 'image':
        window.dispatchEvent(new CustomEvent(PICK_IMAGE_EVENT, { detail: this.snapPt(p.world) }));
        return;
      case 'wire':
      case 'signal':
        return this.wireClick(this.snapPt(p.world));
      case 'place': {
        if (!ui.placing) return;
        const at = this.snapPt(p.world);
        const el = this.ed.placeComponent(
          ui.placing.symbolId,
          at,
          ui.placing.rot,
          ui.placing.mirror,
        );
        if (ui.placing.opts)
          this.ed.updateElement(el.id, { opts: { ...el.opts, ...ui.placing.opts } });
        return;
      }
      case 'block':
        this.mode = 'block-draw';
        return;
      case 'port':
      case 'label':
      case 'text':
        return this.createAnnotation(ui.tool, this.snapPt(p.world));
    }
  }

  private selectDown(p: PointerInfo) {
    const ed = this.ed;
    const elements = ed.elements();
    // Grabbing a pin starts a wire.
    const pin = pinAt(elements, ed.ctx, p.world.x, p.world.y, 6 / this.zoom());
    if (pin && !p.shift) {
      this.wireFromSelect = true;
      this.ui.set({ tool: 'wire', selection: [] });
      this.wireClick({ x: pin.x, y: pin.y });
      return;
    }
    if (p.targetId && p.mod && ed.followLink(p.targetId)) return;
    if (p.targetId) {
      const unit = p.alt ? p.targetId : topLevelUnit(elements, p.targetId);
      const sel = ed.selection();
      this.wasSelected = sel.includes(unit);
      if (p.shift || p.mod) {
        ed.select(this.wasSelected ? sel.filter((x) => x !== unit) : [...sel, unit]);
        this.mode = 'idle';
        return;
      }
      if (!this.wasSelected) ed.select([unit]);
      this.dragIds = ed.selection();
      this.downTarget = unit;
      const el = elements.find((e) => e.id === unit);
      this.segment =
        el?.type === 'wire' && this.dragIds.length === 1
          ? { wireId: el.id, index: nearestSegment(el, p.world.x, p.world.y) }
          : null;
      this.mode = 'maybe-drag';
      return;
    }
    if (!p.shift) ed.select([]);
    this.mode = 'marquee';
  }

  move(p: PointerInfo) {
    const ui = this.ui;
    const world = p.world;
    ui.set({ cursor: world });

    if (this.mode === 'pan') {
      this.ed.setViewport({
        ...this.startVp,
        x: this.startVp.x + p.screen.x - this.startScreen.x,
        y: this.startVp.y + p.screen.y - this.startScreen.y,
      });
      return;
    }

    if (ui.tool === 'select' || ui.tool === 'wire' || ui.tool === 'signal') {
      const pin = pinAt(this.ed.elements(), this.ed.ctx, world.x, world.y, 6 / this.zoom());
      const hp = ui.hoverPin;
      if (pin ? !hp || hp.x !== pin.x || hp.y !== pin.y : hp)
        ui.set({ hoverPin: pin ? { x: pin.x, y: pin.y } : null });
    }

    const dx = snap(world.x - this.startWorld.x, GRID);
    const dy = snap(world.y - this.startWorld.y, GRID);
    switch (this.mode) {
      case 'maybe-drag':
        if (Math.hypot(p.screen.x - this.startScreen.x, p.screen.y - this.startScreen.y) > 4) {
          const locked = this.ed.selectedElements().some((e) => e.locked);
          this.mode = locked ? 'idle' : this.segment ? 'segment' : 'drag';
        }
        return;
      case 'drag':
        ui.set({ drag: { ids: this.dragIds, dx, dy } });
        return;
      case 'segment':
        ui.set({ drag: { ids: this.dragIds, dx, dy, segment: this.segment! } });
        return;
      case 'marquee':
        ui.set({ marquee: rectFromPoints(this.startWorld, world) });
        return;
      case 'block-draw':
        ui.set({ blockDraft: rectFromPoints(this.snapPt(this.startWorld), this.snapPt(world)) });
        return;
      case 'rect-draw': {
        const a = p.alt ? this.startWorld : this.snapPt(this.startWorld);
        let b = p.alt ? world : this.snapPt(world);
        if (p.shift) {
          // Square / circle.
          const d = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
          b = { x: a.x + Math.sign(b.x - a.x || 1) * d, y: a.y + Math.sign(b.y - a.y || 1) * d };
        }
        ui.set({ rectDraft: rectFromPoints(a, b) });
        return;
      }
      case 'line-draw': {
        const a = p.alt ? this.startWorld : this.snapPt(this.startWorld);
        let b = p.alt ? world : this.snapPt(world);
        if (p.shift) b = snap45(a, b);
        ui.set({ lineDraft: [a.x, a.y, b.x, b.y] });
        return;
      }
      case 'stroke': {
        const d = ui.strokeDraft ?? [];
        const n = d.length;
        if (n >= 3 && Math.hypot(world.x - d[n - 3]!, world.y - d[n - 2]!) < 1 / this.zoom())
          return;
        ui.set({ strokeDraft: [...d, world.x, world.y, p.pressure] });
        return;
      }
      case 'erase':
        this.eraseAt(p);
        return;
      case 'resize':
      case 'line-edit':
        this.previewResize(p);
        return;
    }

    if (ui.wireDraft) {
      const c = this.snapPt(world);
      const d = ui.wireDraft;
      const n = d.pts.length;
      const lx = d.pts[n - 2]!;
      const ly = d.pts[n - 1]!;
      const hFirst = d.manual ? d.hFirst : Math.abs(c.x - lx) >= Math.abs(c.y - ly);
      if (c.x !== d.cursor.x || c.y !== d.cursor.y || hFirst !== d.hFirst)
        ui.set({ wireDraft: { ...d, cursor: c, hFirst } });
    } else if (
      ui.tool === 'place' ||
      ui.tool === 'port' ||
      ui.tool === 'label' ||
      ui.tool === 'text' ||
      ui.tool === 'block' ||
      ui.tool === 'note' ||
      ui.tool === 'button' ||
      ui.tool === 'image'
    ) {
      const g = this.snapPt(world);
      if (!ui.ghost || ui.ghost.x !== g.x || ui.ghost.y !== g.y) ui.set({ ghost: g });
    }
  }

  up(p: PointerInfo) {
    const ui = this.ui;
    const ed = this.ed;
    const mode = this.mode;
    this.mode = 'idle';
    switch (mode) {
      case 'drag': {
        const d = ui.drag;
        ui.set({ drag: null });
        if (d && (d.dx || d.dy)) {
          const elements = ed.elements();
          ed.applyElements(
            computeMove(elements, expandSelection(elements, d.ids), d.dx, d.dy, ed.ctx),
          );
        }
        return;
      }
      case 'segment': {
        const d = ui.drag;
        ui.set({ drag: null });
        if (d?.segment && (d.dx || d.dy)) {
          const w = ed.project.getElement(ed.sheetId, d.segment.wireId);
          if (w?.type === 'wire')
            ed.applyElements([{ ...w, pts: dragSegment(w, d.segment.index, d.dx, d.dy) }]);
        }
        return;
      }
      case 'maybe-drag':
        // Plain click on an already selected element of a multi-selection: keep only it.
        if (this.wasSelected && this.downTarget && ed.selection().length > 1)
          ed.select([this.downTarget]);
        return;
      case 'marquee': {
        const r = ui.marquee;
        ui.set({ marquee: null });
        if (!r || r.w + r.h < 2) return;
        const elements = ed.elements();
        // Left→right: elements fully inside. Right→left: everything touched.
        const crossing = p.world.x < this.startWorld.x;
        const hit = elements.filter((e) => {
          if (e.type === 'group') return false;
          const b = elementBBox(e, ed.ctx, elements);
          return crossing ? rectsIntersect(r, b) : rectContains(r, b);
        });
        const units = new Set(hit.map((e) => topLevelUnit(elements, e.id)));
        ed.select(p.shift ? [...new Set([...ed.selection(), ...units])] : [...units]);
        return;
      }
      case 'rect-draw':
        return this.finishRect();
      case 'line-draw':
        return this.finishLine();
      case 'stroke': {
        const d = ui.strokeDraft;
        ui.set({ strokeDraft: null });
        if (d && d.length >= 6) {
          const prefs = ui.prefs;
          ed.addElement({
            type: 'stroke',
            pts: d.map((v) => Math.round(v * 100) / 100),
            size: prefs.highlighter ? prefs.penSize * 5 : prefs.penSize,
            ...(prefs.highlighter ? { highlighter: true } : {}),
            ...(prefs.inkColor ? { style: { color: prefs.inkColor } } : {}),
          });
        }
        return;
      }
      case 'erase': {
        const ids = [...this.erased];
        this.erased = new Set();
        ui.set({ erasing: [] });
        if (ids.length) {
          ed.select(ids);
          ed.deleteSelection();
        }
        return;
      }
      case 'resize':
      case 'line-edit': {
        const r = ui.resize;
        ui.set({ resize: null });
        this.resizeTarget = null;
        if (!r) return;
        const el = ed.project.getElement(ed.sheetId, r.id);
        if (!el) return;
        const patch: Record<string, unknown> = {};
        if (r.rect) Object.assign(patch, r.rect);
        if (r.pts) patch.pts = r.pts;
        if (r.bend !== undefined) patch.bend = Math.abs(r.bend) < 2 ? undefined : r.bend;
        ed.applyElements([{ ...el, ...patch } as Element]);
        return;
      }
      case 'block-draw': {
        const r = ui.blockDraft;
        ui.set({ blockDraft: null });
        const start = this.snapPt(this.startWorld);
        const rect = r && r.w >= 40 && r.h >= 40 ? r : { x: start.x, y: start.y, w: 140, h: 100 };
        const n = ed.elements().filter((e) => e.type === 'block').length + 1;
        const block = ed.commit(() => createBlock(ed.project, ed.sheetId, rect, `Block ${n}`));
        ui.set({
          tool: 'select',
          ghost: null,
          selection: [block.id],
          inlineEdit: { id: block.id, field: 'title' },
        });
        return;
      }
    }
  }

  private doubleClick(p: PointerInfo) {
    const ui = this.ui;
    const ed = this.ed;
    if (ui.wireDraft) {
      this.finishWire();
      return;
    }
    if (ui.tool !== 'select' || !p.targetId) return;
    const el = ed.project.getElement(ed.sheetId, p.targetId);
    if (!el) return;
    const unit = topLevelUnit(ed.elements(), el.id);
    if (unit !== el.id) {
      // Double-click inside a group selects the element itself.
      ed.select([el.id]);
      return;
    }
    if (el.type === 'block') ed.enterBlock(el.id);
    else if (el.type === 'text') ui.set({ inlineEdit: { id: el.id, field: 'text' } });
    else if (el.type === 'label') ui.set({ inlineEdit: { id: el.id, field: 'text' } });
    else if (el.type === 'port') ui.set({ inlineEdit: { id: el.id, field: 'name' } });
    else if (el.type === 'note' || el.type === 'shape' || el.type === 'line')
      ui.set({ inlineEdit: { id: el.id, field: 'text' } });
    else if (el.type === 'button') ui.set({ inlineEdit: { id: el.id, field: 'label' } });
    else if (el.type === 'frame') ui.set({ inlineEdit: { id: el.id, field: 'name' } });
  }

  // -------------------------------------------------------------------------
  // Whiteboard tools
  // -------------------------------------------------------------------------

  private eraseAt(p: PointerInfo) {
    const id = p.hitTest();
    if (!id || this.erased.has(id)) return;
    const unit = topLevelUnit(this.ed.elements(), id);
    this.erased.add(unit);
    const all = expandSelection(this.ed.elements(), [...this.erased]);
    this.ui.set({ erasing: [...all] });
  }

  private previewResize(p: PointerInfo) {
    const t = this.resizeTarget;
    if (!t) return;
    const el = this.ed.project.getElement(this.ed.sheetId, t.id);
    if (!el) return;
    const w = p.alt ? p.world : this.snapPt(p.world);
    if (el.type === 'line') {
      const pts = [...el.pts];
      if (t.handle === 'p0' || t.handle === 'p1') {
        const i = t.handle === 'p0' ? 0 : 2;
        const other = { x: pts[2 - i]!, y: pts[3 - i]! };
        const q = p.shift ? snap45(other, w) : w;
        pts[i] = q.x;
        pts[i + 1] = q.y;
        this.ui.set({ resize: { id: el.id, pts } });
      } else {
        const [x1, y1, x2, y2] = pts as [number, number, number, number];
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        const bend =
          ((p.world.x - (x1 + x2) / 2) * -(y2 - y1) + (p.world.y - (y1 + y2) / 2) * (x2 - x1)) /
          len;
        this.ui.set({ resize: { id: el.id, bend: Math.round(bend) } });
      }
      return;
    }
    if (!isBox(el)) return;
    const dx =
      (p.alt ? p.world.x : snap(p.world.x, GRID)) -
      (p.alt ? this.startWorld.x : snap(this.startWorld.x, GRID));
    const dy =
      (p.alt ? p.world.y : snap(p.world.y, GRID)) -
      (p.alt ? this.startWorld.y : snap(this.startWorld.y, GRID));
    const keep = el.type === 'image' ? !p.shift : p.shift;
    const rect = resizeRect(
      { x: el.x, y: el.y, w: el.w, h: el.h },
      t.handle as Handle,
      dx,
      dy,
      GRID * 2,
      keep,
    );
    this.ui.set({ resize: { id: el.id, rect } });
  }

  private finishRect() {
    const ui = this.ui;
    const ed = this.ed;
    const r = ui.rectDraft;
    ui.set({ rectDraft: null });
    const tool = ui.tool;
    const start = this.snapPt(this.startWorld);
    const def =
      tool === 'waveform'
        ? { w: 320, h: 160 }
        : tool === 'frame'
          ? { w: 480, h: 320 }
          : { w: 120, h: 80 };
    const rect = r && r.w >= 10 && r.h >= 10 ? r : { x: start.x, y: start.y, ...def };
    let el: Element;
    if (tool === 'shape') {
      el = ed.addElement({
        type: 'shape',
        kind: ui.prefs.shapeKind,
        ...rect,
        ...(ui.prefs.sketch ? { sketch: true } : {}),
        ...(ui.prefs.inkColor ? { style: { color: ui.prefs.inkColor } } : {}),
      });
    } else if (tool === 'waveform') {
      el = ed.addElement({
        type: 'waveform',
        ...rect,
        layout: 'overlay',
        xLabel: 't',
        yLabel: 'v',
        grid: true,
        axes: true,
        traces: [
          {
            id: 't1',
            kind: 'sine',
            amp: 1,
            offset: 0,
            periods: 2,
            phase: 0,
            duty: 0.5,
            tau: 0.15,
            zeta: 0.3,
            ripple: 0.25,
            label: 'v(t)',
          },
        ],
      });
    } else {
      const n = ed.elements().filter((e) => e.type === 'frame').length + 1;
      el = ed.addElement({ type: 'frame', ...rect, name: `Frame ${n}` });
    }
    ui.set({ tool: 'select', selection: [el.id] });
  }

  private finishLine() {
    const ui = this.ui;
    const d = ui.lineDraft;
    ui.set({ lineDraft: null });
    if (!d || Math.hypot(d[2]! - d[0]!, d[3]! - d[1]!) < 5) return;
    const el = this.ed.addElement({
      type: 'line',
      pts: d,
      ...(ui.prefs.arrow ? { arrowEnd: true } : {}),
      ...(ui.prefs.sketch ? { sketch: true } : {}),
      ...(ui.prefs.inkColor ? { style: { color: ui.prefs.inkColor } } : {}),
    });
    this.ed.select([el.id]);
    ui.set({ tool: 'select' });
  }

  private createBoxAnnotation(tool: 'note' | 'button', at: Pt) {
    const ed = this.ed;
    const ui = this.ui;
    const el =
      tool === 'note'
        ? ed.addElement({
            type: 'note',
            x: at.x,
            y: at.y,
            w: 180,
            h: 130,
            text: '',
            color: '@yellow',
          })
        : ed.addElement({
            type: 'button',
            x: at.x,
            y: at.y,
            w: 150,
            h: 30,
            label: 'Open link',
            link: { kind: 'url', url: 'https://' },
          });
    ui.set({
      tool: 'select',
      ghost: null,
      selection: [el.id],
      inlineEdit: { id: el.id, field: tool === 'note' ? 'text' : 'label' },
    });
  }

  // -------------------------------------------------------------------------
  // Wires
  // -------------------------------------------------------------------------

  private isConnectionPoint(pt: Pt): boolean {
    const elements = this.ed.elements();
    if (pinAt(elements, this.ed.ctx, pt.x, pt.y, 0.5)) return true;
    for (const e of elements) {
      if (e.type !== 'wire') continue;
      for (let i = 0; i < e.pts.length; i += 2)
        if (samePt(e.pts[i]!, e.pts[i + 1]!, pt.x, pt.y)) return true;
      for (let i = 2; i < e.pts.length; i += 2) {
        if (onSegmentInterior(pt.x, pt.y, e.pts[i - 2]!, e.pts[i - 1]!, e.pts[i]!, e.pts[i + 1]!))
          return true;
      }
    }
    return false;
  }

  wireClick(pt: Pt) {
    const ui = this.ui;
    const d = ui.wireDraft;
    if (!d) {
      ui.set({ wireDraft: { pts: [pt.x, pt.y], cursor: pt, hFirst: true, manual: false } });
      return;
    }
    const n = d.pts.length;
    const last = { x: d.pts[n - 2]!, y: d.pts[n - 1]! };
    if (samePt(last.x, last.y, pt.x, pt.y)) {
      this.finishWire();
      return;
    }
    const seg = elbow(last, pt, d.hFirst);
    const pts = [...d.pts, ...seg.slice(2)];
    if (this.isConnectionPoint(pt)) {
      ui.set({ wireDraft: { ...d, pts } });
      this.finishWire();
      return;
    }
    ui.set({ wireDraft: { ...d, pts, manual: false } });
  }

  finishWire() {
    const ui = this.ui;
    const d = ui.wireDraft;
    ui.set({ wireDraft: null });
    if (d) {
      const pts = normalizeWire(d.pts);
      if (pts.length >= 4) {
        const kind = ui.tool === 'signal' ? 'signal' : 'power';
        this.ed.addElement({
          type: 'wire',
          pts,
          kind,
          ...(kind === 'signal' ? { arrow: 'end' as const } : {}),
        });
      }
    }
    if (this.wireFromSelect) {
      this.wireFromSelect = false;
      ui.set({ tool: 'select' });
    }
  }

  cancelWire() {
    this.finishWire();
  }

  flipBend() {
    const d = this.ui.wireDraft;
    if (d) this.ui.set({ wireDraft: { ...d, hFirst: !d.hFirst, manual: true } });
  }

  // -------------------------------------------------------------------------

  private createAnnotation(tool: 'port' | 'label' | 'text', at: Pt) {
    const ed = this.ed;
    const ui = this.ui;
    let el: Element;
    if (tool === 'port') {
      const n = ed.elements().filter((e) => e.type === 'port').length + 1;
      el = ed.addElement({ type: 'port', x: at.x, y: at.y, name: `P${n}`, dir: 'in' });
      ui.set({ inlineEdit: { id: el.id, field: 'name' } });
    } else if (tool === 'label') {
      el = ed.addElement({ type: 'label', x: at.x, y: at.y, text: 'net' });
      ui.set({ inlineEdit: { id: el.id, field: 'text' } });
    } else {
      el = ed.addElement({
        type: 'text',
        x: at.x,
        y: at.y,
        text: 'Text',
        size: 16,
        align: 'start',
      });
      ui.set({ inlineEdit: { id: el.id, field: 'text' } });
    }
    ui.set({ tool: 'select', ghost: null, selection: [el.id] });
  }
}

/** Constrain b so that the segment a→b is horizontal, vertical or at 45°. */
export function snap45(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy);
  return { x: snap(a.x + Math.cos(ang) * len, GRID), y: snap(a.y + Math.sin(ang) * len, GRID) };
}

export function wireDraftPoints(d: { pts: number[]; cursor: Pt; hFirst: boolean }): number[] {
  const n = d.pts.length;
  const last = { x: d.pts[n - 2]!, y: d.pts[n - 1]! };
  return [...d.pts, ...elbow(last, d.cursor, d.hFirst).slice(2)];
}
