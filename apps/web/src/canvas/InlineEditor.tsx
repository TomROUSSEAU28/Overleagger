import { blockLayout, portTextPos, type Element } from '@overleagger/core';
import { useEffect, useRef, useState } from 'react';
import { useEditor, useSheetElements } from '../editor/context';
import { useUI, type Viewport } from '../store/ui';

function anchorOf(el: Element, ed: ReturnType<typeof useEditor>): { x: number; y: number } | null {
  switch (el.type) {
    case 'text':
      return { x: el.x, y: el.y - el.size };
    case 'label':
      return { x: el.x, y: el.y - 18 };
    case 'port': {
      const t = portTextPos(el);
      return { x: t.x - 40, y: t.y - 12 };
    }
    case 'block': {
      const l = blockLayout(el, ed.ctx.ports(el.childSheetId));
      return { x: l.x + 6, y: l.y + 6 };
    }
    case 'note':
    case 'shape':
    case 'button':
      return { x: el.x + 4, y: el.y + 4 };
    case 'frame':
      return { x: el.x, y: el.y - 24 };
    case 'line':
      return { x: (el.pts[0]! + el.pts[2]!) / 2 - 60, y: (el.pts[1]! + el.pts[3]!) / 2 - 14 };
    default:
      return null;
  }
}

/** Small text box floating over the canvas to edit an element's text in place. */
export function InlineEditor({ vp }: { vp: Viewport }) {
  const ed = useEditor();
  const edit = useUI((s) => s.inlineEdit);
  const sheetId = useUI((s) => s.sheetId) ?? ed.project.rootSheetId;
  const elements = useSheetElements(sheetId);
  const el = edit ? elements.find((e) => e.id === edit.id) : undefined;
  const ref = useRef<HTMLTextAreaElement>(null);
  const initial = el ? String((el as unknown as Record<string, unknown>)[edit!.field] ?? '') : '';
  const [value, setValue] = useState(initial);

  useEffect(() => {
    setValue(initial);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit?.id, edit?.field]);

  if (!edit || !el) return null;
  const a = anchorOf(el, ed);
  if (!a) return null;
  const multiline = el.type === 'text' || el.type === 'note';
  const close = (save: boolean) => {
    if (save && value !== initial) {
      ed.commit(() => {
        if (el.type === 'block' && edit.field === 'title') ed.setBlockTitle(el.id, value);
        else
          ed.project.updateElement(ed.sheetId, el.id, { [edit.field]: value } as Partial<Element>);
      });
    }
    useUI.getState().set({ inlineEdit: null });
  };
  return (
    <textarea
      ref={ref}
      className="inline-editor"
      data-testid="inline-editor"
      style={{ left: a.x * vp.zoom + vp.x, top: a.y * vp.zoom + vp.y }}
      value={value}
      rows={multiline ? Math.max(2, value.split('\n').length) : 1}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => close(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') close(false);
        if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          close(true);
        }
      }}
      placeholder={multiline ? 'Text — use $…$ for LaTeX, Ctrl+Enter to finish' : ''}
    />
  );
}
