import { GRID } from '@overleagger/core';
import { useEditor } from '../editor/context';
import { useUI, type ToolId } from '../store/ui';

const HINTS: Record<ToolId, string> = {
  select:
    'Click to select · drag to move · drag a pin end to start a wire · double-click a block to open it',
  pan: 'Drag to pan the view',
  wire: 'Click to add bends · click a pin or wire to connect · double-click or Esc to finish · / flips the bend',
  signal: 'Signal line with arrow · click to add bends · double-click or Esc to finish',
  block: 'Drag to draw a hierarchical block (or click for a default size)',
  port: 'Click to place a sheet port — it becomes a pin on the parent block',
  label: 'Click to place a net label — labels with the same name are connected',
  text: 'Click to place text — use $…$ for LaTeX',
  place: 'Click to place · R rotate · X / Y mirror · Esc to stop',
};

export function StatusBar() {
  const ed = useEditor();
  const cursor = useUI((s) => s.cursor);
  const tool = useUI((s) => s.tool);
  const sheetId = useUI((s) => s.sheetId) ?? ed.project.rootSheetId;
  const zoom = useUI((s) => s.viewports[sheetId]?.zoom ?? 1);
  const count = useUI((s) => s.selection.length);
  return (
    <footer className="statusbar" data-testid="statusbar">
      <span className="hint">{HINTS[tool]}</span>
      <span className="spacer" />
      {count > 0 && <span>{count} selected</span>}
      <span className="mono">
        {cursor ? `${(cursor.x / GRID).toFixed(1)}, ${(cursor.y / GRID).toFixed(1)}` : '—'}
      </span>
      <button type="button" className="link mono" title="Zoom to fit (F)" onClick={() => ed.fit()}>
        {Math.round(zoom * 100)} %
      </button>
    </footer>
  );
}
