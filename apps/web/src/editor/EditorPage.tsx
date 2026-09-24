import { roleAtLeast } from '@overleagger/core';
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
import { AccessBanner } from '../cloud/CollabUI';
import { CommentsPanel, CommentsTab } from '../comments/Comments';
import { Presentation } from '../present/Presentation';
import { Loading } from '../brand/Logo';
import { SymbolEditor } from '../symbol-editor/SymbolEditor';
import { StatusBar } from '../panels/StatusBar';
import { PanelReopen, PanelResizer } from '../panels/PanelResizer';
import { Toast } from '../panels/Toast';
import { ToolRail } from '../panels/ToolRail';
import { TopBar } from '../panels/TopBar';
import { useShortcuts } from '../shortcuts/useShortcuts';
import { api, useCloud } from '../cloud/cloud';
import { CloudSession } from '../cloud/session';
import { openProject, updateEntry } from '../storage/projects';
import { useUI } from '../store/ui';
import { THEMES } from '../theme';
import { EditorContext, useEditor } from './context';
import { EditorController } from './controller';

function EditorLayout() {
  const ed = useEditor();
  useShortcuts(ed);
  const modal = useUI((s) => s.modal);
  const presenting = useUI((s) => s.presenting);
  const left = useUI((s) => s.leftPanel);
  const right = useUI((s) => s.rightPanel);
  const leftWidth = useUI((s) => s.leftWidth);
  const rightWidth = useUI((s) => s.rightWidth);
  const tab = useUI((s) => s.leftTab);
  const theme = useUI((s) => s.theme);
  return (
    <div className="editor" data-theme={theme}>
      <TopBar />
      <AccessBanner />
      <div className="editor-main">
        <ToolRail />
        {left ? (
          <aside className="left-panel" style={{ width: leftWidth }}>
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
              <CommentsTab active={tab === 'comments'} />
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
            ) : tab === 'comments' ? (
              <CommentsPanel />
            ) : (
              <SheetsPanel />
            )}
          </aside>
        ) : (
          <PanelReopen side="left" />
        )}
        {left && <PanelResizer side="left" />}
        <main className="canvas-area">
          <Canvas />
        </main>
        {right && <PanelResizer side="right" />}
        {right ? (
          <aside className="right-panel" style={{ width: rightWidth }}>
            <PropertiesPanel />
          </aside>
        ) : (
          <PanelReopen side="right" />
        )}
      </div>
      <StatusBar />
      {modal === 'quickadd' && <QuickAdd />}
      {modal === 'help' && <HelpOverlay />}
      {modal === 'shortcuts' && <ShortcutsDialog />}
      {modal === 'export' && <ExportDialog />}
      {modal === 'symbol-editor' && <SymbolEditor />}
      {modal === 'save-template' && <SaveTemplateDialog />}
      {presenting && <Presentation />}
      <Toast />
      <SmallScreenNote />
    </div>
  );
}

/** Where the edited project lives. */
export type ProjectSource = { kind: 'local'; id: string } | { kind: 'cloud'; id: string };

interface Opened {
  ed: EditorController;
  close: () => void;
  source: ProjectSource;
}

/**
 * Keep the project list in sync with the document: name, date and thumbnail in the local index,
 * or the thumbnail on the server for cloud projects (editors and owners).
 */
function useIndexSync(opened: Opened | null) {
  useEffect(() => {
    if (!opened) return;
    const { ed, source } = opened;
    const project = ed.project;
    let t1: ReturnType<typeof setTimeout> | undefined;
    let t2: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => {
      if (source.kind === 'local') {
        clearTimeout(t1);
        t1 = setTimeout(
          () =>
            void updateEntry(source.id, { name: project.getMeta().name, updatedAt: Date.now() }),
          600,
        );
      }
      clearTimeout(t2);
      t2 = setTimeout(
        async () => {
          if (source.kind === 'cloud' && !roleAtLeast(ed.session?.role, 'editor')) return;
          const { renderSheetSvg } = await import('../export/render');
          const r = await renderSheetSvg(project, ed.ctx, project.rootSheetId, {
            theme: THEMES.paper,
            background: 'paper',
            latexRefs: true,
            margin: 16,
          });
          if (source.kind === 'local') await updateEntry(source.id, { thumbnail: r.svg });
          else
            await api('PATCH', `/api/projects/${source.id}`, { thumbnail: r.svg }).catch(
              () => undefined,
            );
        },
        source.kind === 'local' ? 2500 : 6000,
      );
    };
    const off = project.subscribe(onChange);
    return () => {
      off();
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [opened]);
}

async function openSource(source: ProjectSource): Promise<Opened> {
  if (source.kind === 'local') {
    const open = await openProject(source.id);
    const ed = new EditorController(open.project);
    return { ed, source, close: () => (ed.destroy(), open.close()) };
  }
  await useCloud.getState().init();
  if (!useCloud.getState().user) throw new Error('Please sign in to open this shared project.');
  const session = await CloudSession.open(source.id);
  const ed = new EditorController(session.project, session);
  return { ed, source, close: () => (ed.destroy(), session.close()) };
}

export function EditorPage({ source }: { source: ProjectSource }) {
  const [state, setState] = useState<Opened | { error: string } | null>(null);
  const key = `${source.kind}:${source.id}`;

  useEffect(() => {
    let alive = true;
    let opened: Opened | null = null;
    useUI.getState().resetEditor();
    openSource(source)
      .then((o) => {
        if (!alive) return o.close();
        opened = o;
        useUI.getState().set({ sheetId: o.ed.project.rootSheetId });
        // Handle for debugging from the console and for end-to-end tests.
        (window as unknown as { __overleagger?: unknown }).__overleagger = { ed: o.ed, ui: useUI };
        setState(o);
      })
      .catch(
        (e: unknown) => alive && setState({ error: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      alive = false;
      opened?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const ok = state && 'ed' in state ? state : null;
  useIndexSync(ok);
  // Tab title: the project's name.
  useEffect(() => {
    if (!ok) return;
    const p = ok.ed.project;
    const set = () => (document.title = `${p.getMeta().name} — Circuit Notebook`);
    set();
    const off = p.subscribe(set);
    return () => {
      off();
      document.title = 'Circuit Notebook';
    };
  }, [ok]);

  if (!state) return <Loading text="Opening project…" />;
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

/** On a phone: a word that the editor is made for a computer screen (can be closed). */
function SmallScreenNote() {
  const key = 'sb.smallScreenNote';
  const [closed, setClosed] = useState(() => {
    try {
      return sessionStorage.getItem(key) === 'closed';
    } catch {
      return false;
    }
  });
  if (closed) return null;
  return (
    <p className="small-screen-note">
      Circuit Notebook is made for a computer screen: on a phone you can look at projects, but
      drawing is much easier with a mouse.
      <button
        type="button"
        className="icon-btn"
        aria-label="Close"
        onClick={() => {
          setClosed(true);
          try {
            sessionStorage.setItem(key, 'closed');
          } catch {
            // private mode: it simply comes back next time
          }
        }}
      >
        ×
      </button>
    </p>
  );
}
