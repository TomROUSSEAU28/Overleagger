/**
 * A small bar over a text field: put `$…$` around the text, and insert the usual LaTeX pieces
 * (fraction, index, root, Greek letters…) without typing them.
 */
import { useRef, useState, type RefObject } from 'react';
import { insertSnippet, MORE_SNIPPETS, SNIPPETS, toggleDollars } from './mathEdit';
import { useApply, useToggleDollars, type Field } from './useMathEdit';

/** Keeps the focus in the text field when a button is pressed (the inline editor closes on blur). */
const keepFocus = (e: { preventDefault(): void }) => e.preventDefault();

export function MathBar({
  input,
  onChange,
  compact = false,
}: {
  input: RefObject<Field | null>;
  onChange: (value: string) => void;
  /** Fewer buttons (small fields). */
  compact?: boolean;
}) {
  const apply = useApply(input, onChange);
  const [more, setMore] = useState(false);
  const main = compact ? SNIPPETS.slice(0, 4) : SNIPPETS;
  return (
    <div className="math-bar" onMouseDown={keepFocus} data-testid="math-bar">
      <button
        type="button"
        className="math-btn dollars"
        title="Math: put $…$ around the selection, or the line (Ctrl+M)"
        onClick={() => apply(toggleDollars)}
        data-testid="math-dollars"
      >
        $…$
      </button>
      {main.map((s) => (
        <button
          key={s.tex}
          type="button"
          className="math-btn"
          title={s.title}
          onClick={() => apply((v, a, b) => insertSnippet(v, a, b, s))}
          data-testid={`math-${s.tex.replace(/[^a-z]/gi, '') || s.label}`}
        >
          {s.label}
        </button>
      ))}
      <button
        type="button"
        className={`math-btn${more ? ' active' : ''}`}
        title="More symbols"
        aria-expanded={more}
        onClick={() => setMore(!more)}
        data-testid="math-more"
      >
        ⋯
      </button>
      {more && (
        <div className="math-more" role="menu">
          {MORE_SNIPPETS.map((g) => (
            <div key={g.name} className="math-group">
              <span className="math-group-name">{g.name}</span>
              <div className="math-grid">
                {g.items.map((s) => (
                  <button
                    key={s.tex}
                    type="button"
                    className="math-btn"
                    title={s.title}
                    onClick={() => {
                      apply((v, a, b) => insertSnippet(v, a, b, s));
                      setMore(false);
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A text area with the math bar above it (Ctrl+M wraps in `$…$`). */
export function MathTextarea({
  value,
  onChange,
  rows = 4,
}: {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const toggle = useToggleDollars(ref, onChange);
  return (
    <div className="math-field">
      <MathBar input={ref} onChange={onChange} />
      <textarea
        ref={ref}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key.toLowerCase() === 'm' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.stopPropagation();
            toggle();
          }
        }}
      />
    </div>
  );
}
