import { useUI } from './ui';

/** Show a short message at the bottom of the editor ("Copied", "Nothing to copy"…). */
export function toast(text: string) {
  useUI.getState().set({ toast: { text, at: Date.now() } });
}
