import { Box, Hand, LogIn, MousePointer2, MoveRight, Spline, Tag, Type } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEditor } from '../editor/context';
import { runAction } from '../shortcuts/useShortcuts';
import { formatCombo, type ActionId } from '../shortcuts/keymap';
import { useKeymap } from '../shortcuts/useKeymap';
import { useUI, type ToolId } from '../store/ui';

const TOOLS: { tool: ToolId; action: ActionId; label: string; icon: ReactNode }[] = [
  { tool: 'select', action: 'tool.select', label: 'Select', icon: <MousePointer2 size={18} /> },
  { tool: 'pan', action: 'tool.pan', label: 'Pan', icon: <Hand size={18} /> },
  { tool: 'wire', action: 'tool.wire', label: 'Wire', icon: <Spline size={18} /> },
  { tool: 'signal', action: 'tool.signal', label: 'Signal line', icon: <MoveRight size={18} /> },
  { tool: 'block', action: 'tool.block', label: 'Hierarchical block', icon: <Box size={18} /> },
  { tool: 'port', action: 'tool.port', label: 'Sheet port', icon: <LogIn size={18} /> },
  { tool: 'label', action: 'tool.label', label: 'Net label', icon: <Tag size={18} /> },
  { tool: 'text', action: 'tool.text', label: 'Text / LaTeX', icon: <Type size={18} /> },
];

export function ToolRail() {
  const ed = useEditor();
  const tool = useUI((s) => s.tool);
  const keymap = useKeymap((s) => s.keymap);
  return (
    <nav className="tool-rail" aria-label="Tools">
      {TOOLS.map((t) => {
        const key = keymap[t.action]?.[0];
        return (
          <button
            key={t.tool}
            type="button"
            className={`tool-btn${tool === t.tool ? ' active' : ''}`}
            title={`${t.label}${key ? ` (${formatCombo(key)})` : ''}`}
            aria-label={t.label}
            aria-pressed={tool === t.tool}
            data-testid={`tool-${t.tool}`}
            onClick={() => runAction(ed, t.action)}
          >
            {t.icon}
          </button>
        );
      })}
    </nav>
  );
}
