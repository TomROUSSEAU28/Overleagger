import { shapeGeometry, type ShapeKind } from '@overleagger/core';
import { SHAPE_KINDS } from './shapeKinds';
import { useUI } from '../store/ui';
import { INK_NAMES, THEMES, resolveColor } from '../theme';

/** Icon of a shape kind, drawn with the same geometry as the real shape. */
export function ShapeIcon({ kind, size = 18 }: { kind: ShapeKind; size?: number }) {
  const g = shapeGeometry({ kind, x: 1.5, y: 5, w: 17, h: 10 });
  return (
    <svg width={size} height={size} viewBox="0 0 20 20">
      <polygon
        points={g.outline.flat().join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {g.extras.map((e, i) => (
        <polyline
          key={i}
          points={e.flat().join(' ')}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.3}
        />
      ))}
    </svg>
  );
}

/** Small floating bar with the options of the drawing tools. */
export function ToolOptions() {
  const tool = useUI((s) => s.tool);
  const prefs = useUI((s) => s.prefs);
  const theme = THEMES[useUI((s) => s.theme)];
  if (tool !== 'shape' && tool !== 'line' && tool !== 'draw') return null;
  const set = (patch: Partial<typeof prefs>) =>
    useUI.getState().set({ prefs: { ...prefs, ...patch } });
  return (
    <div className="tool-options" data-testid="tool-options">
      {tool === 'shape' &&
        SHAPE_KINDS.map((s, i) => (
          <span key={s.kind} className="opt-wrap">
            {s.flow && !SHAPE_KINDS[i - 1]?.flow && <span className="sep" title="Flowchart" />}
            <button
              type="button"
              className={`opt${prefs.shapeKind === s.kind ? ' active' : ''}`}
              title={s.label}
              onClick={() => set({ shapeKind: s.kind })}
              data-testid={`shape-${s.kind}`}
            >
              <ShapeIcon kind={s.kind} />
            </button>
          </span>
        ))}
      {tool === 'line' && (
        <>
          <button
            type="button"
            className={`opt${!prefs.arrow ? ' active' : ''}`}
            title="Line"
            onClick={() => set({ arrow: false })}
          >
            <svg width={18} height={18} viewBox="0 0 20 20">
              <path d="M3 16L17 4" stroke="currentColor" strokeWidth={1.6} />
            </svg>
          </button>
          <button
            type="button"
            className={`opt${prefs.arrow ? ' active' : ''}`}
            title="Arrow"
            onClick={() => set({ arrow: true })}
          >
            <svg width={18} height={18} viewBox="0 0 20 20">
              <path d="M3 16L16 5M10 5h6v6" fill="none" stroke="currentColor" strokeWidth={1.6} />
            </svg>
          </button>
          <span className="sep" />
          <button
            type="button"
            className={`opt${(prefs.route ?? 'elbow') === 'elbow' ? ' active' : ''}`}
            title="Connectors between shapes: right angles (flowcharts)"
            onClick={() => set({ route: 'elbow' })}
            data-testid="route-elbow"
          >
            <svg width={18} height={18} viewBox="0 0 20 20">
              <path d="M3 5h7v10h7" fill="none" stroke="currentColor" strokeWidth={1.6} />
            </svg>
          </button>
          <button
            type="button"
            className={`opt${prefs.route === 'straight' ? ' active' : ''}`}
            title="Connectors between shapes: straight"
            onClick={() => set({ route: 'straight' })}
          >
            <svg width={18} height={18} viewBox="0 0 20 20">
              <path d="M3 5L17 15" fill="none" stroke="currentColor" strokeWidth={1.6} />
            </svg>
          </button>
        </>
      )}
      {(tool === 'shape' || tool === 'line') && (
        <button
          type="button"
          className={`opt text${prefs.sketch ? ' active' : ''}`}
          title="Hand-drawn look"
          onClick={() => set({ sketch: !prefs.sketch })}
        >
          sketch
        </button>
      )}
      {tool === 'draw' && (
        <>
          {[1.5, 3, 5, 8].map((sz) => (
            <button
              key={sz}
              type="button"
              className={`opt${prefs.penSize === sz ? ' active' : ''}`}
              title={`Pen ${sz}px`}
              onClick={() => set({ penSize: sz })}
            >
              <span className="dot" style={{ width: sz + 2, height: sz + 2 }} />
            </button>
          ))}
          <button
            type="button"
            className={`opt text${prefs.highlighter ? ' active' : ''}`}
            title="Highlighter"
            onClick={() => set({ highlighter: !prefs.highlighter })}
          >
            highlighter
          </button>
        </>
      )}
      <span className="sep" />
      <button
        type="button"
        className={`swatch small auto${!prefs.inkColor ? ' active' : ''}`}
        title="Theme ink"
        onClick={() => set({ inkColor: undefined })}
      >
        A
      </button>
      {INK_NAMES.slice(1).map((n) => (
        <button
          key={n}
          type="button"
          className={`swatch small${prefs.inkColor === `@${n}` ? ' active' : ''}`}
          title={n}
          style={{ background: resolveColor(`@${n}`, theme) }}
          onClick={() => set({ inkColor: `@${n}` })}
        />
      ))}
    </div>
  );
}
