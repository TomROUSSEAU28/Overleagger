import { sheetPath } from '@overleagger/core';
import {
  ArrowLeft,
  ChevronRight,
  CircleQuestionMark,
  Download,
  Grid3x3,
  Keyboard,
  PanelLeft,
  PanelRight,
  Presentation,
  Redo2,
  Sparkles,
  Undo2,
} from 'lucide-react';
import { Logo } from '../brand/Logo';
import { CollabBar } from '../cloud/CollabUI';
import { useEditor, useMeta, useSheets, useUndoState } from '../editor/context';
import { useUI } from '../store/ui';
import { IconButton } from './common';
import { ThemePicker } from './ThemePicker';

export function Breadcrumbs() {
  const ed = useEditor();
  useSheets();
  const sheetId = useUI((s) => s.sheetId) ?? ed.project.rootSheetId;
  const path = sheetPath(ed.project, sheetId);
  return (
    <nav className="breadcrumbs" aria-label="Sheet path" data-testid="breadcrumbs">
      {path.map((s, i) => (
        <span key={s.id} className="crumb">
          {i > 0 && <ChevronRight size={13} className="sep" />}
          <button
            type="button"
            className={i === path.length - 1 ? 'current' : ''}
            onClick={() => ed.openSheet(s.id)}
          >
            {s.name || 'Untitled'}
          </button>
        </span>
      ))}
    </nav>
  );
}

export function TopBar() {
  const ed = useEditor();
  const meta = useMeta();
  const { canUndo, canRedo } = useUndoState();
  const showGrid = useUI((s) => s.showGrid);
  const animations = useUI((s) => s.animations);
  const left = useUI((s) => s.leftPanel);
  const right = useUI((s) => s.rightPanel);
  const ui = useUI.getState;
  return (
    <header className="topbar">
      <a className="brand" href="#/" title="All projects">
        <ArrowLeft size={16} />
        <Logo size={22} />
        <span className="logo">Circuit Notebook</span>
      </a>
      <input
        className="project-name"
        value={meta.name}
        aria-label="Project name"
        onChange={(e) => ed.project.setMeta({ name: e.target.value })}
        data-testid="project-name"
      />
      <Breadcrumbs />
      <div className="spacer" />
      <CollabBar />
      <div className="segmented" role="group" aria-label="Drawing standard">
        {(['IEC', 'ANSI'] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={meta.standard === s ? 'active' : ''}
            title={s === 'IEC' ? 'European symbols (IEC 60617)' : 'US symbols (IEEE 315 / ANSI)'}
            onClick={() => ed.project.setMeta({ standard: s })}
            data-testid={`standard-${s}`}
          >
            {s === 'IEC' ? 'EU' : 'US'}
          </button>
        ))}
      </div>
      <IconButton
        title="Undo (Ctrl Z)"
        onClick={() => ed.doUndo()}
        disabled={!canUndo}
        testId="undo"
      >
        <Undo2 size={17} />
      </IconButton>
      <IconButton
        title="Redo (Ctrl Shift Z)"
        onClick={() => ed.doRedo()}
        disabled={!canRedo}
        testId="redo"
      >
        <Redo2 size={17} />
      </IconButton>
      <span className="divider" />
      <IconButton
        title="Grid (G)"
        active={showGrid}
        onClick={() => ui().setSetting('showGrid', !showGrid)}
      >
        <Grid3x3 size={17} />
      </IconButton>
      <ThemePicker />
      <IconButton
        title={animations ? 'Animations: on' : 'Animations: off'}
        active={animations}
        onClick={() => ui().setSetting('animations', !animations)}
        testId="toggle-animations"
      >
        <Sparkles size={17} />
      </IconButton>
      <IconButton
        title="Library panel"
        active={left}
        onClick={() => ui().setSetting('leftPanel', !left)}
      >
        <PanelLeft size={17} />
      </IconButton>
      <IconButton
        title="Properties panel"
        active={right}
        onClick={() => ui().setSetting('rightPanel', !right)}
      >
        <PanelRight size={17} />
      </IconButton>
      <span className="divider" />
      <IconButton
        title="Keyboard shortcuts"
        onClick={() => ui().set({ modal: 'shortcuts' })}
        testId="open-shortcuts"
      >
        <Keyboard size={17} />
      </IconButton>
      <IconButton title="Help (?)" onClick={() => ui().set({ modal: 'help' })}>
        <CircleQuestionMark size={17} />
      </IconButton>
      <button
        type="button"
        className="btn"
        onClick={() => ui().set({ presenting: true })}
        title="Present: frames and sheets become slides (F5)"
        data-testid="present"
      >
        <Presentation size={15} /> <span className="btn-label">Present</span>
      </button>
      <button
        type="button"
        className="btn primary"
        onClick={() => ui().set({ modal: 'export' })}
        data-testid="open-export"
      >
        <Download size={15} /> <span className="btn-label">Export</span>
      </button>
    </header>
  );
}
