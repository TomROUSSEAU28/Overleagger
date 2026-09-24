import type { ShapeKind } from '@overleagger/core';
import { useUI } from '../store/ui';
import { INK_NAMES, THEMES, resolveColor } from '../theme';

const SHAPES: { kind: ShapeKind; label: string; icon: string }[] = [
  { kind: 'rect', label: 'Rectangle', icon: 'M3 5h14v10H3z' },
  { kind: 'ellipse', label: 'Ellipse', icon: 'M10 5a7 5 0 1 0 0.01 0z' },
  { kind: 'diamond', label: 'Diamond', icon: 'M10 3l7 7-7 7-7-7z' },
  { kind: 'triangle', label: 'Triangle', icon: 'M10 4l7 12H3z' },
];

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
        SHAPES.map((s) => (
          <button
            key={s.kind}
            type="button"
            className={`opt${prefs.shapeKind === s.kind ? ' active' : ''}`}
            title={s.label}
            onClick={() => set({ shapeKind: s.kind })}
          >
            <svg width={18} height={18} viewBox="0 0 20 20">
              <path
                d={s.icon}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                strokeLinejoin="round"
              />
            </svg>
          </button>
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
