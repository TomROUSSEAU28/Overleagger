import { Logo } from '../brand/Logo';
import {
  librarySymbols,
  defaultParams,
  groupByCategory,
  resolveSymbol,
  type OptionValue,
  type Standard,
  type SymbolDef,
} from '@overleagger/symbols';
import { SymbolPreview } from '../canvas/render/SymbolGraphic';
import { useTexVersion } from '../latex/texCache';
import { useUI } from '../store/ui';
import { DEFAULT_STROKE, THEMES } from '../theme';

/** Interesting option combinations shown for the power switches. */
const VARIANTS: Record<string, Record<string, OptionValue>[]> = {
  mosfet: [
    { channel: 'n', bodyDiode: false },
    { channel: 'n', bodyDiode: true },
    { channel: 'n', bodyDiode: true, circle: true },
    { channel: 'n', mode: 'dep', bodyDiode: false },
    { channel: 'n', mode: 'dep', bodyDiode: true, circle: true },
    { channel: 'p', bodyDiode: true },
    { channel: 'p', mode: 'dep', bodyDiode: false, circle: true },
    { channel: 'n', terminals: '4', bodyDiode: false },
  ],
  igbt: [
    { diode: false },
    { diode: true },
    { diode: true, circle: true },
    { channel: 'p', diode: true },
  ],
  bjt: [{ type: 'npn' }, { type: 'pnp' }, { type: 'npn', circle: false }],
  'half-bridge': [{ switch: 'mosfet' }, { switch: 'igbt' }],
};

function Cell({
  sym,
  standard,
  opts,
  label,
}: {
  sym: SymbolDef;
  standard: Standard;
  opts?: Record<string, OptionValue>;
  label?: string;
}) {
  const theme = THEMES[useUI((s) => s.theme)];
  const g = resolveSymbol(sym, standard, opts);
  return (
    <figure className="gallery-cell">
      <SymbolPreview
        prims={g.prims}
        bbox={g.bbox}
        ink={{ color: theme.ink, paper: theme.paper, width: DEFAULT_STROKE }}
        size={96}
        params={defaultParams(sym)}
      />
      <figcaption>{label ?? standard}</figcaption>
    </figure>
  );
}

export function Gallery() {
  useTexVersion();
  const theme = useUI((s) => s.theme);
  return (
    <div className="gallery" data-theme={theme} data-testid="gallery">
      <header className="dash-head">
        <div>
          <h1 className="logo big brand-title">
            <Logo size={34} /> Symbol gallery
          </h1>
          <p className="tagline">
            {librarySymbols.length} symbols · IEC 60617 (EU) and IEEE 315 / ANSI (US) ·{' '}
            <a href="#/">back to projects</a>
          </p>
        </div>
      </header>
      {groupByCategory(librarySymbols).map(([cat, syms]) => (
        <section key={cat}>
          <h2>{cat}</h2>
          <div className="gallery-grid">
            {(syms as SymbolDef[]).map((s) => (
              <div key={s.id} className="gallery-item">
                <h3>{s.name}</h3>
                <div className="gallery-row">
                  <Cell sym={s} standard="IEC" />
                  <Cell sym={s} standard="ANSI" />
                </div>
                {VARIANTS[s.id] && (
                  <div className="gallery-row wrap">
                    {VARIANTS[s.id]!.map((o, i) => (
                      <Cell
                        key={i}
                        sym={s}
                        standard="IEC"
                        opts={o}
                        label={Object.entries(o)
                          .map(([k, v]) => `${k}=${String(v)}`)
                          .join(' ')}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
