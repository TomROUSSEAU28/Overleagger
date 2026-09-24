import { useEffect, useRef, type ReactNode } from 'react';
import { formatCombo } from '../shortcuts/keymap';

export function IconButton({
  title,
  onClick,
  active,
  disabled,
  children,
  testId,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-btn${active ? ' active' : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

export function Kbd({ combo }: { combo: string }) {
  return <kbd className="kbd">{formatCombo(combo)}</kbd>;
}

export function Modal({
  title,
  onClose,
  children,
  wide,
  escapeCloses = true,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** Dialogs that use Escape themselves (symbol editor) turn this off. */
  escapeCloses?: boolean;
}) {
  // Escape closes the dialog (captured first so the editor shortcuts do not see it).
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!escapeCloses) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      close.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [escapeCloses]);
  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
          >
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}
