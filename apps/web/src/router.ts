import { useSyncExternalStore } from 'react';

export type Route =
  { page: 'dashboard' } | { page: 'editor'; projectId: string } | { page: 'gallery' };

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  const m = /^p\/([\w-]+)/.exec(h);
  if (m) return { page: 'editor', projectId: m[1]! };
  if (h.startsWith('gallery')) return { page: 'gallery' };
  return { page: 'dashboard' };
}

const subscribe = (fn: () => void) => {
  window.addEventListener('hashchange', fn);
  return () => window.removeEventListener('hashchange', fn);
};

export function useHash(): string {
  return useSyncExternalStore(subscribe, () => window.location.hash);
}

export const navigate = (hash: string) => {
  window.location.hash = hash;
};
