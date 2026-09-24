import { useSyncExternalStore } from 'react';

export type Route =
  | { page: 'dashboard' }
  | { page: 'editor'; projectId: string }
  | { page: 'cloud'; projectId: string }
  | { page: 'invite'; token: string }
  | { page: 'auth'; token: string }
  | { page: 'example' }
  | { page: 'gallery' }
  | { page: 'people' }
  | { page: 'admin' };

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  const m = /^p\/([\w-]+)/.exec(h);
  if (m) return { page: 'editor', projectId: m[1]! };
  const c = /^cloud\/([\w-]+)/.exec(h);
  if (c) return { page: 'cloud', projectId: c[1]! };
  const i = /^invite\/([\w-]+)/.exec(h);
  if (i) return { page: 'invite', token: i[1]! };
  const a = /^auth\?token=([\w-]+)/.exec(h);
  if (a) return { page: 'auth', token: a[1]! };
  if (h.startsWith('gallery')) return { page: 'gallery' };
  if (h.startsWith('people')) return { page: 'people' };
  if (h.startsWith('admin')) return { page: 'admin' };
  if (h.startsWith('example')) return { page: 'example' };
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
