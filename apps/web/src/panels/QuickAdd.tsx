import { librarySymbols, resolveSymbol, searchSymbols, defaultParams } from '@overleagger/symbols';
import { useMemo, useState } from 'react';
import { SymbolPreview } from '../canvas/render/SymbolGraphic';
import { useEditor, useMeta } from '../editor/context';
import { useUI } from '../store/ui';
import { DEFAULT_STROKE, THEMES } from '../theme';

/** Command-palette style part picker (A / Ctrl K). */
export function QuickAdd() {
  const ed = useEditor();
  const meta = useMeta();
  const theme = THEMES[useUI((s) => s.theme)];
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const results = useMemo(
    () => searchSymbols(q, [...librarySymbols, ...ed.project.getProjectSymbols()]).slice(0, 40),
    [q, ed],
  );
  const close = () => useUI.getState().set({ modal: null });
  const pick = (id: string) => {
    close();
    ed.startPlacing(id);
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="quickadd" role="dialog" aria-label="Add a part">
        <input
          autoFocus
          placeholder="Type to search parts and blocks…"
          value={q}
          data-testid="quickadd-input"
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIdx((i) => Math.min(results.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIdx((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter' && results[idx]) {
              pick(results[idx].id);
            } else if (e.key === 'Escape') {
              close();
            }
          }}
        />
        <ul className="quickadd-list">
          {results.map((s, i) => {
            const g = resolveSymbol(s, meta.standard);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className={i === idx ? 'active' : ''}
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => pick(s.id)}
                >
                  <SymbolPreview
                    prims={g.prims}
                    bbox={g.bbox}
                    ink={{ color: theme.ink, paper: theme.paper, width: DEFAULT_STROKE }}
                    size={30}
                    params={defaultParams(s)}
                  />
                  <span>{s.name}</span>
                  <span className="muted small">{s.category}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
