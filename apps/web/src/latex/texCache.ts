import { useSyncExternalStore } from 'react';
import type * as EngineModule from './engine';
import type { TexSvg } from './engine';

type Engine = typeof EngineModule;

let engine: Engine | null = null;
let loading: Promise<Engine> | null = null;
let version = 0;
const listeners = new Set<() => void>();
const cache = new Map<string, TexSvg>();

/** Load MathJax (lazy, ~1 MB). Resolves when TeX can be rendered synchronously. */
export function loadTex(): Promise<Engine> {
  if (engine) return Promise.resolve(engine);
  if (!loading) {
    loading = import('./engine').then((m) => {
      engine = m;
      version++;
      for (const l of listeners) l();
      return m;
    });
  }
  return loading;
}

export function texReady(): boolean {
  return engine !== null;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useTexVersion(): number {
  const get = () => version;
  return useSyncExternalStore(subscribe, get, get);
}

/** Render TeX (cached). Returns undefined while MathJax is loading. */
export function renderTex(tex: string, display: boolean): TexSvg | undefined {
  if (!engine) {
    void loadTex();
    return undefined;
  }
  const key = `${display ? 'D' : 'I'}${tex}`;
  let hit = cache.get(key);
  if (!hit) {
    try {
      hit = engine.texToSvg(tex, display);
    } catch {
      hit = engine.texToSvg('\\text{?}', false);
    }
    cache.set(key, hit);
  }
  return hit;
}

/** Convert "text with $math$" into a single TeX string. */
export function mixedToTex(s: string): string {
  const parts = s.split('$');
  return parts.map((p, i) => (i % 2 === 1 ? p : plainToTex(p))).join('');
}

/** LaTeX special characters, written outside \text{} (inside it, MathJax shows them as typed). */
const SPECIAL: Record<string, string> = {
  '{': '\\{',
  '}': '\\}',
  '\\': '\\backslash ',
  '#': '\\#',
  '%': '\\%',
  '&': '\\&',
  _: '\\_',
  '^': '\\hat{}',
  '~': '\\sim ',
};

/** Plain text as LaTeX: `\text{…}` runs, and the special characters between them. */
function plainToTex(p: string): string {
  return p
    .split(/([{}\\#%&_^~])/)
    .map((c, i) => (i % 2 === 1 ? SPECIAL[c] : c ? `\\text{${c}}` : ''))
    .join('');
}

export const hasMath = (s: string) => /\$[^$]+\$/.test(s);

/** Width in px of a rendered formula (0 while loading). */
export function texWidth(tex: string, size: number, display = false): number {
  const r = renderTex(tex, display);
  return r ? (r.vb[2] / 1000) * size : 0;
}
