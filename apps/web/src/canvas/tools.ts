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
  type Element,
  type Id,
  type Pt,
} from '@overleagger/core';
import type { EditorController } from '../editor/controller';
import { useUI } from '../store/ui';

/** The tool controller of the mounted canvas (used by keyboard shortcuts). */
export const activeTools: { current: ToolController | null } = { current: null };

type Mode = 'idle' | 'pan' | 'maybe-drag' | 'drag' | 'segment' | 'marquee' | 'block-draw';

export interface PointerInfo {
  screen: Pt;
  world: Pt;
  button: number;
  shift: boolean;
  alt: boolean;
  mod: boolean;
  /** Element id under the pointer (from the DOM hit areas). */
  targetId: Id | null;
}

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
  private lastClick = { t: 0, x: 0, y: 0, target: null as Id | null };
  /** Wire drawing started from a pin with the select tool: go back to select afterwards. */
  private wireFromSelect = false;

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
    const isDouble =
      now - this.lastClick.t < 350 &&
      Math.hypot(p.screen.x - this.lastClick.x, p.screen.y - this.lastClick.y) < 6 &&
      p.button === 0;
    this.lastClick = { t: isDouble ? 0 : now, x: p.screen.x, y: p.screen.y, target: p.targetId };
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

    switch (ui.tool) {
      case 'select':
        return this.selectDown(p);
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
      ui.tool === 'block'
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

export function wireDraftPoints(d: { pts: number[]; cursor: Pt; hFirst: boolean }): number[] {
  const n = d.pts.length;
  const last = { x: d.pts[n - 2]!, y: d.pts[n - 1]! };
  return [...d.pts, ...elbow(last, d.cursor, d.hFirst).slice(2)];
}
