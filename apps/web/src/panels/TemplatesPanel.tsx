import { elementBBox, rectUnion, type SheetContext } from '@overleagger/core';
import { BookmarkPlus, Download, Pencil, Trash, Upload } from 'lucide-react';
import { memo, useMemo, useRef, useState } from 'react';
import { SheetRenderer } from '../canvas/render/SheetRenderer';
import { useEditor } from '../editor/context';
import { download } from '../storage/olg';
import { parseLibraryFile, useUserLib, type UserTemplate } from '../storage/userLibrary';
import { useUI } from '../store/ui';
import { THEMES, type Theme } from '../theme';
import { IconButton } from './common';

export const TEMPLATE_DND_TYPE = 'application/x-overleagger-template';

/** Context that also knows the template's own symbols and sub-sheets. */
function templateContext(t: UserTemplate, base: SheetContext): SheetContext {
  return {
    get standard() {
      return base.standard;
    },
    symbol: (id) => t.symbols.find((s) => s.id === id) ?? base.symbol(id),
    ports: (sheetId) =>
      (t.clip.sheets.find((s) => s.info.id === sheetId)?.elements ?? []).filter(
        (e) => e.type === 'port',
      ) as ReturnType<SheetContext['ports']>,
  };
}

/** Live preview in the current theme (so it always matches the paper and the standard). */
const TemplatePreview = memo(function TemplatePreview({
  t,
  theme,
  base,
}: {
  t: UserTemplate;
  theme: Theme;
  base: SheetContext;
}) {
  const ctx = useMemo(() => templateContext(t, base), [t, base]);
  const els = t.clip.elements;
  const box = rectUnion(
    els.filter((e) => e.type !== 'group').map((e) => elementBBox(e, ctx, els)),
  ) ?? { x: 0, y: 0, w: 100, h: 60 };
  const m = 10;
  return (
    <svg
      className="template-preview"
      viewBox={`${box.x - m} ${box.y - m} ${box.w + 2 * m} ${box.h + 2 * m}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ background: theme.paper }}
      aria-hidden
    >
      <SheetRenderer elements={els} o={{ theme, ctx, interactive: false, latexRefs: true }} />
    </svg>
  );
});

/** The user's own templates (personal library, shared by all projects). */
export function TemplatesPanel() {
  const ed = useEditor();
  const templates = useUserLib((s) => s.templates);
  const theme = THEMES[useUI((s) => s.theme)];
  const hasSelection = useUI((s) => s.selection.length > 0);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');

  const groups = useMemo(() => {
    const m = new Map<string, UserTemplate[]>();
    for (const t of [...templates].sort((a, b) => a.name.localeCompare(b.name))) {
      const list = m.get(t.category) ?? [];
      list.push(t);
      m.set(t.category, list);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [templates]);

  const exportLib = () => {
    const f = useUserLib.getState().exportFile();
    download(
      new Blob([JSON.stringify(f, null, 1)], { type: 'application/json' }),
      'my-circuit-notebook-library.olglib',
    );
  };
  const importLib = async (file: File) => {
    try {
      useUserLib.getState().importFile(parseLibraryFile(await file.text()));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="library-scroll pad" data-testid="templates">
      <button
        type="button"
        className="btn primary wide"
        disabled={!hasSelection}
        title={hasSelection ? '' : 'Select some elements on the sheet first'}
        onClick={() => useUI.getState().set({ modal: 'save-template' })}
        data-testid="save-template"
      >
        <BookmarkPlus size={15} /> Save selection as template
      </button>
      {templates.length === 0 && (
        <p className="muted small empty-hint">
          No template yet. Draw a circuit you often reuse (a converter, a control loop…), select it
          and save it here. Templates are kept in your personal library and are available in every
          project.
        </p>
      )}
      {groups.map(([cat, list]) => (
        <section key={cat}>
          <h4 className="lib-cat-title">{cat}</h4>
          {list.map((t) => (
            <div key={t.id} className="template-card-wrap">
              <button
                type="button"
                className="template-card"
                draggable
                data-testid={`template-${t.name}`}
                onDragStart={(e) => {
                  e.dataTransfer.setData(TEMPLATE_DND_TYPE, t.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => ed.insertTemplate(t)}
                title="Click to insert at the centre of the view, or drag onto the sheet"
              >
                <TemplatePreview t={t} theme={theme} base={ed.ctx} />
                <b>{t.name}</b>
                {t.description && <span>{t.description}</span>}
              </button>
              <div className="template-actions">
                <IconButton
                  title="Rename / change category"
                  onClick={() =>
                    useUI.getState().set({ modal: 'save-template', editingTemplate: t.id })
                  }
                >
                  <Pencil size={13} />
                </IconButton>
                <IconButton
                  title="Delete template"
                  onClick={() =>
                    confirm(`Delete the template “${t.name}”?`) &&
                    useUserLib.getState().removeTemplate(t.id)
                  }
                >
                  <Trash size={13} />
                </IconButton>
              </div>
            </div>
          ))}
        </section>
      ))}
      <div className="lib-io">
        <button type="button" className="btn" onClick={exportLib} title="Symbols and templates">
          <Download size={14} /> Export library
        </button>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          <Upload size={14} /> Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".olglib,.json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importLib(f);
            e.target.value = '';
          }}
        />
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
