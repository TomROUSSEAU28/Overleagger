import { Fragment } from 'react';
import { useEditor } from '../editor/context';
import { formatCombo } from '../shortcuts/keymap';
import { useKeymap } from '../shortcuts/useKeymap';
import { runAction } from '../shortcuts/useShortcuts';
import { useUI } from '../store/ui';
import { useToolGroups } from './toolDefs';

export function ToolRail() {
  const ed = useEditor();
  const tool = useUI((s) => s.tool);
  const keymap = useKeymap((s) => s.keymap);
  const groups = useToolGroups();
  return (
    <nav className="tool-rail" aria-label="Tools">
      {groups.map((group, gi) => (
        <Fragment key={gi}>
          {gi > 0 && <span className="rail-sep" />}
          {group.map((t) => {
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
        </Fragment>
      ))}
    </nav>
  );
}
