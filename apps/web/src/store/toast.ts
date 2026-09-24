import { useUI } from './ui';

/**
 * Show a short message at the bottom of the editor ("Copied", "Comment deleted"…), with an
 * optional action button such as "Undo".
 */
export function toast(text: string, action?: { label: string; run: () => void }) {
  useUI.getState().set({ toast: { text, at: Date.now(), ...(action ? { action } : {}) } });
}
