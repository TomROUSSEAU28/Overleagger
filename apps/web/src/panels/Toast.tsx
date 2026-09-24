import { useEffect } from 'react';
import { useUI } from '../store/ui';

export function Toast() {
  const t = useUI((s) => s.toast);
  useEffect(() => {
    if (!t) return;
    const id = window.setTimeout(() => useUI.getState().set({ toast: null }), 2400);
    return () => window.clearTimeout(id);
  }, [t]);
  if (!t) return null;
  return (
    <div key={t.at} className="toast" role="status" data-testid="toast">
      {t.text}
    </div>
  );
}
