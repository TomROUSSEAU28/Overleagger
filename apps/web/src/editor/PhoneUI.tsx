/**
 * The editor on a phone: the drawing takes the whole screen, a bar at the bottom opens the
 * panels as drawers, and a small bar of actions follows the selection.
 */
import { sheetPath } from '@overleagger/core';
import {
  BookOpen,
  Check,
  Copy,
  Download,
  FlipHorizontal2,
  Grid3x3,
  History,
  Layers,
  Maximize,
  MessageSquare,
  PackagePlus,
  Presentation,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { STAGE, versionLabel } from '../changelog';
import { useCanEdit } from '../cloud/hooks';
import { CommentsPanel } from '../comments/Comments';
import { useComments } from '../comments/hooks';
import { LibraryPanel } from '../panels/LibraryPanel';
import { PropertiesPanel } from '../panels/PropertiesPanel';
import { SheetsPanel } from '../panels/SheetsPanel';
import { TemplatesPanel } from '../panels/TemplatesPanel';
import { ThemePicker } from '../panels/ThemePicker';
import { TOOL_DEFS, useToolGroups } from '../panels/toolDefs';
import { Breadcrumbs } from '../panels/TopBar';
import { runAction } from '../shortcuts/useShortcuts';
import { useUI, type PhoneSheet, type ToolId } from '../store/ui';
import { useEditor, useMeta, useSheets } from './context';

const open = (sheet: PhoneSheet) =>
  useUI.getState().set({ phoneSheet: useUI.getState().phoneSheet === sheet ? null : sheet });
const close = () => {
  if (useUI.getState().phoneSheet) useUI.getState().set({ phoneSheet: null });
};

/** What to do with the current tool, in a few words (a finger has no hover). */
const HINTS: Partial<Record<ToolId, string>> = {
  pan: 'Drag to move around',
  comment: 'Tap where to leave a comment',
  wire: 'Tap pins to draw a wire · tap twice to finish',
  signal: 'Tap to draw a signal line · tap twice to finish',
  block: 'Drag to draw a block',
  port: 'Tap to place a sheet port',
  label: 'Tap to place a net label',
  text: 'Tap to place text',
  place: 'Tap where the part goes',
  draw: 'Draw with your finger',
  eraser: 'Rub over what to erase',
  shape: 'Drag to draw a shape',
  line: 'Drag to draw a line',
  note: 'Tap to stick a note',
  image: 'Tap where the image goes',
  button: 'Tap to place a link button',
  waveform: 'Drag to draw a waveform',
  frame: 'Drag to draw a frame',
};

/** Top of the drawing: where you are (sheets), and what the current tool does. */
export function PhoneOverlay() {
  const ed = useEditor();
  useSheets();
  const tool = useUI((s) => s.tool);
  const sheetId = useUI((s) => s.sheetId) ?? ed.project.rootSheetId;
  const deep = sheetPath(ed.project, sheetId).length > 1;
  const hint = HINTS[tool];
  return (
    <div className="phone-top">
      {deep && (
        <div className="phone-crumbs">
          <Breadcrumbs />
        </div>
      )}
      {hint && (
        <div className="phone-mode" data-testid="phone-mode">
          <span>{hint}</span>
          <button
            type="button"
            className="btn primary"
            onClick={() => runAction(ed, 'tool.select')}
            data-testid="phone-mode-done"
          >
            <Check size={15} /> Done
          </button>
        </div>
      )}
    </div>
  );
}

/** Actions on the selection, above the bottom bar. */
export function PhoneSelectionBar() {
  const ed = useEditor();
  const count = useUI((s) => s.selection.length);
  const tool = useUI((s) => s.tool);
  const sheet = useUI((s) => s.phoneSheet);
  const canEdit = useCanEdit();
  if (!count || !canEdit || tool !== 'select' || sheet) return null;
  const act = (label: string, icon: ReactNode, run: () => void, testId: string, danger = false) => (
    <button
      type="button"
      className={`phone-act${danger ? ' danger' : ''}`}
      onClick={run}
      aria-label={label}
      data-testid={testId}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
  return (
    <div className="phone-selection" data-testid="phone-selection">
      {act('Rotate', <RotateCw size={18} />, () => runAction(ed, 'edit.rotate'), 'phone-rotate')}
      {act(
        'Mirror',
        <FlipHorizontal2 size={18} />,
        () => runAction(ed, 'edit.mirrorX'),
        'phone-mirror',
      )}
      {act('Copy', <Copy size={18} />, () => runAction(ed, 'edit.duplicate'), 'phone-duplicate')}
      {act('Edit', <SlidersHorizontal size={18} />, () => open('edit'), 'phone-edit')}
      {act(
        'Delete',
        <Trash2 size={18} />,
        () => runAction(ed, 'edit.delete'),
        'phone-delete',
        true,
      )}
    </div>
  );
}

/** The bar at the bottom: tools, parts, sheets, comments, settings of the selection. */
export function PhoneBar() {
  const tool = useUI((s) => s.tool);
  const sheet = useUI((s) => s.phoneSheet);
  const selected = useUI((s) => s.selection.length > 0);
  const canEdit = useCanEdit();
  const comments = useComments().filter((t) => !t.resolved).length;
  const current = TOOL_DEFS.find((t) => t.tool === tool) ?? TOOL_DEFS[0]!;
  const item = (id: Exclude<PhoneSheet, null>, label: string, icon: ReactNode, badge?: number) => (
    <button
      type="button"
      className={`phone-tab${sheet === id ? ' active' : ''}`}
      onClick={() => open(id)}
      aria-pressed={sheet === id}
      data-testid={`phone-${id}`}
    >
      {icon}
      {badge ? <i className="tab-badge">{badge}</i> : null}
      <span>{label}</span>
    </button>
  );
  return (
    <nav className="phone-bar" aria-label="Editor">
      {item('tools', 'Tools', tool === 'place' ? <PackagePlus size={20} /> : current.icon)}
      {canEdit && item('parts', 'Parts', <PackagePlus size={20} />)}
      {item('sheets', 'Sheets', <Layers size={20} />)}
      {item('comments', 'Comments', <MessageSquare size={20} />, comments)}
      {item('edit', selected ? 'Selection' : 'Sheet', <SlidersHorizontal size={20} />)}
    </nav>
  );
}

function ToolsGrid() {
  const ed = useEditor();
  const tool = useUI((s) => s.tool);
  const groups = useToolGroups();
  return (
    <div className="phone-tools">
      {groups.flat().map((t) => (
        <button
          key={t.tool}
          type="button"
          className={tool === t.tool ? 'active' : ''}
          onClick={() => {
            runAction(ed, t.action);
            close();
          }}
          data-testid={`phone-tool-${t.tool}`}
        >
          {t.icon}
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

function MoreSettings() {
  const ed = useEditor();
  const meta = useMeta();
  const showGrid = useUI((s) => s.showGrid);
  const animations = useUI((s) => s.animations);
  const ui = useUI.getState;
  const row = (icon: ReactNode, label: string, run: () => void, testId?: string) => (
    <button type="button" className="phone-row" onClick={run} data-testid={testId}>
      {icon}
      <span>{label}</span>
    </button>
  );
  return (
    <div className="phone-more">
      <div className="phone-row static">
        <span>Symbols</span>
        <div className="segmented" role="group" aria-label="Drawing standard">
          {(['IEC', 'ANSI'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={meta.standard === s ? 'active' : ''}
              onClick={() => ed.project.setMeta({ standard: s })}
            >
              {s === 'IEC' ? 'EU (IEC)' : 'US (ANSI)'}
            </button>
          ))}
        </div>
      </div>
      <div className="phone-row static">
        <span>Theme</span>
        <ThemePicker />
      </div>
      {row(<Maximize size={18} />, 'Fit the drawing to the screen', () => {
        ed.fit();
        close();
      })}
      {row(<Grid3x3 size={18} />, showGrid ? 'Hide the grid' : 'Show the grid', () =>
        ui().setSetting('showGrid', !showGrid),
      )}
      {row(<Sparkles size={18} />, animations ? 'Animations: on' : 'Animations: off', () =>
        ui().setSetting('animations', !animations),
      )}
      {row(
        <Presentation size={18} />,
        'Present',
        () => ui().set({ phoneSheet: null, presenting: true }),
        'phone-present',
      )}
      {row(
        <Download size={18} />,
        'Export (PDF, image, LaTeX…)',
        () => ui().set({ phoneSheet: null, modal: 'export' }),
        'phone-export',
      )}
      {row(<History size={18} />, `What's new (${versionLabel()} ${STAGE})`, () =>
        ui().set({ phoneSheet: null, modal: 'whatsnew' }),
      )}
      <a className="phone-row" href="../manual/" target="_blank" rel="noopener">
        <BookOpen size={18} />
        <span>User manual</span>
      </a>
    </div>
  );
}

function PartsDrawer() {
  const tab = useUI((s) => s.leftTab);
  const templates = tab === 'templates';
  // Once a part is picked, or a template dropped, get out of the way of the drawing.
  useEffect(() => {
    const start = useUI.getState();
    return useUI.subscribe((s) => {
      if ((s.placing && s.placing !== start.placing) || s.selection !== start.selection) close();
    });
  }, []);
  return (
    <>
      <div className="segmented phone-parts-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className={templates ? '' : 'active'}
          aria-selected={!templates}
          onClick={() => useUI.getState().set({ leftTab: 'library' })}
        >
          Parts
        </button>
        <button
          type="button"
          role="tab"
          className={templates ? 'active' : ''}
          aria-selected={templates}
          onClick={() => useUI.getState().set({ leftTab: 'templates' })}
        >
          Templates
        </button>
      </div>
      {templates ? <TemplatesPanel /> : <LibraryPanel />}
    </>
  );
}

/** Closes the drawer when `pick` changes (a sheet opened, a thread opened…). */
function useCloseOn<T>(pick: (s: ReturnType<typeof useUI.getState>) => T, when = (v: T) => !!v) {
  useEffect(() => {
    const first = pick(useUI.getState());
    return useUI.subscribe((s) => {
      const v = pick(s);
      if (v !== first && when(v)) close();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function SheetsDrawer() {
  useCloseOn((s) => s.sheetId);
  return <SheetsPanel />;
}

function CommentsDrawer() {
  useCloseOn((s) => s.openThread);
  return <CommentsPanel />;
}

const TITLES: Record<Exclude<PhoneSheet, null>, string> = {
  tools: 'Tools',
  parts: 'Add',
  sheets: 'Sheets',
  comments: 'Comments',
  edit: 'Settings',
  more: 'More',
};

export function PhoneDrawer() {
  const sheet = useUI((s) => s.phoneSheet);
  const selected = useUI((s) => s.selection.length > 0);
  if (!sheet) return null;
  const body =
    sheet === 'tools' ? (
      <ToolsGrid />
    ) : sheet === 'parts' ? (
      <PartsDrawer />
    ) : sheet === 'sheets' ? (
      <SheetsDrawer />
    ) : sheet === 'comments' ? (
      <CommentsDrawer />
    ) : sheet === 'edit' ? (
      <PropertiesPanel />
    ) : (
      <MoreSettings />
    );
  return (
    <>
      <div className="phone-scrim" onClick={close} />
      <section
        className={`phone-drawer ${sheet}`}
        role="dialog"
        aria-label={TITLES[sheet]}
        data-testid="phone-drawer"
      >
        <header>
          <b>{sheet === 'edit' && selected ? 'Selection' : TITLES[sheet]}</b>
          <button type="button" className="icon-btn" aria-label="Close" onClick={close}>
            <X size={18} />
          </button>
        </header>
        <div className="phone-drawer-body">{body}</div>
      </section>
    </>
  );
}
