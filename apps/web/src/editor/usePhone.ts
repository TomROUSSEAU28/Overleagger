import { useSyncExternalStore } from 'react';

/** Narrow screens, and phones held sideways: the editor uses its phone layout. */
export const PHONE_QUERY = '(max-width: 760px), (pointer: coarse) and (max-height: 520px)';

const query = () =>
  typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(PHONE_QUERY) : null;

export function usePhone(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const q = query();
      q?.addEventListener('change', onChange);
      return () => q?.removeEventListener('change', onChange);
    },
    () => query()?.matches ?? false,
    () => false,
  );
}
