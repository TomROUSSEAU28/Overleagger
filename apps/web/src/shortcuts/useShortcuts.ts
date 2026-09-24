import { useEffect } from 'react';
import { activeTools } from '../canvas/tools';
import type { EditorController } from '../editor/controller';
import { copySheetImage } from '../export/copyImage';
import { toast } from '../store/toast';
import { useUI } from '../store/ui';
import { eventToCombo, type ActionId } from './keymap';
import { useKeymap } from './useKeymap';

export function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}

/** Execute an editor action (keyboard shortcut, menu or toolbar). */
const READ_ONLY_ACTIONS = new Set<ActionId>([
  'tool.select',
  'tool.pan',
  'edit.selectAll',
  'edit.cancel',
  'nav.enter',
  'nav.up',
  'view.fit',
  'view.zoomIn',
  'view.zoomOut',
  'view.zoomReset',
  'view.grid',
  'view.leftPanel',
  'view.rightPanel',
  'view.present',
  'file.export',
  'file.copyImage',
  'help.shortcuts',
]);

export function runAction(ed: EditorController, id: ActionId): boolean {
  // Read-only (viewer, commenter or locked sheet): only look, navigate, comment and export.
  if (!ed.canEdit() && !READ_ONLY_ACTIONS.has(id)) {
    if (id !== 'tool.comment' || !ed.project.canWrite(undefined, 'comments')) return false;
  }
  const ui = useUI.getState();
  const tools = activeTools.current;
  switch (id) {
    case 'tool.select':
      tools?.finishWire();
      ed.setTool('select');
      return true;
    case 'tool.pan':
      ed.setTool('pan');
      return true;
    case 'tool.wire':
      tools?.finishWire();
      ed.setTool('wire');
      return true;
    case 'tool.signal':
      tools?.finishWire();
      ed.setTool('signal');
      return true;
    case 'tool.block':
      ed.setTool('block');
      return true;
    case 'tool.port':
      ed.setTool('port');
      return true;
    case 'tool.label':
      ed.setTool('label');
      return true;
    case 'tool.text':
      ed.setTool('text');
      return true;
    case 'tool.draw':
      ed.setTool('draw');
      return true;
    case 'tool.eraser':
      ed.setTool('eraser');
      return true;
    case 'tool.shape':
      ed.setTool('shape');
      return true;
    case 'tool.line':
      ed.setTool('line');
      return true;
    case 'tool.note':
      ed.setTool('note');
      return true;
    case 'tool.image':
      ed.setTool('image');
      return true;
    case 'tool.button':
      ed.setTool('button');
      return true;
    case 'tool.waveform':
      ed.setTool('waveform');
      return true;
    case 'tool.frame':
      ed.setTool('frame');
      return true;
    case 'tool.comment':
      ed.setTool('comment');
      return true;
    case 'edit.toBlock':
      ed.selectionToBlock();
      return true;
    case 'edit.quickAdd':
      ui.set({ modal: 'quickadd' });
      return true;
    case 'edit.rotate':
      ed.rotate(false);
      return true;
    case 'edit.rotateCcw':
      ed.rotate(true);
      return true;
    case 'edit.mirrorX':
      ed.mirror('x');
      return true;
    case 'edit.mirrorY':
      ed.mirror('y');
      return true;
    case 'edit.delete':
      ed.deleteSelection();
      return true;
    case 'edit.duplicate':
      ed.duplicate();
      return true;
    case 'edit.undo':
      ed.doUndo();
      return true;
    case 'edit.redo':
      ed.doRedo();
      return true;
    case 'edit.selectAll':
      ed.selectAll();
      return true;
    case 'edit.group':
      ed.group();
      return true;
    case 'edit.ungroup':
      ed.ungroup();
      return true;
    case 'edit.front':
      ed.reorder('front');
      return true;
    case 'edit.back':
      ed.reorder('back');
      return true;
    case 'edit.nudgeLeft':
      ed.nudge(-1, 0);
      return true;
    case 'edit.nudgeRight':
      ed.nudge(1, 0);
      return true;
    case 'edit.nudgeUp':
      ed.nudge(0, -1);
      return true;
    case 'edit.nudgeDown':
      ed.nudge(0, 1);
      return true;
    case 'edit.nudgeLeftBig':
      ed.nudge(-5, 0);
      return true;
    case 'edit.nudgeRightBig':
      ed.nudge(5, 0);
      return true;
    case 'edit.nudgeUpBig':
      ed.nudge(0, -5);
      return true;
    case 'edit.nudgeDownBig':
      ed.nudge(0, 5);
      return true;
    case 'edit.cancel':
      if (ui.wireDraft) tools?.finishWire();
      else if (ui.tool !== 'select') ed.setTool('select');
      else if (ed.selection().length) ed.select([]);
      else ed.goUp();
      return true;
    case 'edit.rename': {
      const sel = ed.selection();
      const el = sel.length === 1 ? ed.project.getElement(ed.sheetId, sel[0]!) : undefined;
      if (!el) return false;
      const field =
        el.type === 'text' || el.type === 'label'
          ? 'text'
          : el.type === 'port'
            ? 'name'
            : el.type === 'block'
              ? 'title'
              : null;
      if (field) ui.set({ inlineEdit: { id: el.id, field } });
      return Boolean(field);
    }
    case 'nav.enter':
      if (ui.wireDraft) {
        tools?.finishWire();
        return true;
      }
      return ed.enterSelectedBlock();
    case 'nav.up':
      return ed.goUp();
    case 'view.fit':
      ed.fit();
      return true;
    case 'view.zoomIn':
      ed.zoomAt(1.25);
      return true;
    case 'view.zoomOut':
      ed.zoomAt(0.8);
      return true;
    case 'view.zoomReset':
      ed.zoomReset();
      return true;
    case 'view.grid':
      ui.setSetting('showGrid', !ui.showGrid);
      return true;
    case 'view.leftPanel':
      ui.setSetting('leftPanel', !ui.leftPanel);
      return true;
    case 'view.rightPanel':
      ui.setSetting('rightPanel', !ui.rightPanel);
      return true;
    case 'view.present':
      ui.set({ presenting: true, modal: null });
      return true;
    case 'file.export':
      ui.set({ modal: 'export' });
      return true;
    case 'file.copyImage': {
      const sel = ed.selection();
      // Called at once (not after a lazy import): the clipboard needs the key press "gesture".
      copySheetImage(ed, { only: sel }).then(
        () => toast(sel.length ? 'Selection copied as an image' : 'Sheet copied as an image'),
        (e: unknown) => toast(`Could not copy: ${e instanceof Error ? e.message : String(e)}`),
      );
      return true;
    }
    case 'help.shortcuts':
      ui.set({ modal: 'help' });
      return true;
    case 'wire.flipBend':
      tools?.flipBend();
      return Boolean(ui.wireDraft);
  }
}

/** Global keyboard + clipboard handling for the editor. */
export function useShortcuts(ed: EditorController) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      const ui = useUI.getState();
      if (e.key === ' ') {
        e.preventDefault();
        if (!e.repeat) ui.set({ spaceDown: true });
        return;
      }
      if (ui.modal) {
        if (e.key === 'Escape') ui.set({ modal: null });
        return;
      }
      const combo = eventToCombo(e);
      const action = useKeymap.getState().lookup.get(combo);
      if (!action) return;
      if (runAction(ed, action)) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') useUI.getState().set({ spaceDown: false });
    };
    const onBlur = () => useUI.getState().set({ spaceDown: false });
    const onCopy = (e: ClipboardEvent) => {
      if (isEditable(e.target) || useUI.getState().modal) return;
      const clip = ed.copy();
      if (!clip) return;
      e.clipboardData?.setData('text/plain', JSON.stringify(clip));
      e.preventDefault();
    };
    const onCut = (e: ClipboardEvent) => {
      if (isEditable(e.target) || useUI.getState().modal) return;
      const clip = ed.cut();
      if (!clip) return;
      e.clipboardData?.setData('text/plain', JSON.stringify(clip));
      e.preventDefault();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target) || useUI.getState().modal) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (ed.paste(text)) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
    };
  }, [ed]);
}
