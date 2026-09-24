/**
 * Personal library (all projects): the user's own symbols and templates.
 *
 * Stored in this browser for now (IndexedDB). Everything goes through this module, so it can
 * later be synced with a user account without touching the rest of the app.
 */
import type { ClipData } from '@overleagger/core';
import type { StaticSymbolDef } from '@overleagger/symbols';
import { createStore, get, set } from 'idb-keyval';
import { create } from 'zustand';

export interface UserTemplate {
  id: string;
  name: string;
  category: string;
  description?: string;
  createdAt: number;
  /** The elements (and sub-sheets) of the template. */
  clip: ClipData;
  /** Custom symbols used by the template, copied into the project on insertion. */
  symbols: StaticSymbolDef[];
}

export const LIBRARY_FORMAT = 'overleagger-library';

export interface LibraryFile {
  format: typeof LIBRARY_FORMAT;
  version: 1;
  symbols: StaticSymbolDef[];
  templates: UserTemplate[];
}

const store =
  typeof indexedDB !== 'undefined' ? createStore('overleagger-user', 'library') : undefined;

async function persist(key: 'symbols' | 'templates', value: unknown) {
  if (store) await set(key, value, store);
}

interface UserLibState {
  loaded: boolean;
  symbols: StaticSymbolDef[];
  templates: UserTemplate[];
  load: () => Promise<void>;
  saveSymbol: (s: StaticSymbolDef) => void;
  removeSymbol: (id: string) => void;
  saveTemplate: (t: UserTemplate) => void;
  updateTemplate: (
    id: string,
    patch: Partial<Pick<UserTemplate, 'name' | 'category' | 'description'>>,
  ) => void;
  removeTemplate: (id: string) => void;
  /** Merge a library file (same ids are replaced). */
  importFile: (f: LibraryFile) => void;
  exportFile: () => LibraryFile;
}

const upsert = <T extends { id: string }>(list: T[], item: T) => {
  const i = list.findIndex((x) => x.id === item.id);
  return i < 0 ? [...list, item] : list.map((x, k) => (k === i ? item : x));
};

export const useUserLib = create<UserLibState>((setState, getState) => ({
  loaded: false,
  symbols: [],
  templates: [],
  load: async () => {
    if (getState().loaded || !store) return;
    const [symbols, templates] = await Promise.all([
      get<StaticSymbolDef[]>('symbols', store),
      get<UserTemplate[]>('templates', store),
    ]);
    setState({ loaded: true, symbols: symbols ?? [], templates: templates ?? [] });
  },
  saveSymbol: (s) => {
    const symbols = upsert(getState().symbols, s);
    setState({ symbols });
    void persist('symbols', symbols);
  },
  removeSymbol: (id) => {
    const symbols = getState().symbols.filter((s) => s.id !== id);
    setState({ symbols });
    void persist('symbols', symbols);
  },
  saveTemplate: (t) => {
    const templates = upsert(getState().templates, t);
    setState({ templates });
    void persist('templates', templates);
  },
  updateTemplate: (id, patch) => {
    const templates = getState().templates.map((t) => (t.id === id ? { ...t, ...patch } : t));
    setState({ templates });
    void persist('templates', templates);
  },
  removeTemplate: (id) => {
    const templates = getState().templates.filter((t) => t.id !== id);
    setState({ templates });
    void persist('templates', templates);
  },
  importFile: (f) => {
    let symbols = getState().symbols;
    let templates = getState().templates;
    for (const s of f.symbols ?? []) symbols = upsert(symbols, s);
    for (const t of f.templates ?? []) templates = upsert(templates, t);
    setState({ symbols, templates });
    void persist('symbols', symbols);
    void persist('templates', templates);
  },
  exportFile: () => ({
    format: LIBRARY_FORMAT,
    version: 1,
    symbols: getState().symbols,
    templates: getState().templates,
  }),
}));

export function parseLibraryFile(text: string): LibraryFile {
  const data = JSON.parse(text) as Partial<LibraryFile>;
  if (data.format !== LIBRARY_FORMAT) throw new Error('Not an Overleagger library file.');
  return {
    format: LIBRARY_FORMAT,
    version: 1,
    symbols: data.symbols ?? [],
    templates: data.templates ?? [],
  };
}

/** Default category names offered in the category pickers. */
export const SUGGESTED_TEMPLATE_CATEGORIES = [
  'Power electronics',
  'Control',
  'Analog',
  'Digital',
  'Measurement',
  'My circuits',
];
