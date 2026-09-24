import {
  builtinSymbols,
  defaultParams,
  groupByCategory,
  resolveSymbol,
  searchSymbols,
  type AnySymbol,
  type Standard,
} from '@overleagger/symbols';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { SYMBOL_DND_TYPE } from '../canvas/Canvas';
import { SymbolPreview } from '../canvas/render/SymbolGraphic';
import { useEditor, useMeta } from '../editor/context';
import { useUI } from '../store/ui';
import { DEFAULT_STROKE, THEMES } from '../theme';

export const SymbolTile = memo(function SymbolTile({
  sym,
  standard,
  ink,
  paper,
  active,
  onPick,
}: {
  sym: AnySymbol;
  standard: Standard;
  ink: string;
  paper: string;
  active: boolean;
  onPick: (id: string) => void;
}) {
  const g = resolveSymbol(sym, standard);
  return (
    <button
      type="button"
      className={`symbol-tile${active ? ' active' : ''}`}
      title={sym.name}
      draggable
      data-testid={`symbol-${sym.id}`}
      onDragStart={(e) => {
        e.dataTransfer.setData(SYMBOL_DND_TYPE, sym.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => onPick(sym.id)}
    >
      <SymbolPreview
        prims={g.prims}
        bbox={g.bbox}
        ink={{ color: ink, paper, width: DEFAULT_STROKE * 1.2 }}
        size={46}
        params={defaultParams(sym)}
      />
      <span className="symbol-name">{sym.name}</span>
    </button>
  );
});

export function LibraryPanel() {
  const ed = useEditor();
  const meta = useMeta();
  const theme = THEMES[useUI((s) => s.theme)];
  const placing = useUI((s) => s.placing);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const all = useMemo(() => [...builtinSymbols, ...ed.project.getProjectSymbols()], [ed]);
  const groups = useMemo(() => groupByCategory(searchSymbols(query, all)), [query, all]);
  const pick = (id: string) => ed.startPlacing(id);

  return (
    <div className="library">
      <div className="search">
        <Search size={15} />
        <input
          type="search"
          placeholder="Search parts… (mosfet, pi, transformer)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="library-search"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && groups[0]?.[1][0]) pick(groups[0][1][0].id);
          }}
        />
      </div>
      <div className="library-scroll">
        {groups.map(([cat, syms]) => {
          const isCollapsed = collapsed[cat] && !query;
          return (
            <section key={cat} className="lib-cat">
              <button
                type="button"
                className="lib-cat-head"
                onClick={() => setCollapsed({ ...collapsed, [cat]: !collapsed[cat] })}
              >
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                <span>{cat}</span>
                <span className="count">{syms.length}</span>
              </button>
              {!isCollapsed && (
                <div className="tiles">
                  {syms.map((s) => (
                    <SymbolTile
                      key={s.id}
                      sym={s}
                      standard={meta.standard}
                      ink={theme.ink}
                      paper={theme.paper}
                      active={placing?.symbolId === s.id}
                      onPick={pick}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
        {groups.length === 0 && <p className="muted pad">No part matches “{query}”.</p>}
      </div>
    </div>
  );
}
