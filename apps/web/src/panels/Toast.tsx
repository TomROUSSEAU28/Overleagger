import { useEffect } from 'react';
import { useUI } from '../store/ui';

export function Toast() {
  const t = useUI((s) => s.toast);
  useEffect(() => {
    if (!t) return;
    // A little longer when there is something to click.
    const id = window.setTimeout(
      () => useUI.getState().set({ toast: null }),
      t.action ? 5000 : 2400,
    );
    return () => window.clearTimeout(id);
  }, [t]);
  if (!t) return null;
  return (
    <div
      key={t.at}
      className={`toast${t.action ? ' with-action' : ''}`}
      role="status"
      data-testid="toast"
    >
      {t.text}
      {t.action && (
        <button
          type="button"
          onClick={() => {
            t.action!.run();
            useUI.getState().set({ toast: null });
          }}
          data-testid="toast-action"
        >
          {t.action.label}
        </button>
      )}
    </div>
  );
}
