import * as Y from 'yjs';
import type { Standard } from '@overleagger/symbols';
import { newId } from '../ids';
import type { Element, Id, NewElement, ProjectMeta, ProjectSymbol, SheetInfo } from './types';

/** Transaction origin for edits made by the local user (tracked by the undo manager). */
export const LOCAL_ORIGIN = 'overleagger:local';

export const FORMAT_VERSION = 1;

type YElement = Y.Map<unknown>;
type YSheet = Y.Map<unknown>;

/**
 * Project document backed by Yjs.
 *
 * Layout:
 *   meta:    Y.Map   { name, standard, rootSheetId, formatVersion, createdAt }
 *   sheets:  Y.Map<sheetId, Y.Map { id, name, parentSheetId?, blockId?, elements: Y.Map<id, Y.Map> }>
 *   symbols: Y.Map<symbolId, StaticSymbolDef>   (project custom symbols)
 *
 * Each element is its own Y.Map so concurrent edits of different fields merge cleanly.
 * Reads return plain immutable snapshots that are cached until the element changes, so UI
 * components can rely on object identity.
 */
export class Project {
  readonly doc: Y.Doc;
  readonly meta: Y.Map<unknown>;
  readonly sheets: Y.Map<YSheet>;
  readonly symbols: Y.Map<ProjectSymbol>;

  private cache = new WeakMap<YElement, Element>();
  private listCache = new Map<Id, { version: number; list: Element[] }>();
  private _version = 0;
  private listeners = new Set<() => void>();

  constructor(doc: Y.Doc) {
    this.doc = doc;
    this.meta = doc.getMap('meta');
    this.sheets = doc.getMap('sheets') as Y.Map<YSheet>;
    this.symbols = doc.getMap('symbols') as Y.Map<ProjectSymbol>;
    doc.on('afterTransaction', (tr: Y.Transaction) => {
      if (tr.changed.size === 0) return;
      for (const type of tr.changed.keys()) {
        if (type instanceof Y.Map) this.cache.delete(type as YElement);
      }
      // Changes nested deeper (should not happen, we store plain JSON) are covered by changedParentTypes.
      for (const type of tr.changedParentTypes.keys()) {
        if (type instanceof Y.Map) this.cache.delete(type as YElement);
      }
      this._version++;
      for (const l of this.listeners) l();
    });
  }

  /** Create a new empty project with a root sheet. */
  static create(name: string, standard: Standard = 'IEC', doc = new Y.Doc()): Project {
    const p = new Project(doc);
    const rootId = newId();
    doc.transact(() => {
      p.meta.set('name', name);
      p.meta.set('standard', standard);
      p.meta.set('rootSheetId', rootId);
      p.meta.set('formatVersion', FORMAT_VERSION);
      p.meta.set('createdAt', Date.now());
      p.createSheetRaw({ id: rootId, name: 'Main' });
    });
    return p;
  }

  /** Monotonic counter bumped after every transaction (local or remote). */
  get version(): number {
    return this._version;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  transact<T>(fn: () => T, origin: unknown = LOCAL_ORIGIN): T {
    let out!: T;
    this.doc.transact(() => {
      out = fn();
    }, origin);
    return out;
  }

  // -------------------------------------------------------------------------
  // Meta
  // -------------------------------------------------------------------------

  getMeta(): ProjectMeta {
    return {
      name: (this.meta.get('name') as string) ?? 'Untitled',
      standard: (this.meta.get('standard') as Standard) ?? 'IEC',
      rootSheetId: this.meta.get('rootSheetId') as Id,
      formatVersion: (this.meta.get('formatVersion') as number) ?? FORMAT_VERSION,
      createdAt: (this.meta.get('createdAt') as number) ?? 0,
    };
  }

  setMeta(patch: Partial<ProjectMeta>): void {
    this.transact(() => {
      for (const [k, v] of Object.entries(patch)) this.meta.set(k, v);
    });
  }

  get rootSheetId(): Id {
    return this.meta.get('rootSheetId') as Id;
  }

  // -------------------------------------------------------------------------
  // Sheets
  // -------------------------------------------------------------------------

  /** Create a sheet (must be called inside a transaction). */
  createSheetRaw(info: SheetInfo): Id {
    const s = new Y.Map<unknown>();
    s.set('id', info.id);
    s.set('name', info.name);
    if (info.parentSheetId) s.set('parentSheetId', info.parentSheetId);
    if (info.blockId) s.set('blockId', info.blockId);
    s.set('elements', new Y.Map());
    this.sheets.set(info.id, s);
    return info.id;
  }

  hasSheet(id: Id): boolean {
    return this.sheets.has(id);
  }

  getSheet(id: Id): SheetInfo | undefined {
    const s = this.sheets.get(id);
    if (!s) return undefined;
    const info: SheetInfo = { id, name: (s.get('name') as string) ?? '' };
    const parent = s.get('parentSheetId') as Id | undefined;
    const block = s.get('blockId') as Id | undefined;
    if (parent) info.parentSheetId = parent;
    if (block) info.blockId = block;
    return info;
  }

  listSheets(): SheetInfo[] {
    const out: SheetInfo[] = [];
    for (const id of this.sheets.keys()) {
      const s = this.getSheet(id);
      if (s) out.push(s);
    }
    return out;
  }

  updateSheet(id: Id, patch: Partial<Omit<SheetInfo, 'id'>>): void {
    const s = this.sheets.get(id);
    if (!s) return;
    this.transact(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) s.delete(k);
        else s.set(k, v);
      }
    });
  }

  /** Delete a sheet (no recursion; see hierarchy helpers). Must be called inside a transaction. */
  deleteSheetRaw(id: Id): void {
    this.sheets.delete(id);
    this.listCache.delete(id);
  }

  private elementsMap(sheetId: Id): Y.Map<YElement> | undefined {
    return this.sheets.get(sheetId)?.get('elements') as Y.Map<YElement> | undefined;
  }

  // -------------------------------------------------------------------------
  // Elements
  // -------------------------------------------------------------------------

  /** True while a Yjs transaction is open: caches are only refreshed after it ends. */
  private get inTransaction(): boolean {
    return (this.doc as unknown as { _transaction: unknown })._transaction !== null;
  }

  private snapshot(m: YElement): Element {
    if (this.inTransaction) return m.toJSON() as Element;
    let el = this.cache.get(m);
    if (!el) {
      el = Object.freeze(m.toJSON()) as Element;
      this.cache.set(m, el);
    }
    return el;
  }

  /** All elements of a sheet sorted by z-order. The array is cached per document version. */
  getElements(sheetId: Id): Element[] {
    const hit = this.listCache.get(sheetId);
    if (hit && hit.version === this._version && !this.inTransaction) return hit.list;
    const map = this.elementsMap(sheetId);
    const list: Element[] = [];
    if (map) for (const m of map.values()) list.push(this.snapshot(m));
    list.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
    if (!this.inTransaction) this.listCache.set(sheetId, { version: this._version, list });
    return list;
  }

  getElement(sheetId: Id, id: Id): Element | undefined {
    const m = this.elementsMap(sheetId)?.get(id);
    return m ? this.snapshot(m) : undefined;
  }

  /** Highest z value in a sheet. */
  maxZ(sheetId: Id): number {
    let z = 0;
    for (const el of this.getElements(sheetId)) if (el.z > z) z = el.z;
    return z;
  }

  addElement(sheetId: Id, el: NewElement): Element {
    const map = this.elementsMap(sheetId);
    if (!map) throw new Error(`Unknown sheet ${sheetId}`);
    const id = el.id ?? newId();
    const full = { ...el, id, z: el.z ?? this.maxZ(sheetId) + 1 } as Element;
    this.transact(() => {
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(full)) if (v !== undefined) m.set(k, clone(v));
      map.set(id, m);
    });
    return this.getElement(sheetId, id)!;
  }

  /** Shallow-merge `patch` into an element. `undefined` values delete the field. */
  updateElement(sheetId: Id, id: Id, patch: Partial<Element>): void {
    const m = this.elementsMap(sheetId)?.get(id);
    if (!m) return;
    this.transact(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'id' || k === 'type') continue;
        if (v === undefined) m.delete(k);
        else if (!sameValue(m.get(k), v)) m.set(k, clone(v));
      }
    });
  }

  /** Replace several elements at once (each one shallow-merged). */
  updateElements(sheetId: Id, patches: { id: Id; patch: Partial<Element> }[]): void {
    this.transact(() => {
      for (const { id, patch } of patches) this.updateElement(sheetId, id, patch);
    });
  }

  removeElement(sheetId: Id, id: Id): void {
    const map = this.elementsMap(sheetId);
    if (!map?.has(id)) return;
    this.transact(() => map.delete(id));
  }

  // -------------------------------------------------------------------------
  // Custom symbols
  // -------------------------------------------------------------------------

  getProjectSymbols(): ProjectSymbol[] {
    return [...this.symbols.values()];
  }

  // -------------------------------------------------------------------------
  // Serialization
  // -------------------------------------------------------------------------

  /** Readable JSON snapshot of the whole project (for `.olg` files and debugging). */
  toJSON(): {
    meta: ProjectMeta;
    sheets: (SheetInfo & { elements: Element[] })[];
    symbols: ProjectSymbol[];
  } {
    return {
      meta: this.getMeta(),
      sheets: this.listSheets().map((s) => ({ ...s, elements: this.getElements(s.id) })),
      symbols: this.getProjectSymbols(),
    };
  }

  encodeState(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  static fromUpdate(update: Uint8Array): Project {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, update);
    return new Project(doc);
  }
}

function clone<T>(v: T): T {
  return v !== null && typeof v === 'object' ? (JSON.parse(JSON.stringify(v)) as T) : v;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createUndoManager(project: Project): Y.UndoManager {
  return new Y.UndoManager([project.meta, project.sheets, project.symbols], {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: 400,
  });
}
