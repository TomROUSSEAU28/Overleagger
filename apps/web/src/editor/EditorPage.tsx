import { useEffect, useState } from 'react';
import { Canvas } from '../canvas/Canvas';
import { HelpOverlay, ShortcutsDialog } from '../panels/Shortcuts';
import { ExportDialog } from '../panels/ExportDialog';
import { LibraryPanel } from '../panels/LibraryPanel';
import { PropertiesPanel } from '../panels/PropertiesPanel';
import { QuickAdd } from '../panels/QuickAdd';
import { SheetsPanel } from '../panels/SheetsPanel';
import { SaveTemplateDialog } from '../panels/SaveTemplateDialog';
import { TemplatesPanel } from '../panels/TemplatesPanel';
import { SymbolEditor } from '../symbol-editor/SymbolEditor';
import { StatusBar } from '../panels/StatusBar';
import { ToolRail } from '../panels/ToolRail';
import { TopBar } from '../panels/TopBar';
import { useShortcuts } from '../shortcuts/useShortcuts';
import { openProject, updateEntry, type OpenProject } from '../storage/projects';
import { useUI } from '../store/ui';
import { THEMES } from '../theme';
import { EditorContext, useEditor } from './context';
import { EditorController } from './controller';

function EditorLayout() {
  const ed = useEditor();
  useShortcuts(ed);
  const modal = useUI((s) => s.modal);
  const left = useUI((s) => s.leftPanel);
  const right = useUI((s) => s.rightPanel);
  const tab = useUI((s) => s.leftTab);
  const theme = useUI((s) => s.theme);
  return (
    <div className="editor" data-theme={theme}>
      <TopBar />
      <div className="editor-main">
        <ToolRail />
        {left && (
          <aside className="left-panel">
            <div className="tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'library'}
                className={tab === 'library' ? 'active' : ''}
                onClick={() => useUI.getState().set({ leftTab: 'library' })}
              >
                Library
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'templates'}
                className={tab === 'templates' ? 'active' : ''}
                onClick={() => useUI.getState().set({ leftTab: 'templates' })}
                data-testid="tab-templates"
              >
                Templates
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'sheets'}
                className={tab === 'sheets' ? 'active' : ''}
                onClick={() => useUI.getState().set({ leftTab: 'sheets' })}
                data-testid="tab-sheets"
              >
                Sheets
              </button>
            </div>
            {tab === 'library' ? (
              <LibraryPanel />
            ) : tab === 'templates' ? (
              <TemplatesPanel />
            ) : (
              <SheetsPanel />
            )}
          </aside>
        )}
        <main className="canvas-area">
          <Canvas />
        </main>
        {right && (
          <aside className="right-panel">
            <PropertiesPanel />
          </aside>
        )}
      </div>
      <StatusBar />
      {modal === 'quickadd' && <QuickAdd />}
      {modal === 'help' && <HelpOverlay />}
      {modal === 'shortcuts' && <ShortcutsDialog />}
      {modal === 'export' && <ExportDialog />}
      {modal === 'symbol-editor' && <SymbolEditor />}
      {modal === 'save-template' && <SaveTemplateDialog />}
    </div>
  );
}

/** Keep the dashboard entry (name, date, thumbnail) in sync with the document. */
function useIndexSync(open: OpenProject | null, ed: EditorController | null) {
  useEffect(() => {
    if (!open || !ed) return;
    let t1: ReturnType<typeof setTimeout> | undefined;
    let t2: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => {
      clearTimeout(t1);
      t1 = setTimeout(
        () =>
          void updateEntry(open.id, { name: open.project.getMeta().name, updatedAt: Date.now() }),
        600,
      );
      clearTimeout(t2);
      t2 = setTimeout(async () => {
        const { renderSheetSvg } = await import('../export/render');
        const r = await renderSheetSvg(open.project, ed.ctx, open.project.rootSheetId, {
          theme: THEMES.paper,
          background: 'paper',
          latexRefs: true,
          margin: 16,
        });
        await updateEntry(open.id, { thumbnail: r.svg });
      }, 2500);
    };
    const off = open.project.subscribe(onChange);
    return () => {
      off();
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [open, ed]);
}

export function EditorPage({ projectId }: { projectId: string }) {
  const [state, setState] = useState<
    { open: OpenProject; ed: EditorController } | { error: string } | null
  >(null);

  useEffect(() => {
    let alive = true;
    let opened: { open: OpenProject; ed: EditorController } | null = null;
    useUI.getState().resetEditor();
    openProject(projectId)
      .then((open) => {
        const ed = new EditorController(open.project);
        if (!alive) {
          ed.destroy();
          open.close();
          return;
        }
        opened = { open, ed };
        useUI.getState().set({ sheetId: open.project.rootSheetId });
        // Handle for debugging from the console and for end-to-end tests.
        (window as unknown as { __overleagger?: unknown }).__overleagger = { ed, ui: useUI };
        setState(opened);
      })
      .catch(
        (e: unknown) => alive && setState({ error: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      alive = false;
      if (opened) {
        opened.ed.destroy();
        opened.open.close();
      }
    };
  }, [projectId]);

  const ok = state && 'open' in state ? state : null;
  useIndexSync(ok?.open ?? null, ok?.ed ?? null);

  if (!state) return <div className="loading">Opening project…</div>;
  if ('error' in state)
    return (
      <div className="loading">
        <p>{state.error}</p>
        <a href="#/">Back to projects</a>
      </div>
    );
  return (
    <EditorContext.Provider value={state.ed}>
      <EditorLayout />
    </EditorContext.Provider>
  );
}
